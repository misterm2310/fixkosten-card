"""Einrichtung & Optionen (nur: in der Seitenleiste anzeigen). Alles andere stellt man in der Karte ein."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import BooleanSelector

from .const import CONF_SIDEBAR, DOMAIN


def _schema(sidebar: bool) -> vol.Schema:
    return vol.Schema({vol.Optional(CONF_SIDEBAR, default=sidebar): BooleanSelector()})


class FixkostenConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title="Fixkosten", data={}, options={CONF_SIDEBAR: bool(user_input.get(CONF_SIDEBAR))})
        return self.async_show_form(step_id="user", data_schema=_schema(True))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return FixkostenOptionsFlow()


class FixkostenOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        manager = self.hass.data.get(DOMAIN, {}).get("manager")
        if user_input is not None:
            if user_input.get("reset_pin") and manager is not None:
                manager.clear_pin()  # 🔓 PIN vergessen? Hier setzt ein Admin sie zurück
            return self.async_create_entry(data={CONF_SIDEBAR: bool(user_input.get(CONF_SIDEBAR))})
        schema = _schema(bool(self.config_entry.options.get(CONF_SIDEBAR, False)))
        if manager is not None and manager.data.get("pin"):
            schema = schema.extend({vol.Optional("reset_pin", default=False): BooleanSelector()})
        return self.async_show_form(step_id="init", data_schema=schema)
