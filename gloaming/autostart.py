"""Start with the system: an XDG autostart entry that opens the window at login.

The entry passes ``--startup`` so the window knows it was opened at login and may start hidden in the tray.
It reuses whatever launches Gloaming for this user (the installed ``.desktop`` file, then ``gloaming-app``) so it
works for an installed copy and for a checkout run through ``run-dev.sh`` alike.
"""

from __future__ import annotations

import logging
import os
import shlex
import shutil
from pathlib import Path

from .runtime import actual_home_dir

log = logging.getLogger(__name__)

NAME = "gloaming.desktop"


def entry_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME")
    config = Path(base) if base else actual_home_dir() / ".config"
    return config / "autostart" / NAME


def _exec_from_desktop(path: Path) -> list[str] | None:
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("Exec="):
                parts = [p for p in shlex.split(line[5:]) if not (len(p) == 2 and p.startswith("%"))]
                return parts or None
    except (OSError, ValueError):
        return None
    return None


def launcher() -> list[str] | None:
    """The command that opens Gloaming for this user, or None when it cannot be found."""
    home = actual_home_dir()
    for desktop in (home / ".local/share/applications" / NAME, Path("/usr/share/applications") / NAME):
        command = _exec_from_desktop(desktop)
        if command:
            return command
    for candidate in (home / ".local/bin/gloaming-app", Path(shutil.which("gloaming-app") or "")):
        if candidate.name and candidate.is_file():
            return [str(candidate)]
    return None


def _quote(arg: str) -> str:
    """One Exec argument, quoted the way the Desktop Entry spec wants it."""
    if not arg or any(c in arg for c in ' \t\n"\'\\><~|&;$*?#()`'):
        escaped = arg.replace("\\", "\\\\").replace('"', '\\"').replace("`", "\\`").replace("$", "\\$")
        return f'"{escaped}"'
    return arg


def sync(enabled: bool) -> str | None:
    """Create or remove the autostart entry. Returns an error message, or None when all is well."""
    path = entry_path()
    if not enabled:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            return str(exc)
        return None
    command = launcher()
    if command is None:
        return "Could not find how Gloaming is launched on this system."
    contents = (
        "[Desktop Entry]\nType=Application\nName=Gloaming\nComment=Game clip recorder\nIcon=gloaming\n"
        "Terminal=false\nX-GNOME-Autostart-enabled=true\nExec="
        + " ".join(_quote(a.replace("%", "%%")) for a in [*command, "--startup"]) + "\n"
    )
    try:
        if path.exists() and path.read_text(encoding="utf-8") == contents:
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8")
    except OSError as exc:
        log.warning("Could not write the autostart entry: %s", exc)
        return str(exc)
    return None
