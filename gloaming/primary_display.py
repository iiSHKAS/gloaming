"""Which monitor is the primary one, on whichever desktop this is.

Capture tools list monitors in an arbitrary order and, left on "auto", pick whichever they list first, which is often the
second screen. The desktop knows which one is primary (the one with the top bar, where games open). It says so in a
different way on each desktop, so this tries them in turn and gives back a connector name such as ``DP-3``:

1. GNOME (Mutter) over D-Bus: the logical monitor flagged primary.
2. X11 / XWayland: the ``*`` monitor of ``xrandr --listmonitors``.
3. Any other desktop: the monitor whose top-left corner is the origin, which is where the primary screen sits.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import time
from typing import Optional

log = logging.getLogger("gloaming.primary_display")

_CACHE: dict = {"at": 0.0, "value": None}
TTL = 4.0


def normalize(connector: str) -> str:
    """Connector names differ by a letter between tools: Mutter says HDMI-1, the kernel and GSR say HDMI-A-1."""
    return re.sub(r"^(HDMI|DVI)-[AB]-", r"\1-", (connector or "").strip()).lower()


def _run(cmd: list[str], timeout: float = 2.0) -> str:
    if os.path.exists("/.flatpak-info"):
        cmd = ["flatpak-spawn", "--host", *cmd]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout if out.returncode == 0 else ""


def _gnome() -> Optional[str]:
    if not shutil.which("gdbus"):
        return None
    out = _run(["gdbus", "call", "--session", "--dest", "org.gnome.Mutter.DisplayConfig",
                "--object-path", "/org/gnome/Mutter/DisplayConfig",
                "--method", "org.gnome.Mutter.DisplayConfig.GetCurrentState"])
    if not out:
        return None
    # Logical monitors: (x, y, scale, transform, primary, [(connector, vendor, product, serial)], props)
    found = re.findall(r"\((-?\d+), (-?\d+), [\d.]+, (?:uint32 )?\d+, (true|false), \[\('([^']+)'", out)
    for _x, _y, primary, connector in found:
        if primary == "true":
            return connector
    for x, y, _primary, connector in found:
        if x == "0" and y == "0":
            return connector
    return None


def _xrandr() -> Optional[str]:
    if not shutil.which("xrandr"):
        return None
    out = _run(["xrandr", "--listmonitors"])
    origin = None
    for line in out.splitlines():
        match = re.match(r"^\s*\d+:\s+([+*]*)\S+\s+\d+/\d+x\d+/\d+\+(-?\d+)\+(-?\d+)\s+(\S+)$", line)
        if not match:
            continue
        flags, x, y, name = match.groups()
        if "*" in flags:
            return name
        if x == "0" and y == "0" and origin is None:
            origin = name
    return origin


def primary_connector() -> Optional[str]:
    """The primary monitor's connector, or None when the desktop does not say."""
    now = time.monotonic()
    if now - _CACHE["at"] < TTL:
        return _CACHE["value"]
    value = None
    for source in (_gnome, _xrandr):
        try:
            value = source()
        except Exception:
            log.debug("Primary display lookup failed", exc_info=True)
            value = None
        if value:
            break
    _CACHE.update(at=now, value=value)
    return value


def is_primary(display_id: str, primary: Optional[str]) -> bool:
    return bool(primary) and normalize(display_id) == normalize(primary or "")


def order_displays(displays: list[dict]) -> list[dict]:
    """The primary monitor first and marked, the others in their listed order."""
    primary = primary_connector()
    if not primary:
        return displays
    for display in displays:
        display["primary"] = is_primary(str(display.get("id", "")), primary)
    return sorted(displays, key=lambda d: 0 if d.get("primary") else 1)
