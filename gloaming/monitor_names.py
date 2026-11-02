"""Real monitor names for the display pickers.

Capture tools list outputs by connector (``DP-3``, ``HDMI-A-1``), which says nothing about which screen is which. Every
monitor describes itself in its EDID, and the kernel exposes it for every connector under ``/sys/class/drm`` on any Linux
desktop (X11 or Wayland, any compositor, any GPU driver), so that is the one source used here: no D-Bus, no compositor
tools. The result is e.g. ``Dell U2723QE`` for ``DP-3``.
"""

from __future__ import annotations

import re
from pathlib import Path

DRM = Path("/sys/class/drm")

# PnP vendor ids that are worth spelling out (the rest are shown as the 3-letter id).
VENDORS = {
    "ACR": "Acer", "AOC": "AOC", "AUS": "ASUS", "BNQ": "BenQ", "CMN": "Chimei", "DEL": "Dell", "EIZ": "EIZO",
    "GBT": "Gigabyte", "GSM": "LG", "HPN": "HP", "HWP": "HP", "IVM": "iiyama", "LEN": "Lenovo", "LGD": "LG Display",
    "MAG": "MAG", "MSI": "MSI", "NEC": "NEC", "PHL": "Philips", "SAM": "Samsung", "SDC": "Samsung Display",
    "SNY": "Sony", "VSC": "ViewSonic", "BOE": "BOE", "AUO": "AU Optronics", "XMI": "Xiaomi", "KOG": "Koorui",
    "TCL": "TCL", "HKC": "HKC", "MEI": "Panasonic", "SHP": "Sharp", "APP": "Apple", "ENC": "EIZO", "KTC": "KTC",
}


def parse_edid(data: bytes) -> str | None:
    """The monitor's name from its EDID: the model descriptor, else vendor and product code."""
    if len(data) < 128 or data[:8] != b"\x00\xff\xff\xff\xff\xff\xff\x00":
        return None
    word = (data[8] << 8) | data[9]
    vendor = "".join(chr(((word >> shift) & 0x1F) + 64) for shift in (10, 5, 0))
    model = ""
    for start in (54, 72, 90, 108):
        block = data[start:start + 18]
        if block[:3] == b"\x00\x00\x00" and block[3] == 0xFC:
            model = block[5:18].split(b"\n")[0].decode("ascii", "ignore").strip()
            break
    brand = VENDORS.get(vendor, vendor)
    if model:
        # Many panels already start with the brand ("DELL U2723QE"): do not say it twice.
        if model.lower().startswith(brand.lower()) or model.lower().startswith(vendor.lower()):
            return model
        return f"{brand} {model}"
    product = data[10] | (data[11] << 8)
    return f"{brand} {product:04X}" if vendor else None


def monitor_names() -> dict[str, str]:
    """{connector: monitor name} for every connected monitor that reports one."""
    names: dict[str, str] = {}
    try:
        entries = list(DRM.iterdir())
    except OSError:
        return names
    for entry in entries:
        match = re.match(r"^card\d+-(.+)$", entry.name)
        if not match:
            continue
        try:
            name = parse_edid((entry / "edid").read_bytes())
        except OSError:
            continue
        if name:
            names.setdefault(match.group(1), name)
    return names


def label_displays(displays: list[dict]) -> list[dict]:
    """Put the monitor name in front of each display's label: ``Dell U2723QE · DP-3 (2560x1440)``."""
    names = monitor_names()
    if not names:
        return displays
    for display in displays:
        name = names.get(str(display.get("id", "")))
        label = str(display.get("label") or display.get("id") or "")
        if name and name.lower() not in label.lower():
            display["label"] = f"{name} · {label}"
            display["monitor"] = name
    return displays
