"""Feste Werte für die Fixkosten-Integration."""

from __future__ import annotations

import json
from pathlib import Path

DOMAIN = "fixkosten"
VERSION: str = json.loads((Path(__file__).parent / "manifest.json").read_text(encoding="utf-8"))["version"]

STORAGE_KEY = DOMAIN
STORAGE_VERSION = 1
PIN_OFF_ITER = 100_000  # 📴 Runden für den Offline-Schlüssel der PIN (PBKDF2) – Karte rechnet ohne Netz genauso nach

STATIC_URL = "/fixkosten/files"
CARD_FILENAME = "fixkosten-card.js"
PANEL_FILENAME = "fixkosten-panel.js"
PANEL_URL_PATH = "fixkosten"
APP_URL = "/fixkosten/app/"

CONF_SIDEBAR = "sidebar"
DEFAULT_OPTIONS = {CONF_SIDEBAR: False}

SIGNAL_UPDATE = f"{DOMAIN}_update"

# 💳 Zahlarten (Kürzel wie in der alten Tabelle)
PAY_TYPES = ["ueberweisung", "dauerauftrag", "lastschrift", "paypal", "amex", "google", "bar", "keine"]
PAY_SHORT = {"ü": "ueberweisung", "u": "ueberweisung", "d": "dauerauftrag", "l": "lastschrift", "p": "paypal",
             "a": "amex", "g": "google", "b": "bar", "-": "keine", "": "keine"}

# 🗂️ Startgruppen: „ab dem 1.“ und „ab dem 15.“
DEFAULT_GROUPS = [
    {"id": "g01", "name": "ab dem 1.", "start_day": 1},
    {"id": "g15", "name": "ab dem 15.", "start_day": 15},
]
DEFAULT_SETTINGS = {
    "reset_checks": True,   # ✅ Haken am Monatsanfang automatisch zurücksetzen (Schalter)
    "warn_enabled": True,   # 🔕 Warnung an/aus (Schalter)
    "warn_below": 100.0,
    "debts_subtract": False,  # 🧾 offene Stände von „Verfügbar“ abziehen (Schalter)    # ⚠️ Warnung, wenn „Verfügbar“ darunter fällt
    "currency": "EUR",
    "log_on": True,         # 📜 Verlauf: wer hat wann was geändert (Schalter)
    "labels": False,        # 🔤 Beschriftungen unter den Symbol-Knöpfen (für alle)
    "mascot": False,
    "veil": True,
    "lock_all": False,      # 🔒 ganze Karte mit PIN sperren (nicht nur ⚙️ und Bearbeiten)           # 🙈 Einnahmen, Töpfe und „Komplett“ verschleiern (Schalter, für alle)        # 🐷 Maskottchen Sparschwein oben links (für alle)
    "view": {},             # 👁️ Ansicht für alle: Abschnitt → False = ausgeblendet
    "quick": ["Bäckerei", "Netto, Lidl & Co.", "Amazon", "PayPal", "Mc Donalds & BK", "Sonstiges"],  # ⚡ Schnellknöpfe
}

MAX_BOOKINGS_DAYS = 400   # 🧾 Tagesbuchungen so lange aufheben
MAX_LOG = 300            # 📜 Verlauf: so viele Einträge merken
MAX_HISTORY = 36          # 📊 Monatsrückblick: so viele Monate merken
MAX_SEEN_OPS = 2000       # 🔁 schon verarbeitete Änderungen (gegen doppeltes Nachschicken aus der Offline-App)

# 💱 Währungen: Code → Zeichen (für Texte im Verlauf)
CURRENCIES = {"EUR": "€", "CHF": "CHF", "USD": "$", "GBP": "£", "PLN": "zł", "CZK": "Kč", "DKK": "kr", "SEK": "kr", "NOK": "kr", "HUF": "Ft"}
