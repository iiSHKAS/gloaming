"""The DualSense drawing for the on-screen pad.

The silhouette, light bars and the outlines of the pressable parts are traced from a flat DualSense illustration
(gloaming/data/pad_ps5.json, in that illustration's 1080x675 coordinates); everything else is drawn here. Pressed
parts light up in the accent colour.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from importlib.resources import files

# What part of the 1080x675 illustration is used, and the margin around it.
X0, Y0, X1, Y1 = 196, 56, 884, 616
SIZE = (X1 - X0, Y1 - Y0)
DISPLAY_SCALE = .56

FACE = {"BTN_NORTH": ((756, 238), "triangle", "#43e0c5"), "BTN_WEST": ((705, 290), "square", "#ff7aa8"),
        "BTN_EAST": ((806, 290), "circle", "#ff6b6b"), "BTN_SOUTH": ((755, 340), "cross", "#7fb2ff")}
DPAD = {"BTN_DPAD_UP": ("up", (0, -1)), "BTN_DPAD_DOWN": ("down", (0, 1)),
        "BTN_DPAD_LEFT": ("left", (-1, 0)), "BTN_DPAD_RIGHT": ("right", (1, 0))}
STICKS = {"ls": ((429, 383), "BTN_THUMBL"), "rs": ((651, 383), "BTN_THUMBR")}


@lru_cache(maxsize=1)
def art() -> dict:
    return json.loads((files("gloaming") / "data" / "pad_ps5.json").read_text())


def _smooth(points, rounds: int = 2):
    """Chaikin corner cutting: the traced outlines are pixel-stepped, this turns them into curves."""
    pts = [tuple(p) for p in points]
    for _ in range(rounds):
        out = []
        for index, (x0, y0) in enumerate(pts):
            x1, y1 = pts[(index + 1) % len(pts)]
            out.append((.75 * x0 + .25 * x1, .75 * y0 + .25 * y1))
            out.append((.25 * x0 + .75 * x1, .25 * y0 + .75 * y1))
        pts = out
    return pts


@lru_cache(maxsize=None)
def _smooth_cached(key: str, index: int, rounds: int):
    source = art()
    polygon = source[key][index] if key in ("sil", "white", "blue") else source["shapes"][key]
    return _smooth(polygon, rounds)


def _trace(cr, pts) -> None:
    cr.move_to(*pts[0])
    for point in pts[1:]:
        cr.line_to(*point)
    cr.close_path()


def _mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def _hex(value: str):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _centroid(pts):
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


# The PlayStation mark in the artwork's coordinates, as three outlined pieces (engraved into the shell).
_LOGO = (
    [(312, 150), (330, 140), (400, 162), (438, 192), (446, 235), (446, 290), (378, 312), (365, 392), (312, 372)],
    [(305, 272), (212, 305), (195, 325), (205, 345), (250, 360), (312, 372), (312, 300)],
    [(446, 290), (500, 310), (515, 325), (505, 345), (430, 375), (365, 392), (378, 312)],
)


def _logo(cr, lit: float, accent, T) -> None:
    import cairo

    pieces = [[(490 + x / 7, 340 + y / 7) for x, y in piece] for piece in _LOGO]
    if lit:
        glow = cairo.RadialGradient(541, 378, 6, 541, 378, 46)
        glow.add_color_stop_rgba(0, *accent, .55 * lit)
        glow.add_color_stop_rgba(1, *accent, 0)
        cr.set_source(glow)
        cr.arc(541, 378, 46, 0, 2 * math.pi)
        cr.fill()
    cr.set_line_join(cairo.LINE_JOIN_ROUND)
    for piece in pieces:
        smooth = _smooth(piece, 2)
        # Engraving: a light edge just below, a dark groove, and the face slightly proud of it.
        cr.save()
        cr.translate(.5, .7)
        _trace(cr, smooth)
        cr.set_source_rgba(1, 1, 1, .12)
        cr.set_line_width(1.3)
        cr.stroke()
        cr.restore()
        _trace(cr, smooth)
        cr.set_source_rgb(*_mix(T['logo'], accent, lit * .8))
        cr.fill_preserve()
        cr.set_source_rgba(0, 0, 0, .8)
        cr.set_line_width(1.5)
        cr.stroke()
    # The seam where the stem meets the base.
    cr.move_to(490 + 375 / 7, 340 + 200 / 7)
    cr.line_to(490 + 375 / 7, 340 + 385 / 7)
    cr.set_source_rgba(0, 0, 0, .55)
    cr.set_line_width(1.1)
    cr.stroke()


def theme(scheme: dict, accent) -> dict:
    """Colours for the pad, taken from the app's accent scheme so it belongs to Gloaming rather than to Sony."""
    def c(name, fallback):
        value = scheme.get(name, fallback).lstrip("#")
        return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))

    white = (1.0, 1.0, 1.0)
    highest, high = c("surfaceHighest", "#32343c"), c("surfaceHigh", "#272a31")
    lowest, bg = c("surfaceLowest", "#0c0e15"), c("bg", "#11131a")
    black = (0, 0, 0)
    shell_top = _mix(_mix(accent, black, .22), white, .08)
    shell_mid = _mix(accent, black, .46)
    shell_bottom = _mix(accent, black, .64)
    key_top = _mix(shell_mid, black, .22)
    return {
        "shell_top": shell_top, "shell_mid": shell_mid, "shell_bottom": shell_bottom,
        "plate_top": _mix(_mix(accent, black, .86), black, .1), "plate_bottom": _mix(_mix(accent, black, .93), black, .1),
        "trig_top": _mix(accent, black, .62), "trig_bottom": _mix(accent, black, .8),
        "bumper": _mix(accent, black, .72),
        "key_top": key_top, "key_bottom": _mix(shell_mid, black, .5), "key_stroke": _mix(shell_top, white, .55),
        "glyph": _mix(c("onSurfaceVariant", "#c2c6d6"), white, .35),
        "symbol": _mix(c("onSurfaceVariant", "#c2c6d6"), white, .45),
        "ring_top": _mix(accent, black, .66), "ring_bottom": _mix(accent, black, .84),
        "dish_top": _mix(lowest, (0, 0, 0), .4), "dish_bottom": _mix(accent, black, .74),
        "dots": _mix(lowest, (0, 0, 0), .6), "mic": _mix(accent, black, .6), "logo": _mix(accent, black, .7),
    }


