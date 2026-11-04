"""Qt and GTK/AppIndicator tray integration and single-window activation.

Close stops the recorder and shortcuts. Explicit minimize retains the same
GUI process and lock, using the taskbar when no system tray host is present.
"""

from __future__ import annotations

import os
import socket
import threading
from pathlib import Path
from typing import Any, Callable, Iterable


class _ActivationServer:
    """Receive requests from later ``gloaming-app`` launches to show the window."""

    def __init__(
        self,
        socket_path: Path,
        show_window: Callable[[], None],
        logger: Any,
    ) -> None:
        self._socket_path = socket_path
        self._show_window = show_window
        self._log = logger
        self._socket: socket.socket | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._socket_path.parent.mkdir(parents=True, exist_ok=True)
        self._socket_path.unlink(missing_ok=True)

        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(self._socket_path))
        os.chmod(self._socket_path, 0o600)
        server.listen(4)
        server.settimeout(0.5)
        self._socket = server
        self._thread = threading.Thread(
            target=self._serve,
            name="gloaming-window-activation",
            daemon=True,
        )
        self._thread.start()
        self._log.info("Window activation socket ready at %s", self._socket_path)

    def _serve(self) -> None:
        assert self._socket is not None
        while not self._stop.is_set():
            try:
                conn, _ = self._socket.accept()
            except socket.timeout:
                continue
            except OSError:
                break

            with conn:
                try:
                    command = conn.recv(64).strip().lower()
                except OSError:
                    continue

            if command == b"show":
                try:
                    self._show_window()
                except Exception:
                    self._log.exception("Could not restore Gloaming window")

    def close(self) -> None:
        self._stop.set()
        if self._socket is not None:
            try:
                self._socket.close()
            except OSError:
                pass
            self._socket = None
        self._socket_path.unlink(missing_ok=True)


