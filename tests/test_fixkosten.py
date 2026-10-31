"""Tests für die Fixkosten (echtes Home Assistant im Testmodus). Nur ausgedachte Beispielzahlen!"""

from datetime import datetime
from unittest.mock import patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

from custom_components.fixkosten.const import DOMAIN
from custom_components.fixkosten.manager import format_iban, parse_money

TZ = "Europe/Berlin"

CSV = """Typ;Name;Betrag;Gruppe/Datum;Zahlart;Notiz
ausgabe;Miete;-800,00 €;1;d;
ausgabe;Strom;65,00;1;ü;
ausgabe;Handyvertrag;45,00;15;ü;
ausgabe;Kfz-Steuer;120,00;15;ü;nur im März
einnahme;Lohn;2.400,00 €;30.01.2026;ü;
topf;Sparkonto;1.000,00;;;
topf;Bargeld zu Hause;150,00;;;
stand;Kumpel Tim;40,00;;;Pizza
iban;Girokonto;de00 1234 5678 9012 3456 78;;;BLZ 12345678
"""


@pytest.fixture
async def setup(hass: HomeAssistant, freezer: FrozenDateTimeFactory):
    await hass.config.async_set_time_zone(TZ)
    freezer.move_to(datetime(2026, 11, 10, 12, 0, tzinfo=dt_util.get_time_zone(TZ)))
    assert await async_setup_component(hass, "http", {})
    hass.config.components.update({"frontend", "lovelace"})
    entry = MockConfigEntry(domain=DOMAIN, title="Fixkosten", options={"sidebar": False})
    entry.add_to_hass(hass)
    with patch("custom_components.fixkosten.frontend.add_extra_js_url"):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    return entry


def mgr(hass):
    return hass.data[DOMAIN]["manager"]


def test_parse_money():
    assert parse_money("-1.234,56 €") == -1234.56
    assert parse_money("58,29") == 58.29
    assert parse_money("12.5") == 12.5
    assert parse_money("1.000.000") == 1000000
    assert parse_money("") == 0
    assert parse_money(7) == 7
    with pytest.raises(HomeAssistantError):
        parse_money("abc")
    assert format_iban("de00123456789012345678") == "DE00 1234 5678 9012 3456 78"


async def test_import_and_summary(hass, setup):
    m = mgr(hass)
    counts = m.import_csv(CSV)
    assert counts == {"ausgaben": 4, "einnahmen": 1, "toepfe": 2, "staende": 1, "konten": 1, "uebersprungen": 0}
    # Kfz-Steuer gilt jeden Monat (Monate nur über die Karte), Miete ist positiv gespeichert
    assert m.find("posten", "Miete")["amount"] == 800
    assert m.find("posten", "Handyvertrag")["group"] == "g15"
    assert m.find("posten", "Miete")["pay"] == "dauerauftrag"
    assert m.find("einnahme", "Lohn")["date"] == "30.01.2026"
    assert m.find("konto", "Girokonto")["iban"] == "DE00 1234 5678 9012 3456 78"

    m.apply([{"type": "konto", "balance": "1.500,00"}])
    s = m.summary()
    assert s["fix_total"] == 1030 and s["fix_open"] == 1030
    assert s["available"] == 470
    assert s["income_total"] == 2400 and s["surplus"] == 1370
    assert s["total"] == 470 + 1150  # Verfügbar + Töpfe
    assert s["debts"] == 40
    # Am 10.: „ab dem 1.“ ist fällig, „ab dem 15.“ kommt noch
    g = {x["name"]: x for x in s["groups"]}
    assert g["ab dem 1."]["due"] and not g["ab dem 15."]["due"]
    assert s["next"]["name"] == "Miete" and s["next"]["due"]

    # Abhaken → zählt nicht mehr als offen
    m.apply([{"type": "paid", "id": "Miete", "value": True}])
    assert m.summary()["available"] == 1270
    await hass.async_block_till_done()
    assert hass.states.get("sensor.fixkosten_verfuegbar").state == "1270.0"
    assert hass.states.get("sensor.fixkosten_naechste_abbuchung").state == "Strom"
    assert hass.states.get("binary_sensor.fixkosten_warnung").state == "off"

    # Offene Stände nur abziehen, wenn eingeschaltet
    m.apply([{"type": "settings", "settings": {"debts_subtract": True}}])
    assert m.summary()["available"] == 1230


