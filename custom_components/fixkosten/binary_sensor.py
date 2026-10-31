"""⚠️ Warnung: an, wenn „Verfügbar“ unter die eingestellte Grenze fällt (Grenze in der Karte unter ⚙️)."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .sensor import device_info, entity_prefix


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([FkWarning(hass, entry)])


class FkWarning(BinarySensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_name = "Warnung"
    _attr_icon = "mdi:alert-circle-outline"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self._attr_unique_id = f"{entry.entry_id}_warn"
        self._attr_device_info = device_info(entry)
        self._entry_id = entry.entry_id
        self.entity_id = f"binary_sensor.{entity_prefix(hass, entry)}_warnung"

    @property
    def _m(self):
        return self.hass.data[DOMAIN]["books"][self._entry_id]

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, self._m.signal, self.async_write_ha_state))

    @property
    def is_on(self) -> bool:
        return bool(self._m.summary()["warn"])

    @property
    def extra_state_attributes(self):
        m = self._m
        s = m.summary()
        return {"verfuegbar": s["available"], "grenze": m.data["settings"].get("warn_below")}
