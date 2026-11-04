"""Installs and enables Gloaming's GNOME Shell bridge extension, so the replay overlay
can float over fullscreen games and receive keyboard focus without any manual setup.

GNOME on Wayland only discovers a new extension at the next login, so the first run
installs it and a later session uses it. Until then the overlay falls back to a
managed X11 window, which works too. Everything here is best effort: a failure is
logged and never stops the daemon.
"""
from __future__ import annotations

import ast
import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from .runtime import actual_home_dir

log = logging.getLogger(__name__)

UUID = "gloaming-overlay@iishkas.github.io"
# Earlier builds shipped under other UUIDs with a different D-Bus name and app id, so
# they never matched Gloaming's overlay. Leaving them enabled only adds noise.
LEGACY_UUIDS = ("vice-overlay@basilforge.local", "gloaming-overlay@basilforge.local")
FILES = ("extension.js", "metadata.json")
SCHEMA = "org.gnome.shell"


def source_dir() -> Path:
    return Path(__file__).resolve().parent / "gnome-extension" / UUID


def _extensions_dir() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(actual_home_dir() / ".local" / "share")
    return Path(base) / "gnome-shell" / "extensions"


def _marker_path() -> Path:
    return actual_home_dir() / ".local" / "share" / "gloaming" / "gnome-extension.json"


def _gsettings(*args: str) -> Optional[str]:
    try:
        out = subprocess.run(["gsettings", *args], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def _get_list(key: str) -> Optional[list[str]]:
    raw = _gsettings("get", SCHEMA, key)
    if raw is None:
        return None
    try:
        value = ast.literal_eval(re.sub(r"^@as\s+", "", raw))
    except (ValueError, SyntaxError):
        return None
    return [str(v) for v in value] if isinstance(value, list) else None


def _set_list(key: str, values: list[str]) -> bool:
    return _gsettings("set", SCHEMA, key, repr(values)) is not None


def _shell_major() -> Optional[int]:
    try:
        out = subprocess.run(["gnome-shell", "--version"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"(\d+)", out)
    return int(match.group(1)) if match else None


def supported() -> tuple[bool, str]:
    """Whether this session should get the extension, and why not when it should not."""
    if os.path.exists("/.flatpak-info"):
        return False, "running inside Flatpak"
    if "gnome" not in os.environ.get("XDG_CURRENT_DESKTOP", "").lower():
        return False, "not a GNOME session"
    if not os.environ.get("WAYLAND_DISPLAY"):
        return False, "not a Wayland session"
    src = source_dir()
    if not all((src / name).is_file() for name in FILES):
        return False, "extension files are missing from this install"
    major = _shell_major()
    try:
        versions = [str(v) for v in json.loads((src / "metadata.json").read_text())["shell-version"]]
    except (OSError, ValueError, KeyError):
        return False, "unreadable extension metadata"
    if major is None or str(major) not in versions:
        return False, f"GNOME Shell {major} is not one of the supported versions {versions}"
    return True, ""


def _extension_version() -> int:
    try:
        return int(json.loads((source_dir() / "metadata.json").read_text()).get("version", 1))
    except (OSError, ValueError):
        return 1


def _installed_matches(dest: Path) -> bool:
    return all((dest / n).is_file() and (dest / n).read_bytes() == (source_dir() / n).read_bytes() for n in FILES)


def ensure_installed() -> str:
    """Install and enable the extension once per version. Returns a short status word:
    "installed", "current", or "skipped: <reason>"."""
    ok, reason = supported()
    if not ok:
        return f"skipped: {reason}"
    dest = _extensions_dir() / UUID
    version = _extension_version()
    try:
        marker = json.loads(_marker_path().read_text())
    except (OSError, ValueError):
        marker = {}
    # Already set up for this version: leave the enabled state alone, so someone who
    # turned the extension off on purpose is not overruled at every start.
    if marker.get("version") == version and _installed_matches(dest):
        return "current"

    dest.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(source_dir() / name, dest / name)
    for legacy in LEGACY_UUIDS:
        shutil.rmtree(_extensions_dir() / legacy, ignore_errors=True)

    enabled = _get_list("enabled-extensions")
    if enabled is None:
        return "skipped: could not read the GNOME extension settings"
    wanted = [e for e in enabled if e not in LEGACY_UUIDS]
    if UUID not in wanted:
        wanted.append(UUID)
    if wanted != enabled and not _set_list("enabled-extensions", wanted):
        return "skipped: could not enable the extension"
    disabled = _get_list("disabled-extensions") or []
    if UUID in disabled:
        _set_list("disabled-extensions", [e for e in disabled if e != UUID])

    try:
        _marker_path().parent.mkdir(parents=True, exist_ok=True)
        _marker_path().write_text(json.dumps({"version": version}))
    except OSError as exc:
        log.debug("Could not write the GNOME extension marker: %s", exc)
    return "installed"


def setup() -> None:
    """Called at daemon start."""
    try:
        status = ensure_installed()
    except Exception:
        log.exception("GNOME overlay extension setup failed")
        return
    if status == "installed":
        log.info("Installed the GNOME overlay extension. Sign out and back in once to activate it; "
                 "until then the replay overlay uses its X11 fallback window.")
    else:
        log.debug("GNOME overlay extension: %s", status)