def draw(cr, held, axes, accent, on_accent, scheme) -> None:
    """Paint the pad in its own coordinates; the caller has already scaled and translated."""
    import cairo

    data = art()
    T = theme(scheme, accent)
    accent = _mix(accent, (1, 1, 1), .55)  # lit parts: lighter than the shell, which wears the plain accent
    silver = T['key_stroke']

    def glow(pts, t, width=7):
        if t <= 0:
            return
        for extra, alpha in ((width * 3.2, .10), (width * 2.1, .16), (width * 1.3, .28)):
            cr.save()
            _trace(cr, pts)
            cr.set_source_rgba(*accent, alpha * t)
            cr.set_line_width(extra)
            cr.set_line_join(cairo.LINE_JOIN_ROUND)
            cr.stroke()
            cr.restore()

    # Body: everything that is not background starts dark, the white shells go on top.
    for index in range(len(data["sil"])):
        _trace(cr, _smooth_cached("sil", index, 2))
    base = cairo.LinearGradient(0, Y0, 0, Y1)
    base.add_color_stop_rgb(0, *T['plate_top'])
    base.add_color_stop_rgb(1, *T['plate_bottom'])
    cr.set_source(base)
    cr.fill()

    # A thin rim of light along the whole edge, so the dark parts read against a dark game.
    for index in range(len(data["sil"])):
        _trace(cr, _smooth_cached("sil", index, 2))
    cr.set_source_rgba(*_mix(T["shell_top"], (1, 1, 1), .5), .55)
    cr.set_line_width(2.2)
    cr.set_line_join(cairo.LINE_JOIN_ROUND)
    cr.stroke()

    # Triggers: dark, lit by how far they are pulled.
    for name, label, lx in (("L2", "L2", 352), ("R2", "R2", 728)):
        pts = _smooth_cached(name, 0, 2)
        amount = max(axes.get("lt" if name == "L2" else "rt", (0.0, 0.0))[0], held("BTN_TL2" if name == "L2" else "BTN_TR2"))
        glow(pts, amount, 5)
        _trace(cr, pts)
        grad = cairo.LinearGradient(0, 70, 0, 160)
        top = _mix(T['trig_top'], accent, amount)
        bottom = _mix(T['trig_bottom'], accent, amount * .75)
        grad.add_color_stop_rgb(0, *top)
        grad.add_color_stop_rgb(1, *bottom)
        cr.set_source(grad)
        cr.fill()
        cr.select_font_face("sans-serif", 0, 1)
        cr.set_font_size(15)
        cr.set_source_rgba(*(on_accent if amount > .5 else T['glyph']), .9)
        ext = cr.text_extents(label)
        centre = _centroid(pts)
        cr.move_to(centre[0] - ext.width / 2 - ext.x_bearing, 128)
        cr.show_text(label)
        cr.new_path()

    # White shells (outer outlines and holes share one even-odd fill).
    cr.set_fill_rule(cairo.FILL_RULE_EVEN_ODD)
    for index in range(len(data["white"])):
        _trace(cr, _smooth_cached("white", index, 2))
    shell = cairo.LinearGradient(0, Y0, 0, Y1)
    shell.add_color_stop_rgb(0, *T['shell_top'])
    shell.add_color_stop_rgb(.55, *T['shell_mid'])
    shell.add_color_stop_rgb(1, *T['shell_bottom'])
    cr.set_source(shell)
    cr.fill()
    cr.set_fill_rule(cairo.FILL_RULE_WINDING)

    # Touchpad: a glass panel between the light bars, cut to the shell's own top edge.
    cr.save()
    _trace(cr, _smooth_cached("white", 17, 2))
    cr.clip()
    cr.new_path()
    cr.move_to(396, 90)
    cr.line_to(682, 90)
    cr.line_to(682, 290)
    cr.curve_to(682, 308, 668, 316, 650, 316)
    cr.line_to(428, 316)
    cr.curve_to(410, 316, 396, 308, 396, 290)
    cr.close_path()
    glass = cairo.LinearGradient(0, 160, 0, 316)
    glass.add_color_stop_rgb(0, *_mix(T["shell_top"], (1, 1, 1), .10))
    glass.add_color_stop_rgb(1, *_mix(T["plate_top"], accent, .10))
    cr.set_source(glass)
    cr.fill()
    sheen = cairo.LinearGradient(0, 160, 0, 250)
    sheen.add_color_stop_rgba(0, 1, 1, 1, .16)
    sheen.add_color_stop_rgba(1, 1, 1, 1, 0)
    cr.rectangle(396, 90, 286, 160)
    cr.set_source(sheen)
    cr.fill()
    cr.restore()

    # Light bars beside the touchpad.
    for width, alpha in ((12, .10), (7, .18)):
        for index in range(len(data["blue"])):
            _trace(cr, _smooth_cached("blue", index, 2))
        cr.set_source_rgba(*accent, alpha)
        cr.set_line_width(width)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        cr.stroke()
    for index in range(len(data["blue"])):
        _trace(cr, _smooth_cached("blue", index, 2))
    bar = cairo.LinearGradient(0, 170, 0, 320)
    bar.add_color_stop_rgb(0, *_mix(accent, (1, 1, 1), .35))
    bar.add_color_stop_rgb(1, *accent)
    cr.set_source(bar)
    cr.fill()

    # Bumpers.
    for name, button in (("L1", "BTN_TL"), ("R1", "BTN_TR")):
        pts = _smooth_cached(name, 0, 2)
        t = held(button)
        glow(pts, t, 5)
        _trace(cr, pts)
        cr.set_source_rgb(*_mix(T['bumper'], accent, t))
        cr.fill()

    # Speaker, microphone button, PlayStation button.
    for row, count, y in ((0, 5, 331), (1, 4, 341)):
        for i in range(count):
            cr.arc(513 + i * 13.5 + (6.7 if row else 0), y, 2.3, 0, 2 * math.pi)
            cr.set_source_rgb(*T['dots'])
            cr.fill()
    lit = held("BTN_MODE")
    glow_circle = cairo.RadialGradient(540, 383, 6, 540, 383, 46)
    glow_circle.add_color_stop_rgba(0, *accent, .55 * lit)
    glow_circle.add_color_stop_rgba(1, *accent, 0)
    if lit:
        cr.set_source(glow_circle)
        cr.arc(540, 383, 46, 0, 2 * math.pi)
        cr.fill()
    _logo(cr, lit, accent, T)
    pill_x, pill_y = 522, 413
    cr.new_path()
    cr.arc(pill_x + 4.5, pill_y + 4.5, 4.5, math.pi / 2, 3 * math.pi / 2)
    cr.arc(pill_x + 31.5, pill_y + 4.5, 4.5, -math.pi / 2, math.pi / 2)
    cr.close_path()
    cr.set_source_rgb(*T['mic'])
    cr.fill_preserve()
    cr.set_source_rgb(*T['dots'])
    cr.set_line_width(1.6)
    cr.stroke()

    # Sticks: a flat disc inside a raised ring, as on the pad itself; the whole cap follows the thumb.
    for name, ((cx, cy), button) in STICKS.items():
        x, y = axes.get(name, (0.0, 0.0))
        t = held(button)
        px, py = cx + x * 12, cy + y * 12
        cr.arc(cx, cy, 47, 0, 2 * math.pi)  # the soft recess in the shell
        recess = cairo.RadialGradient(cx, cy, 36, cx, cy, 48)
        recess.add_color_stop_rgba(0, 0, 0, 0, .0)
        recess.add_color_stop_rgba(.55, 0, 0, 0, .45)
        recess.add_color_stop_rgba(1, 0, 0, 0, 0)
        cr.set_source(recess)
        cr.fill()
        if t:
            lit = cairo.RadialGradient(px, py, 30, px, py, 62)
            lit.add_color_stop_rgba(0, *accent, .6 * t)
            lit.add_color_stop_rgba(1, *accent, 0)
            cr.set_source(lit)
            cr.arc(px, py, 62, 0, 2 * math.pi)
            cr.fill()
        # Raised ring.
        cr.arc(px, py, 41.5, 0, 2 * math.pi)
        ring = cairo.LinearGradient(px - 30, py - 40, px + 30, py + 40)
        ring.add_color_stop_rgb(0, *_mix(T['ring_top'], accent, t))
        ring.add_color_stop_rgb(1, *_mix(T['ring_bottom'], accent, t * .8))
        cr.set_source(ring)
        cr.fill_preserve()
        cr.set_source_rgba(0, 0, 0, .55)
        cr.set_line_width(2.2)
        cr.stroke()
        cr.arc(px, py, 39, math.pi * 1.05, math.pi * 1.8)
        cr.set_source_rgba(1, 1, 1, .10)
        cr.set_line_width(1.6)
        cr.stroke()
        # Dished centre.
        cr.arc(px, py, 29.5, 0, 2 * math.pi)
        dish = cairo.LinearGradient(px - 20, py - 26, px + 20, py + 26)
        dish.add_color_stop_rgb(0, *_mix(T['dish_top'], accent, t * .5))
        dish.add_color_stop_rgb(1, *_mix(T['dish_bottom'], accent, t * .8))
        cr.set_source(dish)
        cr.fill_preserve()
        cr.set_source_rgba(0, 0, 0, .5)
        cr.set_line_width(1.8)
        cr.stroke()
        cr.arc(px, py, 27.8, math.pi * .1, math.pi * .85)
        cr.set_source_rgba(1, 1, 1, .07)
        cr.set_line_width(1.4)
        cr.stroke()

    # Create and Options.
    for button, cx, kind in (("BTN_SELECT", 378, "create"), ("BTN_START", 703, "options")):
        t = held(button)
        cr.save()
        cr.new_path()
        radius = 10
        top, height = 192, 40
        cr.arc(cx, top + radius, radius, math.pi, 2 * math.pi)
        cr.arc(cx, top + height - radius, radius, 0, math.pi)
        cr.close_path()
        cr.set_source_rgb(*_mix(T['key_top'], accent, t * .7))
        cr.fill_preserve()
        cr.set_source_rgba(*_mix(silver, accent, t), 1)
        cr.set_line_width(3)
        cr.stroke()
        cr.restore()
        cr.set_source_rgb(*_mix(T['glyph'], on_accent, t))
        cr.set_line_width(2)
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        if kind == "options":
            for dy in (-6, 0, 6):
                cr.move_to(cx - 5, top + 20 + dy)
                cr.line_to(cx + 5, top + 20 + dy)
        else:
            for dx, dy, ex, ey in ((-3, -2, -5, -7), (0, -3, 0, -9), (3, -2, 5, -7)):
                cr.move_to(cx + dx, top + 14 + dy)
                cr.line_to(cx + ex, top + 14 + ey - 1)
            cr.rectangle(cx - 4, top + 20, 8, 12)
        cr.stroke()

    # D-pad keys.
    for button, (name, (ux, uy)) in DPAD.items():
        pts = _smooth_cached(name, 0, 2)
        t = held(button)
        glow(pts, t)
        _trace(cr, pts)
        key = cairo.LinearGradient(0, min(p[1] for p in pts), 0, max(p[1] for p in pts))
        key.add_color_stop_rgb(0, *_mix(T['key_top'], accent, t * .75))
        key.add_color_stop_rgb(1, *_mix(T['key_bottom'], accent, t * .75))
        cr.set_source(key)
        cr.fill_preserve()
        cr.set_source_rgb(*_mix(silver, accent, t))
        cr.set_line_width(5)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        cr.stroke()
        cx, cy = _centroid(pts)
        cx, cy = cx + ux * 4, cy + uy * 4
        cr.set_source_rgb(*_mix(T['glyph'], on_accent, t))
        cr.move_to(cx + ux * 7, cy + uy * 7)
        cr.line_to(cx - uy * 7 - ux * 6, cy + ux * 7 - uy * 6)
        cr.line_to(cx + uy * 7 - ux * 6, cy - ux * 7 - uy * 6)
        cr.close_path()
        cr.fill()

    # Face buttons.
    for button, ((cx, cy), shape, colour) in FACE.items():
        t = held(button)
        tint = _hex(colour)
        if t:
            for extra, alpha in ((26, .10), (18, .16), (11, .26)):
                cr.arc(cx, cy, 29 + extra * .35, 0, 2 * math.pi)
                cr.set_source_rgba(*accent, alpha * t)
                cr.set_line_width(extra)
                cr.stroke()
        cr.arc(cx, cy, 30, 0, 2 * math.pi)
        cr.set_source_rgb(*_mix(T['key_top'], _mix(T['plate_top'], accent, .3), t))
        cr.fill_preserve()
        cr.set_source_rgb(*_mix(silver, accent, t))
        cr.set_line_width(5)
        cr.stroke()
        cr.set_source_rgb(*_mix(T['symbol'], tint, t))
        cr.set_line_width(3.4)
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        size = 14
        if shape == "triangle":
            cr.move_to(cx, cy - size - 1); cr.line_to(cx + size, cy + size * .8); cr.line_to(cx - size, cy + size * .8); cr.close_path()
        elif shape == "square":
            cr.rectangle(cx - size * .85, cy - size * .85, size * 1.7, size * 1.7)
        elif shape == "circle":
            cr.arc(cx, cy, size * .95, 0, 2 * math.pi)
        else:
            cr.move_to(cx - size * .8, cy - size * .8); cr.line_to(cx + size * .8, cy + size * .8)
            cr.move_to(cx + size * .8, cy - size * .8); cr.line_to(cx - size * .8, cy + size * .8)
        cr.stroke()