async def test_card_payments_and_offline_replay(hass, setup):
    m = mgr(hass)
    m.import_csv(CSV)
    m.apply([{"type": "konto", "balance": 1500}])
    # 💳 Kartenzahlung zählt sofort ab
    op = {"op_id": "abc123", "type": "booking_add", "name": "Bäckerei", "amount": "5,75", "ts": 1}
    m.apply([op])
    assert m.summary()["available"] == 470 - 5.75
    # Offline-App schickt dieselbe Änderung nochmal → zählt nicht doppelt
    res = m.apply([op])
    assert res[0]["duplicate"]
    assert len(m.data["bookings"]) == 1
    # ✓ abgebucht → fliegt aus der Rechnung, bleibt im Monat
    m.apply([{"type": "booking_clear", "id": "abc123"}])
    assert m.summary()["available"] == 470
    assert m.summary()["bookings_month"] == 5.75 or m.data["bookings"][0]["month"] != m.data["month"]

    # Haken: neuere Uhrzeit gewinnt (zwei Handys)
    m.apply([{"type": "paid", "id": "Strom", "value": True, "ts": 2000}])
    m.apply([{"type": "paid", "id": "Strom", "value": False, "ts": 1000}])
    assert m.data["paid"][m.find("posten", "Strom")["id"]]["paid"] is True
    # Haken aus dem letzten Monat (offline gesetzt) wird ignoriert
    m.apply([{"type": "paid", "id": "Handyvertrag", "value": True, "month": "2026-10"}])
    assert m.find("posten", "Handyvertrag")["id"] not in m.data["paid"]


async def test_month_rollover(hass, setup, freezer):
    m = mgr(hass)
    m.import_csv(CSV)
    m.apply([{"type": "paid", "id": "Miete"}])
    freezer.move_to(datetime(2026, 12, 1, 0, 0, 10, tzinfo=dt_util.get_time_zone(TZ)))
    async_fire_time_changed(hass, dt_util.utcnow())
    m._on_midnight(dt_util.now())
    await hass.async_block_till_done()
    assert m.data["month"] == "2026-12"
    assert m.data["paid"] == {}
    assert m.data["history"][-1]["month"] == "2026-11"
    assert m.data["history"][-1]["fix_paid"] == 800

    # Schalter aus → Haken bleiben stehen
    m.apply([{"type": "settings", "settings": {"reset_checks": False}}, {"type": "paid", "id": "Strom"}])
    freezer.move_to(datetime(2027, 1, 1, 0, 0, 10, tzinfo=dt_util.get_time_zone(TZ)))
    m._on_midnight(dt_util.now())
    assert m.data["month"] == "2027-01"
    assert m.data["paid"]


async def test_months_filter_and_groups(hass, setup):
    m = mgr(hass)
    m.apply([{"type": "posten_save", "item": {"name": "Kfz-Steuer", "amount": 120, "group": "15", "months": [3]}}])
    assert m.summary()["fix_total"] == 0  # im November nicht fällig
    m.apply([{"type": "posten_save", "item": {"name": "Zeitung", "amount": 20, "group": "ab dem 20."}}])
    m.apply([{"type": "posten_save", "item": {"name": "Abo", "amount": 5, "group": "20"}}])
    assert any(g["start_day"] == 20 for g in m.data["groups"])
    gid = m.find("gruppe", "ab dem 20.")["id"]
    m.apply([{"type": "gruppe_delete", "id": gid}])
    assert m.find("posten", "Abo")["group"] == m.data["groups"][0]["id"]
    res = m.apply([{"type": "posten_save", "item": {"name": ""}}])
    assert not res[0]["ok"]


async def test_services_and_websocket(hass, setup, hass_ws_client):
    await hass.services.async_call(DOMAIN, "csv_import", {"text": CSV}, blocking=True, return_response=True)
    await hass.services.async_call(DOMAIN, "kontostand_setzen", {"kontostand": 1000}, blocking=True)
    await hass.services.async_call(DOMAIN, "buchung_hinzufuegen", {"name": "Amazon", "betrag": 30}, blocking=True)
    await hass.services.async_call(DOMAIN, "abhaken", {"name": "Miete"}, blocking=True)
    await hass.services.async_call(DOMAIN, "topf_setzen", {"name": "PayPal", "betrag": 12.5}, blocking=True)
    res = await hass.services.async_call(DOMAIN, "daten_abrufen", {}, blocking=True, return_response=True)
    assert res["available"] == 1000 - 230 - 30
    assert res["pots_total"] == 1162.5
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(DOMAIN, "abhaken", {"name": "Gibtsnicht"}, blocking=True)
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(DOMAIN, "csv_import", {"datei": "../../etc/passwd"}, blocking=True, return_response=True)

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "fixkosten/subscribe"})
    assert (await client.receive_json())["success"]
    first = await client.receive_json()
    assert first["event"]["summary"]["available"] == 740
    assert "seen" not in first["event"]
    await client.send_json({"id": 2, "type": "fixkosten/apply", "ops": [{"op_id": "x1", "type": "booking_add", "name": "Bäckerei", "amount": 10}]})
    pushed = await client.receive_json()
    if pushed.get("type") == "event":
        assert pushed["event"]["summary"]["available"] == 730
        result = await client.receive_json()
    else:
        result = pushed
    assert result["result"]["results"][0]["ok"]


