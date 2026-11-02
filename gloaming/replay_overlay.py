"""Interactive replay window. Only the child owns GTK and WebKit."""
from __future__ import annotations
import asyncio
import logging
import os
import sys
from pathlib import Path

log = logging.getLogger(__name__)


class ReplayOverlayHost:
    def __init__(self):
        self.process = None
        self.lock = asyncio.Lock()

    async def toggle(self, port: int, controller: bool = False):
        await self._open(port, ['--controller'] if controller else [])

    async def menu(self, port: int, buffer_seconds: int):
        """The hold-menu: pick how much of the buffer to save, with the controller."""
        if self.process is None or self.process.returncode is not None:
            await self._open(port, ['--menu', str(int(buffer_seconds))])

    async def replace(self, port: int):
        """Swap whatever panel is open (the hold-menu) for the controller replay overlay."""
        async with self.lock:
            await self.stop()
            log.info('Replay overlay: opening from the hold-menu')
            self.process = await asyncio.create_subprocess_exec(
                sys.executable, '-m', 'gloaming.replay_overlay', str(port), '--controller',
                stdin=asyncio.subprocess.PIPE,
            )

    async def _open(self, port: int, extra):
        async with self.lock:
            if self.process is not None and self.process.returncode is None:
                log.info('Replay overlay: closing because the open shortcut fired again')
                await self.stop()
                return
            log.info('Replay overlay: opening %s', extra)
            self.process = await asyncio.create_subprocess_exec(
                sys.executable, '-m', 'gloaming.replay_overlay', str(port), *extra,
                stdin=asyncio.subprocess.PIPE,
            )

    async def stop(self):
        proc, self.process = self.process, None
        if proc is None or proc.returncode is not None:
            return
        if proc.stdin:
            proc.stdin.close()
        try:
            await asyncio.wait_for(proc.wait(), 3)
        except asyncio.TimeoutError:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 2)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()


def gnome_bridge_available():
    """Only use the native GNOME path when its compositor bridge is active."""
    try:
        from gi.repository import Gio, GLib
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        reply = bus.call_sync(
            'dev.basilforge.GloamingOverlay', '/dev/basilforge/GloamingOverlay',
            'dev.basilforge.GloamingOverlay', 'Version', None, GLib.VariantType('(i)'),
            Gio.DBusCallFlags.NO_AUTO_START, 500, None)
        return reply.unpack()[0] == 1
    except Exception:
        return False


