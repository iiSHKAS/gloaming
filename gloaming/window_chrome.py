"""Measure native decorations on the GUI thread; bridge reads only cached state."""


def gtk_has_titlebar(native):
    if not native.get_decorated():
        return False
    title = native.get_titlebar()
    if title is not None and title.get_mapped() and title.get_allocated_height() > 12:
        return True
    child = native.get_child()
    if child is not None and native.get_allocated_height() - child.get_allocated_height() > 12:
        return True
    window = native.get_window()
    if window is None:
        return None
    return window.get_frame_extents().height - window.get_height() > 12


class WindowChrome:
    def __init__(self, win):
        self.win = win
        self.has_titlebar = None
        self._timer = None

    def snapshot(self):
        return {'has_titlebar': self.has_titlebar}

    def install(self):
        native = self.win.native
        if hasattr(native, 'get_decorated'):
            from gi.repository import GLib

            def refresh():
                if native.get_window() is not None:
                    self.has_titlebar = gtk_has_titlebar(native)
                return True

            refresh()
            source = GLib.timeout_add(750, refresh)
            native.connect('destroy', lambda *_: GLib.source_remove(source))
        elif hasattr(native, 'frameGeometry'):
            from qtpy.QtCore import QTimer, Qt
            timer = QTimer(native)

            def refresh():
                if native.windowFlags() & Qt.WindowType.FramelessWindowHint:
                    self.has_titlebar = False
                else:
                    handle = native.windowHandle()
                    top = handle.frameMargins().top() if handle else 0
                    self.has_titlebar = top > 12 or native.frameGeometry().height() - native.geometry().height() > 12

            timer.timeout.connect(refresh)
            timer.start(750)
            self._timer = timer
            refresh()
