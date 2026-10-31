"""🧠 Das Gehirn der Fixkosten: speichert alles, rechnet „Verfügbar“ aus und wechselt den Monat.

Alles läuft über „Änderungen“ (ops). Jede Änderung hat eine eigene Nummer (id) und eine Uhrzeit (ts).
Darum kann die Offline-App Änderungen sammeln und später nachschicken, ohne dass etwas doppelt zählt:
- schon gesehene Nummern werden einfach übersprungen,
- bei Haken gewinnt die neuere Uhrzeit,
- Tagesbuchungen werden addiert (zwei Handys = zwei Buchungen, kein Streit).
"""

from __future__ import annotations

import csv
from urllib.parse import quote
import hashlib
import hmac
import io
import json
import logging
import re
import secrets
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    APP_URL,
    DEFAULT_GROUPS,
    DEFAULT_SETTINGS,
    MAX_BOOKINGS_DAYS,
    MAX_HISTORY,
    MAX_LOG,
    MAX_SEEN_OPS,
    PAY_SHORT,
    PAY_TYPES,
    SIGNAL_UPDATE,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)

LIST_KINDS = {"posten": "posten", "einnahme": "einnahmen", "topf": "toepfe", "stand": "staende", "konto": "konten", "gruppe": "groups"}


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def parse_money(value: Any) -> float:
    """„−1.234,56 €“, „-58,29“, „12.5“ → Zahl. Leer → 0."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    s = str(value).strip().replace("€", "").replace("EUR", "").replace("−", "-").replace(" ", "").replace(" ", "")
    if not s:
        return 0.0
    if "," in s:  # deutsche Schreibweise: Punkt = Tausender, Komma = Nachkomma
        s = s.replace(".", "").replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        return round(float(s), 2)
    except ValueError as err:
        raise HomeAssistantError(f"„{value}“ ist kein Betrag") from err


def format_iban(value: Any) -> str:
    """„de00 1234…“ → „DE00 1234 …“ (Vierergruppen). Nur Anzeige, keine Prüfung."""
    raw = re.sub(r"\s", "", str(value or "")).upper()[:34]
    return " ".join(raw[i:i + 4] for i in range(0, len(raw), 4))


def month_key(now: datetime) -> str:
    return f"{now.year:04d}-{now.month:02d}"


VIEW_KEYS = ("next", "ausgaben", "fixkosten", "einnahmen", "staende", "toepfe", "konten")  # 👁️ was man ausblenden kann


def _empty() -> dict[str, Any]:
    return {
        "groups": [dict(g) for g in DEFAULT_GROUPS],
        "posten": [],
        "einnahmen": [],
        "toepfe": [],
        "staende": [],  # 🧾 offene Stände, die noch beglichen werden müssen
        "konten": [],   # 🏦 nur Info: Name + IBAN zum schnellen Kopieren
        "konto": {"balance": 0.0, "updated": 0},
        "month": "",
        "paid": {},
        "received": {},
        "bookings": [],
        "history": [],
        "log": [],  # 📜 Verlauf: wer, wann, was (die letzten MAX_LOG)
        "settings": dict(DEFAULT_SETTINGS),
        "seen": [],
        "pin": None,  # 🔒 PIN für ⚙️ und Bearbeiten (nur als Prüfsumme)
    }


class FixkostenManager:
    """Hält die Daten, rechnet und meldet Änderungen an Karte und Sensoren."""

    def __init__(self, hass: HomeAssistant, store_key: str = STORAGE_KEY, entry_id: str = "", title: str = "Fixkosten") -> None:
        self.hass = hass
        # 📚 Mehrere Bücher (wie mehrere Anlagen bei Solis): das erste Buch behält den alten Speicher „fixkosten“
        self.store_key = store_key
        self.primary = store_key == STORAGE_KEY
        self.entry_id = entry_id
        self.title = title
        self.signal = f"{SIGNAL_UPDATE}_{entry_id}" if entry_id else SIGNAL_UPDATE
        self._store: Store = Store(hass, STORAGE_VERSION, store_key)
        self.data: dict[str, Any] = _empty()
        self._listeners: list[Callable[[], None]] = []
        self._unsub_time: CALLBACK_TYPE | None = None
        self._pin_fails = 0
        self._pin_locked_until = 0.0
        self.errors: list[dict[str, Any]] = []  # 🐞 Fehler-Protokoll (nur im Speicher, die letzten 50)

    # ------------------------------------------------------------------ 💾 Laden / Speichern
    async def async_load(self) -> None:
        stored = await self._store.async_load()
        base = _empty()
        if isinstance(stored, dict):
            base.update({k: v for k, v in stored.items() if k in base})
            base["settings"] = {**DEFAULT_SETTINGS, **(stored.get("settings") or {})}
            base["konto"] = {**_empty()["konto"], **(stored.get("konto") or {})}
        self.data = base
        self._check_month(save=False)
        if not self.data["month"]:
            self.data["month"] = month_key(dt_util.now())

    def _save(self) -> None:
        self._store.async_delay_save(lambda: self.data, 1.0)

    async def async_save_now(self) -> None:
        await self._store.async_save(self.data)

    # ------------------------------------------------------------------ ⏰ Monatswechsel
    @callback
    def async_start(self) -> None:
        self._unsub_time = async_track_time_change(self.hass, self._on_midnight, hour=0, minute=0, second=5)

    @callback
    def async_stop(self) -> None:
        if self._unsub_time:
            self._unsub_time()
            self._unsub_time = None

    @callback
    def _on_midnight(self, _now: datetime) -> None:
        if self._check_month():
            return
        self._changed()  # neuer Tag: „kommt noch“ → „jetzt fällig“ kann sich ändern

    def _check_month(self, save: bool = True) -> bool:
        """Neuer Monat? Dann Rückblick merken und (falls eingeschaltet) Haken zurücksetzen."""
        now_key = month_key(dt_util.now())
        old = self.data.get("month")
        if not old or old == now_key:
            return False
        summary = self.summary()
        self.data["history"].append({
            "month": old,
            "fix_total": summary["fix_total"],
            "fix_paid": summary["fix_paid"],
            "income_total": summary["income_total"],
            "bookings": summary["bookings_month"],
            "available_end": summary["available"],
        })
        self.data["history"] = self.data["history"][-MAX_HISTORY:]
        if self.data["settings"].get("reset_checks", True):
            self.data["paid"] = {}
            self.data["received"] = {}
        self.data["month"] = now_key
        cutoff = (dt_util.utcnow() - timedelta(days=MAX_BOOKINGS_DAYS)).timestamp() * 1000
        self.data["bookings"] = [b for b in self.data["bookings"] if b.get("ts", 0) >= cutoff or not b.get("cleared")]
        _LOGGER.info("Fixkosten: neuer Monat %s", now_key)
        if save:
            self._changed()
        return True

    # ------------------------------------------------------------------ 📣 Melden
    @callback
    def add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(cb)
        return lambda: self._listeners.remove(cb) if cb in self._listeners else None

    def _changed(self) -> None:
        self._save()
        for cb in list(self._listeners):
            cb()
        async_dispatcher_send(self.hass, self.signal)

    # ------------------------------------------------------------------ 🧮 Rechnen
    def _counts_this_month(self, item: dict[str, Any]) -> bool:
        if not item.get("active", True):
            return False
        months = item.get("months") or []
        return not months or int(self.data["month"][5:7] or 0) in months

    def summary(self) -> dict[str, Any]:
        """Alle Zahlen für Karte und Sensoren (Beträge immer positiv = Geld, das weggeht/reinkommt)."""
        d = self.data
        today = dt_util.now().day
        groups = list(d["groups"])  # ⠿ Reihenfolge wie in der Liste (per Ziehen änderbar)
        paid = d["paid"]

        group_info = []
        fix_total = fix_open = 0.0
        next_item = None
        for g in groups:
            items = [p for p in d["posten"] if p.get("group") == g["id"] and self._counts_this_month(p)]
            total = sum(p["amount"] for p in items)
            open_items = [p for p in items if not paid.get(p["id"], {}).get("paid")]
            open_sum = sum(p["amount"] for p in open_items)
            due = today >= int(g.get("start_day", 1))
            fix_total += total
            fix_open += open_sum
            if open_items and next_item is None:
                first = open_items[0]
                next_item = {"name": first["name"], "amount": first["amount"], "group": g["name"],
                             "start_day": g.get("start_day", 1), "due": due}
            group_info.append({"id": g["id"], "name": g["name"], "start_day": g.get("start_day", 1), "due": due,
                               "total": round(total, 2), "open": round(open_sum, 2), "count": len(items),
                               "done": len(items) - len(open_items)})
        # Posten ohne (gültige) Gruppe zählen trotzdem
        known = {g["id"] for g in groups}
        for p in d["posten"]:
            if p.get("group") not in known and self._counts_this_month(p):
                fix_total += p["amount"]
                if not paid.get(p["id"], {}).get("paid"):
                    fix_open += p["amount"]

        incomes = [e for e in d["einnahmen"] if self._counts_this_month(e)]
        income_total = sum(e["amount"] for e in incomes)

        konto = d["konto"]
        since = konto.get("updated", 0) or 0
        # 💳 Ausgaben zählen ab, bis sie als „abgebucht“ markiert sind (dann stecken sie im Kontostand)
        bookings_open = sum(b["amount"] for b in d["bookings"] if not b.get("cleared"))
        mk = d["month"]
        bookings_month = sum(b["amount"] for b in d["bookings"] if b.get("month") == mk)
        debts = sum(x["amount"] for x in d["staende"])
        available = float(konto.get("balance", 0)) - fix_open - bookings_open  # „Vorgemerkt“ gibt es nicht mehr (doppelt mit Ausgaben)
        if d["settings"].get("debts_subtract"):
            available -= debts
        pots = sum(t["amount"] for t in d["toepfe"])
        lent = sum(float(t.get("lent", 0) or 0) for t in d["toepfe"])  # 🐷 aus Töpfen geliehen, noch nicht zurückgelegt
        return {
            "month": mk,
            "today": today,
            "available": round(available, 2),
            "balance": round(float(konto.get("balance", 0)), 2),
            "balance_updated": since,
            "fix_total": round(fix_total, 2),
            "fix_open": round(fix_open, 2),
            "fix_paid": round(fix_total - fix_open, 2),
            "income_total": round(income_total, 2),
            "surplus": round(income_total - fix_total, 2),
            "bookings_open": round(bookings_open, 2),
            "bookings_month": round(bookings_month, 2),
            "pots_total": round(pots, 2),
            "pots_lent": round(lent, 2),
            "debts": round(debts, 2),
            "total": round(pots + available, 2),  # 💰 wie in der Tabelle: was verfügbar ist + alle Töpfe
            "warn": d["settings"].get("warn_enabled", True) is not False and available < float(d["settings"].get("warn_below", 0) or 0),
            "next": next_item,
            "groups": group_info,
        }

    def snapshot(self) -> dict[str, Any]:
        """Was die Karte bekommt (ohne interne Merkliste)."""
        out = {k: v for k, v in self.data.items() if k not in ("seen", "pin")}
        out["pin"] = bool(self.data.get("pin"))
        out["summary"] = self.summary()
        out["app_url"] = self._app_url()
        out["version"] = VERSION  # 🔄 damit die Karte merkt, wenn sie veraltet ist
        out["book"] = {"id": self.entry_id, "title": self.title, "primary": self.primary}  # 📚 welches Buch
        return out

    def _app_url(self) -> str | None:
        """📱 Adresse der Offline-App von unterwegs (Nabu Casa bzw. externe https-Adresse) – wie bei der Einkaufsliste."""
        try:
            from homeassistant.helpers.network import NoURLAvailableError, get_url  # noqa: PLC0415
        except ImportError:  # pragma: no cover
            return None
        try:
            base = get_url(self.hass, allow_internal=False, allow_ip=False, require_ssl=True, prefer_cloud=True)
        except NoURLAvailableError:
            return None
        except Exception:  # noqa: BLE001 – lieber keine Adresse als ein Fehler
            return None
        return base.rstrip("/") + APP_URL + ("" if self.primary else "?buch=" + quote(self.title))

    # ------------------------------------------------------------------ 🔒 PIN (wie bei der Einkaufsliste)
    @staticmethod
    def _pin_hash(pin: str, salt: str) -> str:
        return salt + "$" + hashlib.sha256((salt + str(pin)).encode()).hexdigest()

    def check_pin(self, pin: str | None) -> bool:
        """PIN prüfen. 5× falsch = 60 Sekunden Pause (gegen Durchprobieren)."""
        if not self.data.get("pin"):
            return True
        left = self._pin_locked_until - time.monotonic()
        if left > 0:
            raise HomeAssistantError(f"Zu oft falsch – bitte {int(left) + 1} Sekunden warten")
        salt = self.data["pin"].split("$", 1)[0]
        ok = hmac.compare_digest(self._pin_hash(str(pin or ""), salt), self.data["pin"])
        if ok:
            self._pin_fails = 0
        else:
            self._pin_fails += 1
            if self._pin_fails >= 5:
                self._pin_fails = 0
                self._pin_locked_until = time.monotonic() + 60
        return ok

    def set_pin(self, pin: str | None, old: str | None = None) -> None:
        if self.data.get("pin") and not self.check_pin(old):
            raise HomeAssistantError("Die alte PIN stimmt nicht")
        pin = (pin or "").strip()
        if pin and not re.fullmatch(r"\d{4,8}", pin):
            raise HomeAssistantError("Die PIN muss 4 bis 8 Ziffern haben")
        self.data["pin"] = self._pin_hash(pin, secrets.token_hex(8)) if pin else None
        self._changed()

    def clear_pin(self) -> None:
        """🔓 PIN vergessen? Ein Admin setzt sie unter Geräte & Dienste → Fixkosten → Konfigurieren zurück."""
        self.data["pin"] = None
        self._pin_fails = 0
        self._pin_locked_until = 0.0
        self._changed()

    # ------------------------------------------------------------------ ✏️ Ändern
    def find(self, kind: str, ref: str) -> dict[str, Any] | None:
        key = LIST_KINDS[kind]
        ref_l = str(ref).strip().lower()
        for it in self.data[key]:
            if it["id"] == ref or str(it.get("name", "")).strip().lower() == ref_l:
                return it
        return None

    def apply(self, ops: list[dict[str, Any]], user: str | None = None) -> list[dict[str, Any]]:
        """Mehrere Änderungen auf einmal. Gibt pro Änderung {id, ok, error?} zurück."""
        results = []
        changed = False
        for op in ops:
            oid = str(op.get("op_id") or new_id())
            if oid in self.data["seen"]:
                results.append({"op_id": oid, "ok": True, "duplicate": True})
                continue
            try:
                text = self._describe(op)  # 📜 vorher beschreiben (beim Löschen ist der Name danach weg)
                self._apply_one(op, user)
                changed = True
                results.append({"op_id": oid, "ok": True})
                self._log(op, text, user)
            except HomeAssistantError as err:
                results.append({"op_id": oid, "ok": False, "error": str(err)})
                self._log_error(op, str(err), user)
            except (KeyError, TypeError, ValueError) as err:
                results.append({"op_id": oid, "ok": False, "error": f"ungültig: {err}"})
                self._log_error(op, f"ungültig: {err}", user)
            self.data["seen"].append(oid)
        self.data["seen"] = self.data["seen"][-MAX_SEEN_OPS:]
        if changed:
            self._changed()
        else:
            self._save()
        return results

    # ------------------------------------------------------------------ 📜 Verlauf (wer, wann, was)
    @staticmethod
    def _eur(value: Any) -> str:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return "?"
        return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")

    def _name(self, kind: str, ref: Any) -> str:
        if kind in LIST_KINDS and ref is not None:
            it = self.find(kind, str(ref))  # findet auch über den Namen
            return str((it or {}).get("name") or ref)
        for it in self.data.get("bookings") or []:
            if it.get("id") == ref:
                return str(it.get("name") or "")
        return str(ref or "")

    def _describe(self, op: dict[str, Any]) -> str | None:
        """📜 Ein Satz für den Verlauf, z. B. „✅ Miete abgehakt“. None = nicht merken."""
        t = str(op.get("type") or "")
        on = op.get("value", True) is not False
        what = {"posten": "Fixkosten", "einnahme": "Einnahme", "topf": "Topf", "stand": "Offener Stand", "konto": "Konto", "gruppe": "Gruppe"}
        kind, _, verb = t.partition("_")
        if kind in what and verb == "save":
            item = op.get("item") or {}
            name = item.get("name") or self._name(kind, item.get("id"))
            return f"✏️ {what[kind]} „{name}“ {'geändert' if item.get('id') and self.find(kind, item['id']) else 'neu'}"
        if kind in what and verb == "delete":
            return f"🗑️ {what[kind]} „{self._name(kind, op.get('id'))}“ gelöscht"
        if t == "paid":
            return f"{'✅' if on else '⭕'} „{self._name('posten', op.get('id'))}“ {'abgehakt' if on else 'Haken weg'}"
        if t == "received":
            return f"{'💵' if on else '⭕'} „{self._name('einnahme', op.get('id'))}“ {'ist da' if on else 'doch nicht da'}"
        if t == "reset_checks":
            return "↩️ Alle Haken zurückgesetzt"
        if t == "konto" and "balance" in op:
            return f"🏦 Kontostand {self._eur(parse_money(op['balance']))}"
        if t == "booking_add":
            return f"💳 Ausgabe „{str(op.get('name') or 'Ausgabe').strip()[:60]}“ {self._eur(parse_money(op.get('amount', 0)))}"
        if t == "booking_clear":
            return f"{'✓' if on else '⭕'} „{self._name('booking', op.get('id'))}“ {'abgebucht' if on else 'doch nicht abgebucht'}"
        if t == "booking_edit":
            return f"✏️ Ausgabe „{op.get('name') or self._name('booking', op.get('id'))}“ geändert"
        if t == "booking_delete":
            return f"🗑️ Ausgabe „{self._name('booking', op.get('id'))}“ gelöscht"
        if t in ("topf_take", "topf_return"):
            amount = self._eur(abs(parse_money(op.get("amount", 0))))
            pot = self._name("topf", op.get("id"))
            return f"🐷 {amount} aus „{pot}“ genommen" if t == "topf_take" else f"🐷 {amount} in „{pot}“ zurückgelegt"
        if t == "topf_keep":
            return f"🐷 „{self._name('topf', op.get('id'))}“: Geliehenes bleibt weg"
        if t == "restore":
            return f"↩️ „{(op.get('item') or {}).get('name') or ''}“ zurückgeholt"
        if t == "order":
            return "⠿ Reihenfolge geändert"
        if t == "settings":
            return "⚙️ Einstellungen geändert"
        return None

    def _log(self, op: dict[str, Any], text: str | None, user: str | None) -> None:
        if not text or self.data["settings"].get("log_on", True) is False:
            return
        ts = int(op.get("ts") or dt_util.utcnow().timestamp() * 1000)
        log = self.data.setdefault("log", [])
        log.append({"ts": ts, "by": user, "text": text[:120]})
        self.data["log"] = log[-MAX_LOG:]

    # ------------------------------------------------------------------ 🩺 Gesundheit
    def _log_error(self, op: dict[str, Any], error: str, user: str | None) -> None:
        """🐞 Merkt sich, was nicht geklappt hat (ohne Beträge oder Namen – nur Art und Fehler)."""
        self.errors.append({"ts": int(dt_util.utcnow().timestamp() * 1000), "type": str(op.get("type"))[:40], "error": error[:200], "by": user})
        self.errors = self.errors[-50:]

    def clear_errors(self) -> None:
        self.errors = []

    def health(self) -> dict[str, Any]:
        """📊 Speicher und Umfang (für ⚙️ → Gesundheit)."""
        size = len(json.dumps(self.data, ensure_ascii=False).encode("utf-8"))
        counts = {k: len(self.data.get(k) or []) for k in ("groups", "posten", "einnahmen", "toepfe", "staende", "konten", "bookings", "history", "log")}
        return {"errors": list(reversed(self.errors)), "size": size, "counts": counts, "seen": len(self.data.get("seen") or [])}

    def factory_reset(self) -> None:
        """💣 Werkseinstellungen: alles zurück auf Anfang – nur die PIN bleibt."""
        pin = self.data.get("pin")
        self.data = _empty()
        self.data["pin"] = pin
        self.data["month"] = month_key(dt_util.now())
        self.errors = []
        self._changed()

    def _apply_one(self, op: dict[str, Any], user: str | None) -> None:
        t = op.get("type")
        ts = int(op.get("ts") or dt_util.utcnow().timestamp() * 1000)
        d = self.data

        if t in ("posten_save", "einnahme_save", "topf_save", "stand_save", "konto_save", "gruppe_save"):
            kind = t.split("_")[0]
            self._save_item(kind, op.get("item") or {}, ts)
        elif t in ("posten_delete", "einnahme_delete", "topf_delete", "stand_delete", "konto_delete", "gruppe_delete"):
            kind = t.split("_")[0]
            key = LIST_KINDS[kind]
            item = self.find(kind, op["id"])
            if item is None:
                return  # schon weg – kein Fehler (kann beim Nachschicken passieren)
            if kind == "gruppe" and len(d["groups"]) <= 1:
                raise HomeAssistantError("Die letzte Gruppe kann nicht gelöscht werden")
            d[key] = [x for x in d[key] if x["id"] != item["id"]]
            if kind == "gruppe":
                fallback = d["groups"][0]["id"]
                for p in d["posten"]:
                    if p.get("group") == item["id"]:
                        p["group"] = fallback
            d["paid"].pop(item["id"], None)
            d["received"].pop(item["id"], None)
        elif t in ("paid", "received"):
            kind = "posten" if t == "paid" else "einnahme"
            item = self.find(kind, op["id"])
            if item is None:
                raise HomeAssistantError(f"„{op['id']}“ gibt es nicht")
            if op.get("month") and op["month"] != d["month"]:
                return  # Haken aus dem letzten Monat (offline gesetzt) – im neuen Monat nicht mehr gültig
            store = d[t]
            old = store.get(item["id"])
            if old and old.get("ts", 0) > ts:
                return  # neuere Änderung ist schon da
            store[item["id"]] = {"paid": bool(op.get("value", True)), "ts": ts, "by": user}
        elif t == "reset_checks":
            d["paid"] = {}
            d["received"] = {}
        elif t == "konto":
            if "balance" in op:
                d["konto"]["balance"] = parse_money(op["balance"])
                d["konto"]["updated"] = ts
        elif t == "booking_add":
            amount = parse_money(op["amount"])
            if amount == 0:
                raise HomeAssistantError("Betrag fehlt")
            name = str(op.get("name") or "Ausgabe").strip()[:60]
            when = dt_util.as_local(dt_util.utc_from_timestamp(ts / 1000))
            d["bookings"].append({"id": str(op.get("op_id") or new_id()), "name": name, "amount": amount,
                                  "ts": ts, "month": month_key(when), "by": user, "cleared": False})
        elif t == "booking_clear":  # ✅ ist jetzt auf dem Konto abgebucht
            for b in d["bookings"]:
                if b["id"] == op["id"]:
                    b["cleared"] = bool(op.get("value", True))
        elif t == "booking_edit":  # ✏️ Name/Betrag nachträglich ändern
            for b in d["bookings"]:
                if b["id"] == op["id"]:
                    if "name" in op:
                        b["name"] = str(op.get("name") or "Ausgabe").strip()[:60]
                    if "amount" in op:
                        amount = parse_money(op["amount"])
                        if amount == 0:
                            raise HomeAssistantError("Betrag fehlt")
                        b["amount"] = amount
        elif t in ("topf_take", "topf_return"):  # 🐷 Geld aus dem Topf nehmen / wieder zurücklegen
            amount = abs(parse_money(op.get("amount", 0)))
            if amount == 0:
                raise HomeAssistantError("Betrag fehlt")
            pot = next((x for x in d["toepfe"] if x["id"] == op.get("id")), None)
            if pot is None:
                raise HomeAssistantError("Topf nicht gefunden")
            lent = float(pot.get("lent", 0) or 0)
            pot["updated"] = ts  # 📅 Datum der letzten Änderung (steht auch im CSV)
            if t == "topf_take":
                pot["amount"] = round(float(pot["amount"]) - amount, 2)
                pot["lent"] = round(lent + amount, 2)
            else:
                pot["amount"] = round(float(pot["amount"]) + amount, 2)
                pot["lent"] = round(max(0.0, lent - amount), 2)
        elif t == "topf_keep":  # 🐷 Geliehenes doch nicht zurücklegen: nur der orange Zettel geht weg (der Topf ist schon kleiner)
            pot = next((x for x in d["toepfe"] if x["id"] == op.get("id")), None)
            if pot is None:
                raise HomeAssistantError("Topf nicht gefunden")
            pot["lent"] = 0.0
        elif t == "booking_delete":
            d["bookings"] = [b for b in d["bookings"] if b["id"] != op["id"]]
        elif t == "restore":  # ↩️ Rückgängig nach dem Löschen: Eintrag kommt an seinen alten Platz zurück
            kind = op.get("kind")
            key = "bookings" if kind == "booking" else LIST_KINDS.get(kind)
            item = op.get("item") or {}
            if not key or kind == "gruppe" or not isinstance(item, dict) or not item.get("id"):
                raise HomeAssistantError("Das kann man nicht zurückholen")
            if not any(x["id"] == item["id"] for x in d[key]):
                idx = max(0, min(int(op.get("index", len(d[key]))), len(d[key])))
                d[key].insert(idx, dict(item))
        elif t == "order":  # ⠿ Reihenfolge per Ziehen (Posten auch in eine andere Gruppe)
            kind = op.get("kind")
            if kind not in LIST_KINDS:
                raise HomeAssistantError("Diese Liste kann man nicht sortieren")
            key = LIST_KINDS[kind]
            pos = {str(i): n for n, i in enumerate(op.get("ids") or [])}
            d[key].sort(key=lambda x: pos.get(x["id"], len(pos)))  # Unbekannte bleiben hinten, in alter Reihenfolge
            if kind == "posten":
                known = {g["id"] for g in d["groups"]}
                for it in d[key]:
                    gid = (op.get("groups") or {}).get(it["id"])
                    if gid in known:
                        it["group"] = gid
        elif t == "settings":
            s = op.get("settings") or {}
            if "reset_checks" in s:
                d["settings"]["reset_checks"] = bool(s["reset_checks"])
            if "quick" in s:  # ⚡ Schnellknöpfe für Ausgaben
                d["settings"]["quick"] = [str(x).strip()[:30] for x in s["quick"] if str(x).strip()][:16]
            if "debts_subtract" in s:
                d["settings"]["debts_subtract"] = bool(s["debts_subtract"])
            if "warn_enabled" in s:  # 🔕 Warnung an/aus
                d["settings"]["warn_enabled"] = bool(s["warn_enabled"])
            if "warn_below" in s:
                d["settings"]["warn_below"] = parse_money(s["warn_below"])
            for flag in ("log_on", "labels", "mascot", "veil", "lock_all"):  # 📜 🔤 🐷 einfache Schalter
                if flag in s:
                    d["settings"][flag] = bool(s[flag])
            if isinstance(s.get("view"), dict):  # 👁️ Abschnitte ein-/ausblenden (für alle)
                view = dict(d["settings"].get("view") or {})
                for k, v in s["view"].items():
                    if k in VIEW_KEYS:
                        view[k] = bool(v)
                d["settings"]["view"] = view
        elif t == "log_clear":  # 🧹 Verlauf leeren
            d["log"] = []
        else:
            raise HomeAssistantError(f"Unbekannte Änderung „{t}“")

    def _save_item(self, kind: str, item: dict[str, Any], ts: int) -> dict[str, Any]:
        key = LIST_KINDS[kind]
        name = str(item.get("name", "")).strip()[:60]
        existing = None
        if item.get("id"):
            existing = next((x for x in self.data[key] if x["id"] == item["id"]), None)
        if existing is None and not name:
            raise HomeAssistantError("Name fehlt")
        target = existing or {"id": str(item.get("id") or new_id())}
        if name:
            target["name"] = name
        if kind == "konto":
            if "iban" in item or existing is None:
                target["iban"] = format_iban(item.get("iban", ""))
            if "note" in item:
                target["note"] = str(item["note"] or "")[:100]
        elif kind == "gruppe":
            if "start_day" in item:
                day = int(item["start_day"])
                if not 1 <= day <= 28:
                    raise HomeAssistantError("Starttag muss zwischen 1 und 28 liegen")
                target["start_day"] = day
            target.setdefault("start_day", 1)
        else:
            if "amount" in item or existing is None:
                target["amount"] = abs(parse_money(item.get("amount", 0)))
            if kind in ("topf", "stand"):
                target["updated"] = ts
                if "note" in item:
                    target["note"] = str(item["note"] or "")[:200]
            else:
                if "pay" in item or existing is None:
                    pay = str(item.get("pay") or "keine").lower()
                    target["pay"] = PAY_SHORT.get(pay, pay if pay in PAY_TYPES else "keine")
                if "note" in item:
                    target["note"] = str(item["note"] or "")[:200]
                if "active" in item or existing is None:
                    target["active"] = bool(item.get("active", True))
                if "months" in item or existing is None:
                    months = item.get("months") or []
                    target["months"] = sorted({int(m) for m in months if 1 <= int(m) <= 12})
                if kind == "posten" and ("group" in item or existing is None):
                    target["group"] = self._group_ref(item.get("group"))
                if kind == "posten" and "day" in item:  # 📅 fester Abbuchungstag (freiwillig)
                    day = int(item["day"]) if str(item["day"] or "").strip() else None
                    if day is not None and not 1 <= day <= 31:
                        raise HomeAssistantError("Fester Tag muss zwischen 1 und 31 liegen")
                    target["day"] = day
                if kind == "einnahme" and "date" in item:  # 📅 nur Info, z. B. „30.01.2026“ oder „monatlich am 1.“
                    target["date"] = str(item["date"] or "")[:30]
        if existing is None:
            self.data[key].append(target)
        return target

    def _group_ref(self, ref: Any) -> str:
        """Gruppe per id, Name oder Starttag („15“) finden – sonst die erste."""
        groups = self.data["groups"]
        if ref in (None, ""):
            return groups[0]["id"]
        s = str(ref).strip().strip('"').lower()
        for g in groups:
            if g["id"] == ref or g["name"].lower() == s:
                return g["id"]
        digits = re.sub(r"\D", "", s)
        if digits:
            day = int(digits)
            for g in groups:
                if int(g.get("start_day", 1)) == day:
                    return g["id"]
            if 1 <= day <= 28:  # neue Gruppe „ab dem X.“
                g = {"id": new_id(), "name": f"ab dem {day}.", "start_day": day}
                groups.append(g)
                return g["id"]
        return groups[0]["id"]

    # ------------------------------------------------------------------ 📥 CSV-Import
    def import_csv(self, text: str, replace: bool = False) -> dict[str, int]:
        """Spalten: Typ;Name;Betrag;Gruppe/Datum;Zahlart;Notiz (Typ = ausgabe | einnahme | topf | stand | iban | kontostand). Kopfzeile optional.

        Bei Einnahmen steht in Spalte 4 ein Datum als Info (Einnahmen sind nur Info, sie ändern „Verfügbar“ nicht)."""
        if not text or not text.strip():
            raise HomeAssistantError("Die CSV-Datei ist leer")
        sample = text[:2000]
        if "\t" in sample and ";" not in sample:
            delim = "\t"
        else:
            delim = ";" if sample.count(";") >= sample.count(",") else ","
        rows = list(csv.reader(io.StringIO(text.lstrip("﻿")), delimiter=delim))
        counts = {"ausgaben": 0, "einnahmen": 0, "toepfe": 0, "staende": 0, "konten": 0, "kontostand": 0, "uebersprungen": 0}
        if replace:
            self.data["posten"], self.data["einnahmen"], self.data["toepfe"], self.data["staende"] = [], [], [], []
            self.data["paid"], self.data["received"] = {}, {}
        ts = int(dt_util.utcnow().timestamp() * 1000)
        kinds = {"ausgabe": "posten", "ausgaben": "posten", "posten": "posten", "fix": "posten",
                 "einnahme": "einnahme", "einnahmen": "einnahme", "topf": "topf", "toepfe": "topf", "töpfe": "topf", "iban": "konto", "bankkonto": "konto",
                 "stand": "stand", "offen": "stand", "staende": "stand", "stände": "stand", "schulden": "stand"}
        for row in rows:
            cells = [c.strip() for c in row] + [""] * 6
            typ = cells[0].lower()
            if not any(cells) or typ in ("typ", "type") or typ.startswith("#"):
                continue
            if typ in ("kontostand", "saldo"):  # 🏦 Kontostand (mit Vorzeichen, darf auch mal im Minus sein)
                try:
                    self.data["konto"]["balance"] = parse_money(cells[2])
                except HomeAssistantError:
                    counts["uebersprungen"] += 1
                    continue
                self.data["konto"]["updated"] = ts
                counts["kontostand"] += 1
                continue
            kind = kinds.get(typ)
            if kind is None or not cells[1]:
                counts["uebersprungen"] += 1
                continue
            try:
                amount = abs(parse_money(cells[2])) if kind != "konto" else 0.0
            except HomeAssistantError:
                counts["uebersprungen"] += 1
                continue
            item: dict[str, Any] = {"name": cells[1], "amount": amount}
            if kind == "posten":
                item.update(group=cells[3], pay=cells[4], note=cells[5])
            elif kind == "stand":
                item.update(note=cells[5])
            elif kind == "konto":
                item = {"name": cells[1], "iban": cells[2], "note": cells[5] or cells[3]}
            elif kind == "einnahme":
                item.update(date=cells[3], pay=cells[4], note=cells[5])
            same = self.find(kind, cells[1])
            if same is not None:
                item["id"] = same["id"]
            saved = self._save_item(kind, item, ts)
            if kind in ("topf", "stand") and cells[3]:  # 📅 Datum aus Spalte 4 (TT.MM.JJJJ) behalten
                try:
                    day = datetime.strptime(cells[3], "%d.%m.%Y").replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)
                    saved["updated"] = int(day.timestamp() * 1000)
                except ValueError:
                    pass
            counts[{"posten": "ausgaben", "einnahme": "einnahmen", "topf": "toepfe", "stand": "staende", "konto": "konten"}[kind]] += 1
        self._changed()
        return counts
