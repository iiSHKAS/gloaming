"""Pick a folder with the desktop's own file dialog, through xdg-desktop-portal.

The portal is the one route that is the same on GNOME, KDE and the wlroots
compositors, on Wayland and X11 alike: the desktop draws its native chooser and
hands back a path. FileChooser only understands folders from interface version
3 on, so a desktop without that (or without a portal at all) reports itself as
unavailable and the settings page leaves the Browse button out.
"""
from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse

from .runtime import load_user_systemd_env

log = logging.getLogger("gloaming.folder_picker")

_BUS = "org.freedesktop.portal.Desktop"
_PATH = "/org/freedesktop/portal/desktop"
_CHOOSER = "org.freedesktop.portal.FileChooser"
_REQUEST = "org.freedesktop.portal.Request"
_TIMEOUT_SECONDS = 600


def _session_bus():
    from gi.repository import Gio
    load_user_systemd_env()
    return Gio.bus_get_sync(Gio.BusType.SESSION, None)


def available() -> bool:
    """Whether this desktop's portal can show a folder chooser."""
    try:
        from gi.repository import Gio, GLib
        reply = _session_bus().call_sync(
            _BUS, _PATH, "org.freedesktop.DBus.Properties", "Get",
            GLib.Variant("(ss)", (_CHOOSER, "version")), GLib.VariantType("(v)"),
            Gio.DBusCallFlags.NONE, 2000, None)
        return int(reply.unpack()[0]) >= 3
    except Exception:
        log.debug("Folder chooser portal is not available", exc_info=True)
        return False


def pick_folder(title: str, start: str = "") -> Optional[str]:
    """Show the chooser and wait. The chosen folder, or None when cancelled.

    Blocks until the dialog closes, so call it off the event loop.
    """
    from gi.repository import Gio, GLib

    bus = _session_bus()
    token = "gloaming_" + uuid.uuid4().hex[:12]
    sender = (bus.get_unique_name() or "").lstrip(":").replace(".", "_")
    request = f"/org/freedesktop/portal/desktop/request/{sender}/{token}"

    # Own context, so the answer is dispatched to this thread's loop and not
    # to whichever default context the process happens to be running.
    context = GLib.MainContext.new()
    context.push_thread_default()
    loop = GLib.MainLoop(context)
    answer: dict = {}

    def on_response(_conn, _sender, _path, _iface, _signal, params, *_):
        code, results = params.unpack()
        answer["code"] = code
        answer["uris"] = list(results.get("uris", []))
        loop.quit()

    subscription = bus.signal_subscribe(
        _BUS, _REQUEST, "Response", request, None, Gio.DBusSignalFlags.NONE, on_response)
    options = {
        "handle_token": GLib.Variant("s", token),
        "directory": GLib.Variant("b", True),
    }
    folder = os.path.expanduser(start or "")
    while folder and not os.path.isdir(folder):
        parent = os.path.dirname(folder)
        if parent == folder:
            folder = ""
        else:
            folder = parent
    if folder:
        options["current_folder"] = GLib.Variant("ay", folder.encode() + b"\0")
    try:
        bus.call_sync(
            _BUS, _PATH, _CHOOSER, "OpenFile",
            GLib.Variant("(ssa{sv})", ("", title, options)), GLib.VariantType("(o)"),
            Gio.DBusCallFlags.NONE, -1, None)
        expiry = GLib.timeout_source_new_seconds(_TIMEOUT_SECONDS)
        expiry.set_callback(lambda *_: loop.quit() or False)
        expiry.attach(context)
        loop.run()
        expiry.destroy()
    finally:
        bus.signal_unsubscribe(subscription)
        context.pop_thread_default()

    if answer.get("code") != 0 or not answer.get("uris"):
        return None
    uri = urlparse(answer["uris"][0])
    return str(Path(unquote(uri.path))) if uri.scheme == "file" else None


def main(argv: list[str]) -> int:
    """`check` prints 1 or 0; `pick TITLE [START]` prints the folder, or nothing
    when the dialog was cancelled. A separate process, so python-gobject stays
    an optional dependency of the daemon and the dialog gets its own main loop."""
    command = argv[1] if len(argv) > 1 else ""
    if command == "check":
        print("1" if available() else "0")
        return 0
    if command == "pick":
        try:
            chosen = pick_folder(argv[2] if len(argv) > 2 else "Choose a folder",
                                 argv[3] if len(argv) > 3 else "")
        except Exception:
            log.exception("Folder chooser failed")
            return 2
        print(chosen or "")
        return 0
    return 2


if __name__ == "__main__":
    import sys
    sys.exit(main(sys.argv))
