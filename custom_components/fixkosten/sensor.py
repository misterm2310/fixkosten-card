"""📊 Sensoren: Verfügbar, offene Fixkosten, nächste Abbuchung usw. – für Dashboard und eigene Automationen."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, VERSION


@dataclass(frozen=True, kw_only=True)
class FkSensorDescription(SensorEntityDescription):
    value: Callable[[dict[str, Any]], Any]
    attrs: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]] | None = None


def _money(key: str, name: str, icon: str, attrs=None) -> FkSensorDescription:
    return FkSensorDescription(
        key=key, name=name, icon=icon, device_class=SensorDeviceClass.MONETARY,
        native_unit_of_measurement="EUR", state_class=SensorStateClass.TOTAL, suggested_display_precision=2,
        value=lambda s, k=key: s[k], attrs=attrs,
    )


def _next_attrs(s: dict[str, Any], d: dict[str, Any]) -> dict[str, Any]:
    n = s.get("next") or {}
    return {"betrag": n.get("amount"), "gruppe": n.get("group"), "ab_tag": n.get("start_day"), "faellig": n.get("due")}


def _open_attrs(s: dict[str, Any], d: dict[str, Any]) -> dict[str, Any]:
    paid = d["paid"]
    open_items = [p["name"] for p in d["posten"] if p.get("active", True) and not paid.get(p["id"], {}).get("paid")]
    return {"anzahl": len(open_items), "posten": open_items,
            "gruppen": {g["name"]: {"offen": g["open"], "faellig": g["due"]} for g in s["groups"]}}


def _pots_attrs(s: dict[str, Any], d: dict[str, Any]) -> dict[str, Any]:
    return {"konto": s["balance"], **{t["name"]: t["amount"] for t in d["toepfe"]}}


def _avail_attrs(s: dict[str, Any], d: dict[str, Any]) -> dict[str, Any]:
    return {"kontostand": s["balance"], "offene_fixkosten": s["fix_open"],
            "kartenzahlungen_offen": s["bookings_open"], "monat": s["month"]}


SENSORS = [
    _money("available", "Verfügbar", "mdi:cash-check", _avail_attrs),
    _money("fix_open", "Offene Fixkosten", "mdi:calendar-clock", _open_attrs),
    _money("fix_total", "Fixkosten Monat", "mdi:calendar-month"),
    _money("income_total", "Einnahmen Monat", "mdi:cash-plus"),
    _money("surplus", "Überschuss", "mdi:scale-balance"),
    _money("bookings_month", "Ausgaben Monat", "mdi:cart-outline"),
    _money("bookings_open", "Ausgaben offen", "mdi:credit-card-clock-outline"),
    _money("debts", "Offene Stände", "mdi:account-cash-outline", lambda s, d: {x["name"]: x["amount"] for x in d["staende"] if x.get("dir") != "get"}),
    _money("claims", "Offene Stände ich bekomme", "mdi:account-cash", lambda s, d: {x["name"]: x["amount"] for x in d["staende"] if x.get("dir") == "get"}),
    _money("total", "Gesamtvermögen", "mdi:piggy-bank-outline", _pots_attrs),
    FkSensorDescription(key="next", name="Nächste Abbuchung", icon="mdi:bell-ring-outline",
                        value=lambda s: (s.get("next") or {}).get("name") or "nichts offen", attrs=_next_attrs),
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities(FkSensor(hass, entry, d) for d in SENSORS)


def device_info(entry: ConfigEntry) -> DeviceInfo:
    return DeviceInfo(identifiers={(DOMAIN, entry.entry_id)}, name=entry.title or "Fixkosten", manufacturer="Mister-M",
                      sw_version=VERSION, entry_type=DeviceEntryType.SERVICE)


class FkSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, desc: FkSensorDescription) -> None:
        self.hass = hass
        self.entity_description = desc
        self._attr_unique_id = f"{entry.entry_id}_{desc.key}"
        self._attr_device_info = device_info(entry)
        self._entry_id = entry.entry_id
        self.entity_id = f"sensor.{entity_prefix(hass, entry)}_{_slug(desc.name)}"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(self.hass, self._m.signal, self._update))

    @callback
    def _update(self) -> None:
        self.async_write_ha_state()

    @property
    def _m(self):
        return self.hass.data[DOMAIN]["books"][self._entry_id]

    @property
    def native_unit_of_measurement(self) -> str | None:
        """💱 Geld-Sensoren nehmen die Währung aus ⚙️ (EUR, CHF …)"""
        if self.entity_description.device_class != SensorDeviceClass.MONETARY:
            return None
        return (self._m.data.get("settings") or {}).get("currency") or "EUR"

    @property
    def native_value(self) -> Any:
        return self.entity_description.value(self._m.summary())

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if self.entity_description.attrs is None:
            return None
        return self.entity_description.attrs(self._m.summary(), self._m.data)


def entity_prefix(hass: HomeAssistant, entry: ConfigEntry) -> str:
    """📚 Erstes Buch: sensor.fixkosten_… (wie bisher) · weitere: sensor.fixkosten_<name>_…"""
    m = hass.data[DOMAIN]["books"][entry.entry_id]
    return "fixkosten" if m.primary else f"fixkosten_{_slug(entry.title)}"


def _slug(name: str) -> str:
    out = name.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss"), (" ", "_")):
        out = out.replace(a, b)
    return "".join(c if c.isalnum() or c == "_" else "_" for c in out).strip("_")