async def test_persistence(hass, setup):
    m = mgr(hass)
    m.import_csv(CSV)
    await m.async_save_now()
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert mgr(hass).find("posten", "Miete")["amount"] == 800


async def test_readme_lists_real_entities(hass, setup):
    """📖 Jede Entität aus der README gibt es wirklich – und umgekehrt."""
    import re
    from pathlib import Path

    readme = (Path(__file__).parent.parent / "README.md").read_text(encoding="utf-8")
    documented = set(re.findall(r"`((?:binary_)?sensor\.fixkosten_[a-z_]+)`", readme))
    real = {s.entity_id for s in hass.states.async_all() if "fixkosten" in s.entity_id}
    assert documented == real
    services = set(hass.services.async_services()[DOMAIN])
    assert services == set(re.findall(r"`fixkosten\.([a-z_]+)`", readme))


async def test_pin_lock_and_reset(hass, setup, hass_ws_client):
    """🔒 PIN setzen, prüfen, 5× falsch = Pause, Admin setzt sie im Optionsfenster zurück."""
    m = mgr(hass)
    assert m.check_pin("egal")  # ohne PIN ist alles offen
    with pytest.raises(HomeAssistantError):
        m.set_pin("12a4")
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "fixkosten/pin/set", "pin": "4711"})
    assert (await client.receive_json())["success"]
    assert m.snapshot()["pin"] is True
    assert "4711" not in str(m.data["pin"])  # nur Prüfsumme gespeichert
    await client.send_json({"id": 2, "type": "fixkosten/pin/check", "pin": "4711"})
    assert (await client.receive_json())["result"]["ok"]
    await client.send_json({"id": 3, "type": "fixkosten/pin/set", "pin": "1234", "old": "0000"})
    assert not (await client.receive_json())["success"]  # alte PIN falsch
    for _ in range(4):
        assert not m.check_pin("0000")
    with pytest.raises(HomeAssistantError):
        m.check_pin("4711")  # 5. Fehlversuch oben → Pause
    m._pin_locked_until = 0

    entry = hass.config_entries.async_entries(DOMAIN)[0]
    flow = await hass.config_entries.options.async_init(entry.entry_id)
    assert "reset_pin" in flow["data_schema"].schema
    res = await hass.config_entries.options.async_configure(flow["flow_id"], {"sidebar": False, "reset_pin": True})
    assert res["type"] == "create_entry"
    await hass.async_block_till_done()
    assert mgr(hass).snapshot()["pin"] is False
    assert mgr(hass).check_pin("")


async def test_app_files(hass, setup, hass_client_no_auth):
    """📱 Die Offline-App liefert Seite, Symbole und App-Icon aus."""
    client = await hass_client_no_auth()
    for f, ctype in (("index.html", "text/html"), ("icon-192.png", "image/png"), ("icons.json", "application/json"), ("sw.js", "text/javascript")):
        r = await client.get(f"/fixkosten/app/{f}")
        assert r.status == 200, f
        assert r.headers["Content-Type"].startswith(ctype)
    assert (await client.get("/fixkosten/app/../manager.py")).status == 404
    assert (await client.get("/fixkosten/app/icon.svg")).status == 404