def main():
    # Prefer native Wayland with the GNOME compositor bridge. Other Wayland
    # desktops use layer-shell; XWayland remains a compatibility fallback.
    desktop = os.environ.get('XDG_CURRENT_DESKTOP', '').lower()
    native_gnome = ('gnome' in desktop and bool(os.environ.get('WAYLAND_DISPLAY'))
                    and (gnome_bridge_available() or os.environ.get('GLOAMING_REPLAY_BACKEND') == 'native'))
    if native_gnome:
        os.environ['GDK_BACKEND'] = 'wayland'
        # Do not inherit X11 scale overrides: GDK negotiates each Wayland output.
        os.environ.pop('GDK_SCALE', None)
        os.environ.pop('GDK_DPI_SCALE', None)
    elif 'gnome' in desktop and os.environ.get('DISPLAY'):
        log.warning('Native replay bridge is inactive; XWayland fallback may blur at fractional scale. '
                    'Enable gloaming-overlay@basilforge.local and sign out/in once after installation.')
        os.environ['GDK_BACKEND'] = 'x11'
    plugins = Path.home() / '.local/share/gloaming-dev/gstreamer-1.0'
    if plugins.is_dir():
        os.environ['GST_PLUGIN_PATH'] = str(plugins) + ':' + os.environ.get('GST_PLUGIN_PATH', '')
    import gi
    gi.require_version('Gtk', '3.0')
    gi.require_version('Gdk', '3.0')
    gi.require_version('WebKit2', '4.1')
    from gi.repository import Gtk, Gdk, GLib, WebKit2
    display = Gdk.Display.get_default()
    if display is None:
        raise RuntimeError('Replay overlay requires a desktop session')
    wayland = 'wayland' in type(display).__name__.lower()
    layer = None
    if wayland and not native_gnome:
        try:
            gi.require_version('GtkLayerShell', '0.1')
            from gi.repository import GtkLayerShell
            if GtkLayerShell.is_supported():
                layer = GtkLayerShell
        except (ValueError, ImportError):
            pass
        if layer is None:
            if os.environ.get('DISPLAY'):
                os.execve(sys.executable, [sys.executable, '-m', 'gloaming.replay_overlay', *sys.argv[1:]], dict(os.environ, GDK_BACKEND='x11'))
            raise RuntimeError('Replay overlay requires layer-shell or XWayland')
    from .config import load as load_config
    recording = load_config().recording
    app = None
    if native_gnome:
        from gi.repository import Gio
        GLib.set_prgname('dev.basilforge.GloamingReplay')
        app = Gtk.Application(application_id='dev.basilforge.GloamingReplay', flags=Gio.ApplicationFlags.NON_UNIQUE)
        app.register(None)
        win = Gtk.ApplicationWindow(application=app)
    else:
        win = Gtk.Window()
    connector = recording.display if not recording.follow_mouse_display else None
    win.set_title(f'Gloaming Replay [{connector}]' if connector else 'Gloaming Replay')
    win.set_app_paintable(True)
    visual = win.get_screen().get_rgba_visual()
    if visual is not None:
        win.set_visual(visual)
    css = Gtk.CssProvider()
    css.load_from_data(b'window { background-color: transparent; }')
    win.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    win.set_decorated(False)
    win.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
    win.set_keep_above(True)
    win.set_skip_taskbar_hint(True)
    win.set_skip_pager_hint(True)
    if layer:
        layer.init_for_window(win)
        layer.set_namespace(win, 'gloaming-replay')
        layer.set_layer(win, layer.Layer.OVERLAY)
        layer.set_keyboard_mode(win, layer.KeyboardMode.EXCLUSIVE)
        layer.set_exclusive_zone(win, -1)
    elif not native_gnome:
        win.connect('realize', lambda *_: win.get_window().set_override_redirect(True))
    pointer = display.get_default_seat().get_pointer().get_position()
    monitor = display.get_monitor_at_point(pointer.x, pointer.y) or display.get_monitor(0)
    if recording.display and not recording.follow_mouse_display:
        for index in range(display.get_n_monitors()):
            candidate = display.get_monitor(index)
            if candidate.get_model() == recording.display:
                monitor = candidate
                break
    geo = monitor.get_geometry()
    if layer:
        layer.set_monitor(win, monitor)
        for edge in (layer.Edge.TOP, layer.Edge.BOTTOM, layer.Edge.LEFT, layer.Edge.RIGHT):
            layer.set_anchor(win, edge, True)
    # Cover the monitor with an alpha surface, not an opaque application window.
    width, height = geo.width, geo.height
    if native_gnome:
        # Match the compositor bridge's floating bounds. Fullscreen Wayland
        # windows receive an opaque black backdrop from Mutter.
        width, height = min(1000, width - 48), min(960, height - 80)
    win.set_default_size(width, height)
    if not layer and not native_gnome:
        win.move(geo.x + (geo.width-width)//2, geo.y + (geo.height-height)//2)
    manager = WebKit2.UserContentManager()
    manager.register_script_message_handler('gloamingOverlay')
    def page_closed(_manager, result):
        try:
            reason = result.get_js_value().to_string()
        except Exception:
            reason = '?'
        print(f'[replay-overlay] closing: page asked ({reason})', file=sys.stderr, flush=True)
        Gtk.main_quit()
    manager.connect('script-message-received::gloamingOverlay', page_closed)
    manager.register_script_message_handler('gloamingReplayFullscreen')
    def page_fullscreen(_manager, result):
        # Layer-shell/X11 overlays already cover the monitor. GNOME starts
        # with a floating window and needs a native resize as well.
        if not native_gnome:
            return
        action = result.get_js_value().to_string()
        if action == 'enter':
            win.fullscreen()
        elif action == 'exit':
            win.unfullscreen()
    manager.connect('script-message-received::gloamingReplayFullscreen', page_fullscreen)
    if '--design-test' in sys.argv:
        # A running daemon may still emit its old immutable asset key. Give
        # every lab run a fresh cache, without clearing the main app's data.
        context = WebKit2.WebContext.new_ephemeral()
        view = WebKit2.WebView(web_context=context, user_content_manager=manager)
    else:
        view = WebKit2.WebView(user_content_manager=manager)
        # Pick up rebuilt assets even when an older daemon still serves its
        # previous immutable revision. Keep local storage and preferences.
        view.get_context().clear_cache()
    transparent = Gdk.RGBA(0, 0, 0, 0)
    view.set_background_color(transparent)
    # Apply before the page paints so the boot screen cannot flash opaque.
    manager.add_style_sheet(WebKit2.UserStyleSheet(
        'html,body,#root {background:transparent!important;} #boot {display:none!important;}',
        WebKit2.UserContentInjectedFrames.TOP_FRAME,
        WebKit2.UserStyleLevel.USER, None, None))
    view.get_settings().set_enable_mediasource(True)
    view.get_settings().set_media_playback_requires_user_gesture(False)
    def navigation(_view, decision, kind):
        if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            uri = decision.get_navigation_action().get_request().get_uri()
            if not uri.startswith(f'http://127.0.0.1:{int(sys.argv[1])}/'):
                decision.ignore()
                return True
        return False
    view.connect('decide-policy', navigation)
    win.add(view)
    def destroyed(*_):
        print('[replay-overlay] closing: window destroyed by the compositor/toolkit', file=sys.stderr, flush=True)
        if Gtk.main_level():
            Gtk.main_quit()
    win.connect('destroy', destroyed)
    def key(_win, event):
        # The page owns Esc: it leaves fullscreen, cancels a trim, then closes. Until it has
        # loaded (nothing to cancel yet) Esc closes the window directly.
        if event.keyval == Gdk.KEY_Escape and not loaded['page']:
            print('[replay-overlay] closing: Escape before the page loaded', file=sys.stderr, flush=True)
            Gtk.main_quit()
            return True
        return False
    loaded = {'page': False}
    view.connect('load-changed', lambda _v, ev: loaded.update(page=True) if ev == WebKit2.LoadEvent.FINISHED else None)
    win.connect('key-press-event', key)
    query = '&controller=1' if '--controller' in sys.argv else ''
    if '--design-test' in sys.argv:
        query += '&overlayDesign=test'
    if '--menu' in sys.argv:
        query = f"&saveMenu={int(sys.argv[sys.argv.index('--menu') + 1])}"
    view.load_uri(f'http://127.0.0.1:{int(sys.argv[1])}/?replayOverlay=1' + query)
    win.show_all()
    view.grab_focus()
    if not layer and not native_gnome:
        win.get_window().raise_()
        win.get_window().focus(Gdk.CURRENT_TIME)
    # Parent EOF closes the panel even if the browser is still loading.
    GLib.io_add_watch(sys.stdin.fileno(), GLib.IOCondition.HUP | GLib.IOCondition.IN,
                      lambda *_: (print('[replay-overlay] closing: parent pipe event', file=sys.stderr, flush=True), Gtk.main_quit(), False)[2])
    Gtk.main()
    win.destroy()


if __name__ == '__main__':
    main()
