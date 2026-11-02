"""A short-lived notice drawn on the monitor that is being recorded.

The status island lives inside the Gloaming window, which is usually on another
screen than the game. This is a click-through popup placed on the recorded
monitor, so "clip saved" is visible where the player is looking. It exits by
itself.

    python -m gloaming.toast_overlay KIND TITLE DETAIL MONITOR ACCENT

KIND is saved, error or info. MONITOR is a connector name such as DP-3, or empty.
"""

from __future__ import annotations

import math
import os
import sys
import time

from .key_overlay import _rgb, _rounded

HOLD = 3.0
SLIDE_IN = .45
SLIDE_OUT = .38
CARD_W, CARD_H = 430, 104
EDGE = 28
TOP_MARGIN = 32
PAD = 14                       # room for the soft shadow around the card
WIN_W = CARD_W + EDGE + PAD * 2
WIN_H = CARD_H + PAD * 2


def _ease_out(t: float) -> float:
    return 1 - (1 - max(0.0, min(1.0, t))) ** 4


def _ease_in(t: float) -> float:
    return max(0.0, min(1.0, t)) ** 3


def _draw(cr, kind: str, title: str, detail: str, accent: str, shift: float, remaining: float, t: float) -> None:
    """The card, `shift` pixels right of its resting place (it slides in from the screen edge).

    `t` is seconds since the toast started: it drives the check mark drawing itself and the pulse.
    """
    import cairo
    colour = {"saved": accent, "error": "#ff6b6b"}.get(kind, "#aeb3bb")
    eyebrow = {"saved": "CLIP SAVED", "error": "CLIP FAILED"}.get(kind, "GLOAMING")
    cr.translate(PAD + shift, PAD)
    for i in range(9, 0, -1):
        _rounded(cr, -i, -i + 5, CARD_W + 2 * i, CARD_H + 2 * i, 26 + i)
        cr.set_source_rgba(0, 0, 0, .03)
        cr.fill()
    # Body: a vertical gradient with a faint wash of the accent from the icon side.
    _rounded(cr, 0, 0, CARD_W, CARD_H, 26)
    body = cairo.LinearGradient(0, 0, 0, CARD_H)
    body.add_color_stop_rgba(0, *_rgb("#20232a", 1))
    body.add_color_stop_rgba(1, *_rgb("#121418", 1))
    cr.set_source(body)
    cr.fill_preserve()
    cr.save()
    cr.clip_preserve()
    wash = cairo.RadialGradient(44, CARD_H / 2, 4, 44, CARD_H / 2, 190)
    wash.add_color_stop_rgba(0, *_rgb(colour, .30))
    wash.add_color_stop_rgba(1, *_rgb(colour, 0))
    cr.set_source(wash)
    cr.paint()
    cr.restore()
    _rounded(cr, .75, .75, CARD_W - 1.5, CARD_H - 1.5, 25.5)
    edge = cairo.LinearGradient(0, 0, CARD_W, 0)
    edge.add_color_stop_rgba(0, *_rgb(colour, .75))
    edge.add_color_stop_rgba(.5, *_rgb("#ffffff", .10))
    edge.add_color_stop_rgba(1, *_rgb("#ffffff", .06))
    cr.set_source(edge)
    cr.set_line_width(1.5)
    cr.stroke()

    cx, cy = 20 + 29, CARD_H / 2
    # One pulse ring after it lands.
    pulse = (t - SLIDE_IN) / .9
    if 0 <= pulse <= 1:
        cr.arc(cx, cy, 29 + 16 * _ease_out(pulse), 0, 2 * math.pi)
        cr.set_source_rgba(*_rgb(colour, .55 * (1 - pulse)))
        cr.set_line_width(2.5)
        cr.stroke()
    disc = cairo.LinearGradient(cx, cy - 29, cx, cy + 29)
    disc.add_color_stop_rgba(0, *_rgb(colour, 1))
    disc.add_color_stop_rgba(1, *_rgb(colour, .78))
    cr.arc(cx, cy, 29, 0, 2 * math.pi)
    cr.set_source(disc)
    cr.fill()
    # The mark draws itself.
    if kind == "saved":
        strokes = [[(cx - 12, cy + 1), (cx - 4, cy + 9), (cx + 13, cy - 9)]]
    elif kind == "error":
        strokes = [[(cx - 10, cy - 10), (cx + 10, cy + 10)], [(cx + 10, cy - 10), (cx - 10, cy + 10)]]
    else:
        strokes = [[(cx, cy - 12), (cx, cy + 3)], [(cx, cy + 11), (cx, cy + 11.1)]]
    draw_p = max(0.0, min(1.0, (t - SLIDE_IN * .55) / .35))
    lengths = [sum(math.dist(a, b) for a, b in zip(path, path[1:])) for path in strokes]
    budget = draw_p * sum(lengths)
    cr.set_source_rgba(*_rgb("#0b0c0e", 1))
    cr.set_line_width(4.6)
    cr.set_line_cap(1)
    cr.set_line_join(1)
    for path, length in zip(strokes, lengths):
        take = min(budget, length)
        budget -= take
        if take <= 0:
            continue
        cr.move_to(*path[0])
        left = take
        for a, b in zip(path, path[1:]):
            seg = math.dist(a, b)
            if left >= seg:
                cr.line_to(*b)
                left -= seg
            else:
                k = left / seg
                cr.line_to(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)
                break
        cr.stroke()

    left = 20 + 58 + 18
    cr.select_font_face("sans-serif", 0, 1)
    cr.set_font_size(11)
    cr.set_source_rgba(*_rgb(colour, 1))
    cr.move_to(left, cy - 17)
    # Letter-spaced eyebrow.
    for ch in eyebrow:
        cr.show_text(ch)
        x, y = cr.get_current_point()
        cr.move_to(x + 1.8, y)
    cr.set_font_size(22)
    cr.set_source_rgba(*_rgb("#ffffff", 1))
    cr.move_to(left, cy + 7)
    cr.show_text(title)
    if detail:
        cr.select_font_face("sans-serif", 0, 0)
        cr.set_font_size(14)
        cr.set_source_rgba(*_rgb("#aab0b9", 1))
        cr.move_to(left, cy + 28)
        cr.show_text(detail if len(detail) < 36 else detail[:33] + "…")
    cr.save()
    _rounded(cr, 0, 0, CARD_W, CARD_H, 26)
    cr.clip()
    cr.rectangle(0, CARD_H - 4, CARD_W * max(0.0, remaining), 4)
    cr.set_source_rgba(*_rgb(colour, .95))
    cr.fill()
    cr.restore()