def request_window_activation(socket_path: Path, timeout: float = 0.75) -> bool:
    """Ask an existing Gloaming GUI process to restore its window."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect(str(socket_path))
            sock.sendall(b"show\n")
        return True
    except OSError:
        return False


class WindowTrayController:
    """Own tray lifecycle and explicit close/minimize semantics."""

    def __init__(
        self,
        *,
        win: Any,
        socket_path: Path,
        icon_paths: Iterable[Path],
        shutdown_daemon: Callable[[], None],
        close_window: Callable[[], None],
        logger: Any,
        options: Callable[[], dict] | None = None,
        start_hidden: bool = False,
    ) -> None:
        self._options = options or (lambda: {})
        self._start_hidden = start_hidden
        self._win = win
        self._icon_paths = tuple(icon_paths)
        self._shutdown_daemon = shutdown_daemon
        self._close_window = close_window
        self._log = logger
        self._server = _ActivationServer(socket_path, self.show_window, logger)
        self._tray_available = False
        self._tray: Any = None
        self._menu: Any = None
        self._dispatcher: Any = None
        self._native: Any = None
        self._open_action: Any = None
        self._quit_action: Any = None
        self._activated: Any = None
        self._open_label = "Open Gloaming"
        self._quit_label = "Quit Gloaming"
        self._shutdown_complete = False
        self._quitting = False
        self._closed = False

    def start(self) -> None:
        """Attach public pywebview lifecycle hooks and start activation IPC."""
        try:
            self._server.start()
        except OSError as exc:
            self._log.warning("Could not create window activation socket: %s", exc)

        self._win.events.before_show += self._before_show
        self._win.events.closing += self._on_closing
        self._win.events.closed += self.close

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._clear_tray()
        self._server.close()

    def _clear_tray(self) -> None:
        """Drop tray objects when the native backend changes or closes."""
        if self._tray is not None:
            try:
                self._tray.hide()
            except Exception as exc:
                # The Qt C++ object may already have been deleted during a
                # failed backend startup. Clearing Python state is enough.
                self._log.debug("Tray icon was already gone: %s", exc)
        self._tray_available = False
        self._tray = None
        self._menu = None
        self._dispatcher = None
        self._native = None
        self._open_action = None
        self._quit_action = None
        self._activated = None

    def _before_show(self) -> None:
        """Install the Qt tray once ``window.native`` is publicly available."""
        try:
            import gi
            gi.require_version('Gtk', '3.0')
            from gi.repository import Gtk, GLib
            if isinstance(self._win.native, Gtk.Window):
                GLib.idle_add(self._install_gtk)
                return
        except (ImportError, ValueError):
            pass
        try:
            from qtpy import QtCore
            from qtpy.QtGui import QIcon, QGuiApplication
            from qtpy.QtWidgets import QMainWindow, QMenu, QSystemTrayIcon
        except ImportError:
            self._log.debug("Qt tray integration unavailable on this webview backend")
            return

        native = self._win.native
        if native is self._native and self._tray_available:
            return
        if self._native is not None and native is not self._native:
            self._clear_tray()
        self._native = native

        if not isinstance(native, QMainWindow):
            self._log.debug(
                "Tray integration skipped for non-Qt native window %s",
                type(native).__name__,
            )
            return

        QGuiApplication.setDesktopFileName('gloaming')
        window_icon = self._load_icon(QIcon)
        if not window_icon.isNull():
            native.setWindowIcon(window_icon)

        if not QSystemTrayIcon.isSystemTrayAvailable():
            # Crucial for GNOME/other sessions without a tray host: do not
            # turn the X button into a hide operation with nowhere to restore
            # the window from. Existing upstream close behavior remains intact.
            self._log.info("No system tray host detected; tray behavior disabled")
            return

        controller = self

        class _QtDispatcher(QtCore.QObject):
            show_requested = QtCore.Signal()
            hide_requested = QtCore.Signal()
            close_requested = QtCore.Signal()
            labels_requested = QtCore.Signal(str, str)
            drag_requested = QtCore.Signal()
            resize_requested = QtCore.Signal(str)
            maximize_requested = QtCore.Signal()
            minimize_requested = QtCore.Signal()
            window_close_requested = QtCore.Signal()

            def __init__(self) -> None:
                super().__init__(native)
                self.drag_requested.connect(lambda: native.windowHandle().startSystemMove())
                self.resize_requested.connect(self.start_resize)
                self.maximize_requested.connect(
                    lambda: native.showNormal() if native.isMaximized() else native.showMaximized())
                self.minimize_requested.connect(native.showMinimized)
                self.window_close_requested.connect(native.close)
                self.show_requested.connect(self.show_window)
                self.hide_requested.connect(native.hide)
                self.close_requested.connect(self.close_window)
                self.labels_requested.connect(self.set_labels)

            @QtCore.Slot()
            def show_window(self) -> None:
                native.showNormal()
                native.show()
                native.raise_()
                native.activateWindow()
                handle = native.windowHandle()
                if handle is not None:
                    try:
                        handle.requestActivate()
                    except Exception as exc:
                        controller._log.debug("Window activation request failed: %s", exc)

            @QtCore.Slot(str)
            def start_resize(self, edge: str) -> None:
                Qt = QtCore.Qt.Edge
                edges = {"n": Qt.TopEdge, "s": Qt.BottomEdge, "w": Qt.LeftEdge, "e": Qt.RightEdge,
                         "nw": Qt.TopEdge | Qt.LeftEdge, "ne": Qt.TopEdge | Qt.RightEdge,
                         "sw": Qt.BottomEdge | Qt.LeftEdge, "se": Qt.BottomEdge | Qt.RightEdge}
                if edge in edges:
                    native.windowHandle().startSystemResize(edges[edge])

            @QtCore.Slot()
            def close_window(self) -> None:
                if controller._tray is not None:
                    controller._tray.hide()
                native.close()

            @QtCore.Slot(str, str)
            def set_labels(self, open_label: str, quit_label: str) -> None:
                if controller._open_action is not None:
                    controller._open_action.setText(open_label)
                if controller._quit_action is not None:
                    controller._quit_action.setText(quit_label)

        self._dispatcher = _QtDispatcher()
        icon = self._load_icon(QIcon)
        if icon.isNull():
            icon = native.windowIcon()
        else:
            native.setWindowIcon(icon)

        menu = QMenu(native)
        open_action = menu.addAction(self._open_label)
        open_action.triggered.connect(self.show_window)
        menu.addSeparator()
        quit_action = menu.addAction(self._quit_label)
        quit_action.triggered.connect(self.quit)

        tray = QSystemTrayIcon(icon, native)
        tray.setToolTip("Gloaming")
        tray.setContextMenu(menu)

        def _activated(reason: Any) -> None:
            reasons = QSystemTrayIcon.ActivationReason
            if reason in (reasons.Trigger, reasons.DoubleClick):
                self.show_window()

        tray.activated.connect(_activated)
        tray.show()

        # Keep Python wrappers alive for the lifetime of the native window.
        self._tray = tray
        self._menu = menu
        self._open_action = open_action
        self._quit_action = quit_action
        self._activated = _activated
        self._tray_available = True
        self._log.info("Gloaming system tray icon enabled")

        class _MinimizeFilter(QtCore.QObject):
            def eventFilter(self, obj: Any, event: Any) -> bool:
                if (event.type() == QtCore.QEvent.Type.WindowStateChange and native.isMinimized()
                        and controller._hide_if_minimized()):
                    QtCore.QTimer.singleShot(0, lambda: (native.setWindowState(QtCore.Qt.WindowState.WindowNoState),
                                                         native.hide()))
                return False

        self._minimize_filter = _MinimizeFilter(native)
        native.installEventFilter(self._minimize_filter)
        if self._start_hidden:
            QtCore.QTimer.singleShot(0, native.hide)

    def _install_gtk(self) -> bool:
        """AppIndicator is the GTK/Wayland tray protocol used by Tauri on Linux."""
        import gi
        from gi.repository import Gtk, GLib, Gio
        native = self._win.native
        if self._native is native and self._dispatcher is not None:
            return False
        self._native = native
        icon = next((p for p in self._icon_paths if p.is_file()), None)
        if icon:
            native.set_icon_from_file(str(icon))
            Gtk.Window.set_default_icon_from_file(str(icon))
        native.set_icon_name('gloaming')

        class Signal:
            def __init__(self, callback): self.callback = callback
            def emit(self, *args):
                def run():
                    self.callback(*args)
                    return False
                GLib.idle_add(run)

        controller = self
        class Dispatcher:
            show_requested = Signal(lambda: (native.show_all(), native.deiconify(), native.present()))
            hide_requested = Signal(native.hide)
            close_requested = Signal(native.close)
            labels_requested = Signal(lambda a, b: controller._set_gtk_labels(a, b))
        self._dispatcher = Dispatcher()
        from gi.repository import Gdk

        def on_state(_widget, event):
            iconified = bool(event.changed_mask & Gdk.WindowState.ICONIFIED
                             and event.new_window_state & Gdk.WindowState.ICONIFIED)
            if iconified and controller._hide_if_minimized():
                # Un-minimize first, so showing it from the tray later brings back a normal window.
                GLib.idle_add(lambda: (native.deiconify(), native.hide(), False)[2])
            return False
        native.connect('window-state-event', on_state)
        try:
            try:
                gi.require_version('AyatanaAppIndicator3', '0.1')
                from gi.repository import AyatanaAppIndicator3 as Indicator
            except (ImportError, ValueError):
                gi.require_version('AppIndicator3', '0.1')
                from gi.repository import AppIndicator3 as Indicator
            bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
            available = bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'NameHasOwner',
                GLib.Variant('(s)', ('org.kde.StatusNotifierWatcher',)),
                GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, 1000, None).unpack()[0]
            if not available:
                self._log.info('No AppIndicator tray host; minimize uses the taskbar')
                if self._start_hidden:
                    GLib.idle_add(lambda: (native.iconify(), False)[1])
                return False
            # An AppImage's icon lives in a private FUSE mount the tray host
            # often cannot read. Like Tauri's tray-icon, copy it to a real
            # directory and hand that over as the indicator's theme path.
            theme_dir, icon_name = self._stage_tray_icon(icon)
            indicator = Indicator.Indicator.new_with_path(
                'gloaming', icon_name or 'gloaming',
                Indicator.IndicatorCategory.APPLICATION_STATUS, theme_dir or '')
            indicator.set_title('Gloaming')
            menu = Gtk.Menu()
            self._open_action = Gtk.MenuItem(label=self._open_label)
            self._open_action.connect('activate', lambda *_: self.show_window())
            self._quit_action = Gtk.MenuItem(label=self._quit_label)
            self._quit_action.connect('activate', lambda *_: self.quit())
            for item in (self._open_action, Gtk.SeparatorMenuItem(), self._quit_action): menu.append(item)
            menu.show_all()
            indicator.set_menu(menu)
            indicator.set_status(Indicator.IndicatorStatus.ACTIVE)
            class Tray:
                def hide(self):
                    GLib.idle_add(lambda: (indicator.set_status(Indicator.IndicatorStatus.PASSIVE), False)[1])
            self._tray = Tray()
            self._menu = menu
            self._tray_available = True
            self._log.info('Gloaming GTK AppIndicator tray icon enabled')
            if self._start_hidden:
                GLib.idle_add(lambda: (native.hide(), False)[1])
        except Exception:
            self._log.exception('GTK tray unavailable; taskbar minimize remains available')
        return False

    def _stage_tray_icon(self, icon: Path | None) -> tuple[str | None, str | None]:
        """Copy the icon to a stable host-visible directory; return (dir, icon name)."""
        if icon is None:
            return None, None
        import hashlib
        import shutil
        try:
            digest = hashlib.sha1(icon.read_bytes()).hexdigest()[:10]
            base = Path(os.environ.get('XDG_RUNTIME_DIR') or Path.home() / '.cache')
            directory = base / 'gloaming-tray'
            directory.mkdir(parents=True, exist_ok=True)
            name = f'gloaming-tray-{digest}'
            target = directory / f'{name}{icon.suffix or ".png"}'
            if not target.is_file():
                shutil.copyfile(icon, target)
            return str(directory), name
        except OSError as exc:
            self._log.warning('Could not stage tray icon: %s', exc)
            return None, None

    def _set_gtk_labels(self, open_label, quit_label):
        if self._open_action is not None: self._open_action.set_label(open_label)
        if self._quit_action is not None: self._quit_action.set_label(quit_label)

    def _load_icon(self, QIcon: Any) -> Any:
        for path in self._icon_paths:
            if path.exists():
                icon = QIcon(str(path))
                if not icon.isNull():
                    self._log.debug("Using Gloaming tray icon from %s", path)
                    return icon
        return QIcon.fromTheme("gloaming")

    def _on_closing(self) -> bool | None:
        """Close means quit, unless "close to tray" is on and there is a tray to restore from."""
        if self._shutdown_complete:
            return None
        if not self._quitting and self._tray_available and self._option("close_to_tray"):
            self.hide_window()
            return False
        self.quit()
        return False

    def _option(self, name: str) -> bool:
        try:
            return bool(self._options().get(name))
        except Exception:
            self._log.debug("Could not read the window options", exc_info=True)
            return False

    def _hide_if_minimized(self) -> bool:
        """Called when the window was minimized: with "minimize to tray" on, hide it instead."""
        return self._tray_available and self._option("minimize_to_tray")

    def show_window(self) -> None:
        if self._dispatcher is not None:
            self._dispatcher.show_requested.emit()
            return
        # Public pywebview methods are safe for activation requests even
        # before the Qt before_show hook has run.
        try:
            self._win.restore()
        except Exception:
            self._log.debug("win.restore() failed while activating", exc_info=True)
        try:
            self._win.show()
        except Exception:
            self._log.debug("win.show() failed while activating", exc_info=True)

    @property
    def tray_available(self) -> bool:
        return self._tray_available

    def hide_window(self) -> None:
        if self._dispatcher is not None:
            self._dispatcher.hide_requested.emit()
            return
        self._win.hide()

    # ── the custom title bar: the page draws it and asks for these ──

    def _gtk_window(self) -> Any:
        native = self._win.native
        return native if hasattr(native, "begin_move_drag") else None

    def _pointer(self) -> tuple[int, int]:
        from gi.repository import Gdk
        _screen, x, y = Gdk.Display.get_default().get_default_seat().get_pointer().get_position()
        return int(x), int(y)

    def begin_drag(self) -> None:
        native = self._gtk_window()
        if native is not None:
            from gi.repository import Gdk, GLib
            x, y = self._pointer()
            GLib.idle_add(lambda: (native.begin_move_drag(1, x, y, Gdk.CURRENT_TIME), False)[1])
        elif self._dispatcher is not None:
            self._dispatcher.drag_requested.emit()

    def begin_resize(self, edge: str) -> None:
        native = self._gtk_window()
        if native is not None:
            from gi.repository import Gdk, GLib
            E = Gdk.WindowEdge
            edges = {"n": E.NORTH, "s": E.SOUTH, "w": E.WEST, "e": E.EAST, "nw": E.NORTH_WEST,
                     "ne": E.NORTH_EAST, "sw": E.SOUTH_WEST, "se": E.SOUTH_EAST}
            if edge in edges:
                x, y = self._pointer()
                GLib.idle_add(lambda: (native.begin_resize_drag(edges[edge], 1, x, y, Gdk.CURRENT_TIME), False)[1])
        elif self._dispatcher is not None:
            self._dispatcher.resize_requested.emit(edge)

    def minimize_window(self) -> None:
        """The title bar's minimize: to the tray when that option is on and there is a tray."""
        if self._tray_available and self._option("minimize_to_tray"):
            self.hide_window()
            return
        native = self._gtk_window()
        if native is not None:
            from gi.repository import GLib
            GLib.idle_add(lambda: (native.iconify(), False)[1])
        elif self._dispatcher is not None:
            self._dispatcher.minimize_requested.emit()
        else:
            self._win.minimize()

    def toggle_maximize(self) -> None:
        native = self._gtk_window()
        if native is not None:
            from gi.repository import GLib
            GLib.idle_add(lambda: ((native.unmaximize() if native.is_maximized() else native.maximize()), False)[1])
        elif self._dispatcher is not None:
            self._dispatcher.maximize_requested.emit()

    def is_maximized(self) -> bool:
        native = self._win.native
        try:
            if hasattr(native, "is_maximized"):
                return bool(native.is_maximized())
            if hasattr(native, "isMaximized"):
                return bool(native.isMaximized())
        except Exception:
            self._log.debug("Could not read the maximized state", exc_info=True)
        return False

    def request_close(self) -> None:
        """The title bar's close button: the same path as the system's close, so close-to-tray applies."""
        native = self._gtk_window()
        if native is not None:
            from gi.repository import GLib
            GLib.idle_add(lambda: (native.close(), False)[1])
        elif self._dispatcher is not None:
            self._dispatcher.window_close_requested.emit()
        else:
            self._win.destroy()

    def keep_running(self) -> None:
        """Hide to a supported tray or minimize without dropping the instance lock."""
        if self._tray_available:
            self.hide_window()
        else:
            self._win.minimize()

    def set_labels(self, open_label: str, quit_label: str) -> None:
        """Store translated action labels and update Qt actions on its thread."""
        if open_label:
            self._open_label = str(open_label)
        if quit_label:
            self._quit_label = str(quit_label)
        if self._dispatcher is not None:
            try:
                self._dispatcher.labels_requested.emit(self._open_label, self._quit_label)
            except Exception:
                self._log.debug("Could not update tray action labels", exc_info=True)

    def quit(self) -> None:
        """Stop recorder ownership completely, then close the GUI and tray."""
        if self._quitting:
            return
        self._quitting = True
        threading.Thread(
            target=self._shutdown_worker,
            name="gloaming-tray-quit",
            daemon=True,
        ).start()

    def _shutdown_worker(self) -> None:
        try:
            self._shutdown_daemon()
        except Exception:
            self._log.exception("Could not fully stop Gloaming during quit")
            self._quitting = False
            return

        self._shutdown_complete = True
        if self._dispatcher is not None:
            self._dispatcher.close_requested.emit()
        else:
            self._close_window()