async def test_order_restore_and_day(hass, setup):
    """⠿ Verschieben (auch in andere Gruppe), ↩️ Rückgängig und 📅 fester Tag."""
    m = mgr(hass)
    m.import_csv(CSV)
    ids = [p["id"] for p in m.data["posten"]]
    miete, strom, handy = (m.find("posten", n)["id"] for n in ("Miete", "Strom", "Handyvertrag"))
    m.apply([{"type": "order", "kind": "posten", "ids": [handy, strom, miete], "groups": {miete: "g15", strom: "kaputt"}}])
    order = [p["id"] for p in m.data["posten"]]
    assert order[:3] == [handy, strom, miete] and len(order) == len(ids)  # Unbekannte bleiben hinten
    assert m.find("posten", "Miete")["group"] == "g15"
    assert m.find("posten", "Strom")["group"] == "g01"  # unbekannte Gruppe wird ignoriert
    assert m.apply([{"type": "order", "kind": "gruppe", "ids": [g["id"] for g in reversed(m.data["groups"])]}])[0]["ok"]  # ⠿ Gruppen lassen sich auch verschieben
    assert m.data["groups"][0]["id"] == "g15" and m.summary()["groups"][0]["id"] == "g15"  # Liste bestimmt die Reihenfolge
    m.apply([{"type": "booking_add", "op_id": "b1", "name": "Bäckerei", "amount": 5}])
    m.apply([{"type": "booking_edit", "id": "b1", "name": "Tanken", "amount": "40,10"}])
    assert [(b["name"], b["amount"]) for b in m.data["bookings"] if b["id"] == "b1"] == [("Tanken", 40.1)]
    m.apply([{"type": "booking_delete", "id": "b1"}])
    # 🐷 Topf: rausnehmen und (in Teilen) zurücklegen
    sp = m.find("topf", "Sparkonto")["id"]
    before = m.summary()["pots_total"]
    m.apply([{"type": "topf_take", "id": sp, "amount": 50}])
    assert m.find("topf", "Sparkonto")["lent"] == 50 and m.summary()["pots_total"] == before - 50 and m.summary()["pots_lent"] == 50
    m.apply([{"type": "topf_return", "id": sp, "amount": 20}, {"type": "topf_return", "id": sp, "amount": 40}])
    assert m.find("topf", "Sparkonto")["lent"] == 0 and m.summary()["pots_total"] == before + 10
    m.apply([{"type": "topf_save", "item": {"id": sp, "amount": 1000}}])
    # 🔕 Warnung aus
    m.apply([{"type": "konto", "balance": -5000}])
    assert m.summary()["warn"]
    m.apply([{"type": "settings", "settings": {"warn_enabled": False}}])
    assert not m.summary()["warn"]
    m.apply([{"type": "settings", "settings": {"warn_enabled": True}}])

    topf = dict(m.find("topf", "Sparkonto"))
    m.apply([{"type": "topf_delete", "id": topf["id"]}])
    assert m.find("topf", "Sparkonto") is None
    m.apply([{"type": "restore", "kind": "topf", "item": topf, "index": 0}])
    assert m.data["toepfe"][0]["name"] == "Sparkonto" and m.data["toepfe"][0]["amount"] == 1000
    m.apply([{"type": "restore", "kind": "topf", "item": topf, "index": 0}])  # doppelt = nichts passiert
    assert sum(t["id"] == topf["id"] for t in m.data["toepfe"]) == 1
    res = m.apply([{"type": "restore", "kind": "gruppe", "item": {"id": "x"}}])
    assert not res[0]["ok"]

    m.apply([{"type": "booking_add", "op_id": "b9", "name": "Bäckerei", "amount": 3}])
    b = dict(m.data["bookings"][0])
    m.apply([{"type": "booking_delete", "id": "b9"}])
    m.apply([{"type": "restore", "kind": "booking", "item": b}])
    assert m.data["bookings"][0]["id"] == "b9"

    m.apply([{"type": "posten_save", "item": {"id": miete, "day": 5}}])
    assert m.find("posten", "Miete")["day"] == 5
    m.apply([{"type": "posten_save", "item": {"id": miete, "day": None}}])
    assert m.find("posten", "Miete")["day"] is None
    assert not m.apply([{"type": "posten_save", "item": {"id": miete, "day": 40}}])[0]["ok"]
    assert m.snapshot()["app_url"] is None  # ohne https-Adresse keine App-Adresse


async def test_health_and_factory_reset(hass, setup):
    """🩺 Fehler-Protokoll, Speicher, 💵 Einnahmen abhaken und 💣 Werkseinstellungen (PIN bleibt)."""
    m = mgr(hass)
    m.import_csv(CSV)
    lohn = m.data["einnahmen"][0]["id"]
    assert m.apply([{"type": "received", "id": lohn, "value": True}])[0]["ok"]
    assert m.data["received"][lohn]["paid"]
    m.apply([{"type": "reset_checks"}])
    assert not m.data["received"]
    assert not m.apply([{"type": "gibtsnicht"}])[0]["ok"]
    h = m.health()
    assert h["errors"] and "gibtsnicht" in h["errors"][0]["error"] and h["size"] > 100 and h["counts"]["posten"] > 0
    m.clear_errors()
    assert not m.health()["errors"]
    m.set_pin("4711")
    m.factory_reset()
    assert not m.data["posten"] and len(m.data["groups"]) == 2 and m.data["pin"] and m.check_pin("4711")
