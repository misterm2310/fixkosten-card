"""💶 Fixkosten – deine monatlichen Fixkosten in Home Assistant (mit Offline-App)."""

from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from . import websocket as ws
from .app_view import async_register_app
from .const import CONF_SIDEBAR, DOMAIN, STORAGE_KEY, STORAGE_VERSION
from .frontend import async_set_sidebar, async_setup_frontend
from .books import get_manager
from .manager import FixkostenManager

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Einmalig: Karte + Offline-App bereitstellen, Websocket und Aktionen anmelden."""
    hass.data.setdefault(DOMAIN, {})
    await async_setup_frontend(hass)
    async_register_app(hass)
    ws.async_register(hass)
    _register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store_key = entry.data.get("store", STORAGE_KEY)  # 📚 erstes Buch = alter Speicher, weitere bekommen einen eigenen
    manager = FixkostenManager(hass, store_key, entry.entry_id, entry.title)
    await manager.async_load()
    hass.data[DOMAIN].setdefault("books", {})[entry.entry_id] = manager
    if manager.primary:
        hass.data[DOMAIN]["manager"] = manager
    manager.async_start()
    entry.async_on_unload(manager.async_stop)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    if manager.primary:
        await async_set_sidebar(hass, bool(entry.options.get(CONF_SIDEBAR, False)))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        manager: FixkostenManager | None = hass.data[DOMAIN].get("books", {}).pop(entry.entry_id, None)
        if manager is not None:
            if manager.primary:
                await async_set_sidebar(hass, False)
                hass.data[DOMAIN].pop("manager", None)
            await manager.async_save_now()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """🗑️ Ein weiteres Buch gelöscht: seine Daten gleich mit wegräumen (das erste Buch bleibt wie bisher liegen)."""
    store_key = entry.data.get("store", STORAGE_KEY)
    if store_key != STORAGE_KEY:
        await Store(hass, STORAGE_VERSION, store_key).async_remove()


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def _user_name(hass: HomeAssistant, call: ServiceCall) -> str | None:
    if not call.context.user_id:
        return None
    user = await hass.auth.async_get_user(call.context.user_id)
    return user.name if user else None


def _check(results: list[dict]) -> None:
    for r in results:
        if not r.get("ok"):
            raise HomeAssistantError(r.get("error") or "Das hat nicht geklappt")


def _register_services(hass: HomeAssistant) -> None:
    async def abhaken(call: ServiceCall) -> None:
        m = get_manager(hass, call.data.get("buch"))
        name = call.data["name"]
        kind = "paid" if m.find("posten", name) else "received" if m.find("einnahme", name) else None
        if kind is None:
            raise HomeAssistantError(f"„{name}“ gibt es nicht")
        _check(m.apply([{"type": kind, "id": name, "value": call.data["erledigt"]}], await _user_name(hass, call)))

    async def kontostand(call: ServiceCall) -> None:
        op = {"type": "konto", "balance": call.data["kontostand"]}
        _check(get_manager(hass, call.data.get("buch")).apply([op], await _user_name(hass, call)))

    async def buchung(call: ServiceCall) -> None:
        _check(get_manager(hass, call.data.get("buch")).apply(
            [{"type": "booking_add", "name": call.data.get("name", "Ausgabe"), "amount": call.data["betrag"]}],
            await _user_name(hass, call)))

    async def topf(call: ServiceCall) -> None:
        m = get_manager(hass, call.data.get("buch"))
        old = m.find("topf", call.data["name"])
        item = {"name": call.data["name"], "amount": call.data["betrag"]}
        if old:
            item["id"] = old["id"]
        _check(m.apply([{"type": "topf_save", "item": item}]))

    async def zuruecksetzen(call: ServiceCall) -> None:
        get_manager(hass, call.data.get("buch")).apply([{"type": "reset_checks"}])

    async def csv_import(call: ServiceCall) -> ServiceResponse:
        text = call.data.get("text")
        if not text and call.data.get("datei"):
            path = Path(hass.config.path(call.data["datei"]))
            if not hass.config.is_allowed_path(str(path)) or not str(path.resolve()).startswith(str(Path(hass.config.config_dir).resolve())):
                raise HomeAssistantError("Die Datei muss im config-Ordner liegen")
            if not path.is_file():
                raise HomeAssistantError(f"Datei {call.data['datei']} nicht gefunden")
            text = await hass.async_add_executor_job(path.read_text, "utf-8-sig")
        if not text:
            raise HomeAssistantError("Bitte „text“ oder „datei“ angeben")
        return get_manager(hass, call.data.get("buch")).import_csv(text, call.data.get("ersetzen", False))

    async def abrufen(call: ServiceCall) -> ServiceResponse:
        return get_manager(hass, call.data.get("buch")).summary()

    hass.services.async_register(DOMAIN, "abhaken", abhaken, vol.Schema({vol.Optional("buch"): cv.string, vol.Required("name"): cv.string, vol.Optional("erledigt", default=True): cv.boolean}))
    hass.services.async_register(DOMAIN, "kontostand_setzen", kontostand, vol.Schema({vol.Optional("buch"): cv.string, vol.Required("kontostand"): vol.Coerce(float), vol.Optional("vorgemerkt"): vol.Coerce(float)}))
    hass.services.async_register(DOMAIN, "buchung_hinzufuegen", buchung, vol.Schema({vol.Optional("buch"): cv.string, vol.Optional("name"): cv.string, vol.Required("betrag"): vol.Coerce(float)}))
    hass.services.async_register(DOMAIN, "topf_setzen", topf, vol.Schema({vol.Optional("buch"): cv.string, vol.Required("name"): cv.string, vol.Required("betrag"): vol.Coerce(float)}))
    hass.services.async_register(DOMAIN, "haken_zuruecksetzen", zuruecksetzen, vol.Schema({vol.Optional("buch"): cv.string}))
    hass.services.async_register(DOMAIN, "csv_import", csv_import, vol.Schema({vol.Optional("buch"): cv.string, vol.Optional("text"): cv.string, vol.Optional("datei"): cv.string, vol.Optional("ersetzen", default=False): cv.boolean}),
        supports_response=SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "daten_abrufen", abrufen, vol.Schema({vol.Optional("buch"): cv.string}), supports_response=SupportsResponse.ONLY)