def main() -> int:
    kind, title, detail, monitor_name, accent = (sys.argv[1:6] + [""] * 5)[:5]
    accent = accent or "#8ab9f3"
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, GLib, Gtk

    display = Gdk.Display.get_default()
    wayland = "wayland" in type(display).__name__.lower()
    layer = None
    if wayland:
        try:
            gi.require_version("GtkLayerShell", "0.1")
            from gi.repository import GtkLayerShell
            if GtkLayerShell.is_supported():
                layer = GtkLayerShell
        except (ImportError, ValueError):
            pass
        if layer is None:
            # GNOME has no layer-shell: the XWayland popup path stays above a fullscreen game.
            if os.environ.get("DISPLAY") and os.environ.get("GDK_BACKEND") != "x11":
                os.execve(sys.executable, [sys.executable, "-m", "gloaming.toast_overlay", *sys.argv[1:]],
                          dict(os.environ, GDK_BACKEND="x11"))
            return 3

    monitor = None
    for index in range(display.get_n_monitors()):
        candidate = display.get_monitor(index)
        if monitor_name and candidate.get_model() == monitor_name:
            monitor = candidate
            break
    if monitor is None:
        monitor = display.get_primary_monitor() or display.get_monitor(0)
    geo = monitor.get_geometry()

    win = Gtk.Window(type=Gtk.WindowType.TOPLEVEL if wayland else Gtk.WindowType.POPUP)
    win.set_title("Gloaming notice")
    win.set_app_paintable(True)
    win.set_decorated(False)
    win.set_accept_focus(False)
    win.set_focus_on_map(False)
    win.set_skip_taskbar_hint(True)
    win.set_default_size(WIN_W, WIN_H)
    visual = win.get_screen().get_rgba_visual()
    if visual is not None:
        win.set_visual(visual)
    if layer:
        layer.init_for_window(win)
        layer.set_namespace(win, "gloaming-toast")
        layer.set_layer(win, layer.Layer.OVERLAY)
        layer.set_keyboard_mode(win, layer.KeyboardMode.NONE)
        layer.set_monitor(win, monitor)
        layer.set_anchor(win, layer.Edge.TOP, True)
        layer.set_anchor(win, layer.Edge.RIGHT, True)
        layer.set_margin(win, layer.Edge.TOP, TOP_MARGIN - PAD)
        layer.set_margin(win, layer.Edge.RIGHT, 0)
    else:
        win.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
        win.set_keep_above(True)
        # Flush with the screen edge, so the card slides in from beyond it.
        win.move(geo.x + geo.width - WIN_W, geo.y + TOP_MARGIN - PAD)

    started = time.monotonic()
    total = SLIDE_IN + HOLD + SLIDE_OUT
    area = Gtk.DrawingArea()

    def on_draw(_widget, cr):
        t = time.monotonic() - started
        if t < SLIDE_IN:
            shift = (1 - _ease_out(t / SLIDE_IN)) * (CARD_W + EDGE + PAD)
        elif t < SLIDE_IN + HOLD:
            shift = 0
        else:
            shift = _ease_in((t - SLIDE_IN - HOLD) / SLIDE_OUT) * (CARD_W + EDGE + PAD)
        remaining = 1 - max(0.0, t - SLIDE_IN) / HOLD
        _draw(cr, kind, title, detail, accent, shift, remaining, t)
        return True

    def tick():
        if time.monotonic() - started >= total:
            Gtk.main_quit()
            return False
        area.queue_draw()
        return True

    def click_through(*_):
        import cairo
        window = win.get_window()
        if window is not None:
            window.input_shape_combine_region(cairo.Region(), 0, 0)

    area.connect("draw", on_draw)
    win.add(area)
    win.connect("realize", click_through)
    win.connect("map-event", click_through)
    win.show_all()
    click_through()
    GLib.timeout_add(16, tick)
    Gtk.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
