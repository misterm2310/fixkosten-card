"""🔌 Verbindung zur Karte und zur Offline-App."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN


def _manager(hass: HomeAssistant):
    return hass.data.get(DOMAIN, {}).get("manager")


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_apply)
    websocket_api.async_register_command(hass, ws_import)
    websocket_api.async_register_command(hass, ws_pin_set)
    websocket_api.async_register_command(hass, ws_pin_check)


@websocket_api.websocket_command({vol.Required("type"): "fixkosten/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Alles schicken – und bei jeder Änderung nochmal."""
    m = _manager(hass)
    if m is None:
        connection.send_error(msg["id"], "not_ready", "Fixkosten ist noch nicht eingerichtet")
        return

    @callback
    def push() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], m.snapshot()))

    connection.subscriptions[msg["id"]] = m.add_listener(push)
    connection.send_result(msg["id"])
    push()


@websocket_api.websocket_command({
    vol.Required("type"): "fixkosten/apply",
    vol.Required("ops"): vol.All([dict], vol.Length(max=500)),
})
@websocket_api.async_response
async def ws_apply(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Änderungen anwenden (auch nachgeschickte aus der Offline-App)."""
    m = _manager(hass)
    if m is None:
        connection.send_error(msg["id"], "not_ready", "Fixkosten ist noch nicht eingerichtet")
        return
    user = connection.user.name if connection.user else None
    connection.send_result(msg["id"], {"results": m.apply(msg["ops"], user)})


@websocket_api.websocket_command({
    vol.Required("type"): "fixkosten/import",
    vol.Required("text"): str,
    vol.Optional("replace", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    m = _manager(hass)
    if m is None:
        connection.send_error(msg["id"], "not_ready", "Fixkosten ist noch nicht eingerichtet")
        return
    try:
        connection.send_result(msg["id"], m.import_csv(msg["text"], msg["replace"]))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "import_failed", str(err))


@websocket_api.websocket_command({
    vol.Required("type"): "fixkosten/pin/set",
    vol.Optional("pin"): vol.Any(str, None),
    vol.Optional("old"): vol.Any(str, None),
})
@websocket_api.async_response
async def ws_pin_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """🔒 PIN festlegen, ändern oder (leer) entfernen."""
    m = _manager(hass)
    try:
        m.set_pin(msg.get("pin"), msg.get("old"))
        connection.send_result(msg["id"], {"ok": True})
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "pin", str(err))


@websocket_api.websocket_command({vol.Required("type"): "fixkosten/pin/check", vol.Required("pin"): str})
@websocket_api.async_response
async def ws_pin_check(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    m = _manager(hass)
    try:
        connection.send_result(msg["id"], {"ok": m.check_pin(msg["pin"])})
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "pin", str(err))
