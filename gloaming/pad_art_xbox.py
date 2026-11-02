"""The Xbox controller drawing for the on-screen pad.

Drawn here, in the same language as the DualSense art (pad_art_ps5): one body that wears the app's accent colour,
dark glass buttons with light rims, and parts that light up in a lighter tone of the accent when pressed.
Coordinates are in a 680x520 box.
"""

from __future__ import annotations

import math

from .pad_art_ps5 import _hex, _mix, _smooth, theme

X0, Y0 = 0, 18
SIZE = (680, 500)
DISPLAY_SCALE = .58
W = 680

# Left half of the silhouette from the top centre round to the bottom centre; the right half mirrors it.
_START = (340, 112)
_SEGMENTS = [
    ((300, 108), (240, 102), (190, 108)),
    ((120, 118), (78, 156), (58, 218)),
    ((38, 284), (26, 360), (24, 424)),
    ((22, 470), (54, 502), (96, 496)),
    ((136, 490), (160, 436), (186, 398)),
    ((204, 372), (238, 366), (276, 368)),
    ((300, 368), (320, 370), (340, 370)),
]

FACE = {"BTN_NORTH": ((506, 158), "Y", "#ffd34d"), "BTN_WEST": ((466, 198), "X", "#5b9bff"),
        "BTN_EAST": ((546, 198), "B", "#ff6262"), "BTN_SOUTH": ((506, 238), "A", "#58d36f")}
STICKS = {"ls": ((176, 204), "BTN_THUMBL"), "rs": ((424, 314), "BTN_THUMBR")}
DPAD = (252, 308)
DPAD_ARMS = {"BTN_DPAD_UP": (0, -1), "BTN_DPAD_DOWN": (0, 1), "BTN_DPAD_LEFT": (-1, 0), "BTN_DPAD_RIGHT": (1, 0)}


def _outline(cr) -> None:
    cr.new_path()
    cr.move_to(*_START)
    nodes = [_START]
    for c1, c2, end in _SEGMENTS:
        cr.curve_to(*c1, *c2, *end)
        nodes.append(end)
    for index in range(len(_SEGMENTS) - 1, -1, -1):
        c1, c2, _ = _SEGMENTS[index]
        origin = nodes[index]
        cr.curve_to(W - c2[0], c2[1], W - c1[0], c1[1], W - origin[0], origin[1])
    cr.close_path()


def _bumper(cr, left: bool) -> None:
    """The bumper hugs the shoulder; the right one is the left mirrored."""
    pts = [(98, 142), (112, 112), (150, 94), (214, 90), (268, 94), (268, 118), (214, 116), (160, 124), (126, 146)]
    cr.new_path()
    pts = _smooth([(x if left else W - x, y) for x, y in pts], 3)
    for index, (x, y) in enumerate(pts):
        (cr.move_to if index == 0 else cr.line_to)(x, y)
    cr.close_path()


def _trigger(cr, left: bool) -> None:
    pts = [(116, 80), (126, 46), (156, 30), (206, 28), (240, 34), (250, 56), (246, 82), (200, 76), (150, 78)]
    cr.new_path()
    pts = _smooth([(x if left else W - x, y) for x, y in pts], 3)
    for index, (x, y) in enumerate(pts):
        (cr.move_to if index == 0 else cr.line_to)(x, y)
    cr.close_path()


def draw(cr, held, axes, accent, on_accent, scheme) -> None:
    import cairo

    T = theme(scheme, accent)
    silver = T["key_stroke"]
    accent = _mix(accent, (1, 1, 1), .55)  # lit parts: lighter than the body, which wears the plain accent

    def glow_stroke(trace, t, width=7):
        if t <= 0:
            return
        for extra, alpha in ((width * 3.2, .10), (width * 2.1, .16), (width * 1.3, .28)):
            cr.save()
            trace()
            cr.set_source_rgba(*accent, alpha * t)
            cr.set_line_width(extra)
            cr.set_line_join(cairo.LINE_JOIN_ROUND)
            cr.stroke()
            cr.restore()

    def halo(x, y, radius, t):
        if t <= 0:
            return
        glow = cairo.RadialGradient(x, y, radius * .4, x, y, radius * 2.2)
        glow.add_color_stop_rgba(0, *accent, .55 * t)
        glow.add_color_stop_rgba(1, *accent, 0)
        cr.set_source(glow)
        cr.arc(x, y, radius * 2.2, 0, 2 * math.pi)
        cr.fill()

    # ── triggers, then bumpers (behind the body) ──
    for side, left in (("l", True), ("r", False)):
        amount = max(axes.get(f"{side}t", (0.0, 0.0))[0], held("BTN_TL2" if left else "BTN_TR2"))
        glow_stroke(lambda l=left: _trigger(cr, l), amount, 5)
        _trigger(cr, left)
        grad = cairo.LinearGradient(0, 28, 0, 84)
        grad.add_color_stop_rgb(0, *_mix(T["trig_top"], accent, amount))
        grad.add_color_stop_rgb(1, *_mix(T["trig_bottom"], accent, amount * .75))
        cr.set_source(grad)
        cr.fill_preserve()
        cr.set_source_rgba(1, 1, 1, .14)
        cr.set_line_width(1.6)
        cr.stroke()
        cr.select_font_face("sans-serif", 0, 1)
        cr.set_font_size(19)
        label = "LT" if left else "RT"
        ext = cr.text_extents(label)
        cr.set_source_rgba(*(on_accent if amount > .5 else T["glyph"]), .9)
        cr.move_to((183 if left else W - 183) - ext.width / 2 - ext.x_bearing, 62)
        cr.show_text(label)
        cr.new_path()

    # ── body ──
    for offset, alpha in ((10, .08), (6, .12), (3, .18)):
        cr.save()
        cr.translate(0, offset)
        _outline(cr)
        cr.set_source_rgba(0, 0, 0, alpha)
        cr.fill()
        cr.restore()
    _outline(cr)
    body = cairo.LinearGradient(0, 100, 0, 500)
    body.add_color_stop_rgb(0, *T["shell_top"])
    body.add_color_stop_rgb(.5, *T["shell_mid"])
    body.add_color_stop_rgb(1, *T["shell_bottom"])
    cr.set_source(body)
    cr.fill_preserve()
    cr.set_source_rgba(*_mix(T["shell_top"], (1, 1, 1), .5), .55)
    cr.set_line_width(2.2)
    cr.set_line_join(cairo.LINE_JOIN_ROUND)
    cr.stroke()
    # Soft sheen across the top face.
    cr.save()
    _outline(cr)
    cr.clip()
    sheen = cairo.RadialGradient(340, 150, 20, 340, 150, 330)
    sheen.add_color_stop_rgba(0, 1, 1, 1, .16)
    sheen.add_color_stop_rgba(1, 1, 1, 1, 0)
    cr.set_source(sheen)
    cr.paint()
    cr.restore()

    # The textured grips: a field of fine dots, as on the real pad.
    cr.save()
    _outline(cr)
    cr.clip()
    for gx in (86, W - 86):
        for row in range(-5, 6):
            for col in range(-4, 5):
                px = gx + col * 11 + (5.5 if row % 2 else 0)
                py = 426 + row * 10
                if (px - gx) ** 2 + (py - 426) ** 2 > 50 ** 2:
                    continue
                cr.arc(px, py, 1.7, 0, 2 * math.pi)
                cr.set_source_rgba(0, 0, 0, .22)
                cr.fill()
                cr.arc(px, py + 1.2, 1.5, 0, 2 * math.pi)
                cr.set_source_rgba(1, 1, 1, .07)
                cr.fill()
    cr.restore()

    # Bumpers sit on the body.
    for side, left in (("l", True), ("r", False)):
        t = held("BTN_TL" if left else "BTN_TR")
        glow_stroke(lambda l=left: _bumper(cr, l), t, 5)
        _bumper(cr, left)
        bar = cairo.LinearGradient(0, 90, 0, 146)
        bar.add_color_stop_rgb(0, *_mix(_mix(T["shell_top"], (1, 1, 1), .12), accent, t))
        bar.add_color_stop_rgb(1, *_mix(T["shell_mid"], accent, t * .85))
        cr.set_source(bar)
        cr.fill_preserve()
        cr.set_source_rgba(1, 1, 1, .22)
        cr.set_line_width(1.6)
        cr.stroke()

    # ── sticks ──
    for name, ((cx, cy), button) in STICKS.items():
        x, y = axes.get(name, (0.0, 0.0))
        t = held(button)
        px, py = cx + x * 14, cy + y * 14
        cr.arc(cx, cy, 52, 0, 2 * math.pi)
        well = cairo.LinearGradient(0, cy - 52, 0, cy + 52)
        well.add_color_stop_rgba(0, 0, 0, 0, .55)
        well.add_color_stop_rgba(1, 1, 1, 1, .10)
        cr.set_source(well)
        cr.fill()
        cr.arc(cx, cy, 46, 0, 2 * math.pi)
        cr.set_source_rgba(*T["plate_top"], .9)
        cr.fill()
        halo(px, py, 34, max(t, min(1, math.hypot(x, y)) * .25))
        cap = cairo.RadialGradient(px - 10, py - 12, 4, px, py, 40)
        cap.add_color_stop_rgb(0, *_mix(T["ring_top"], accent, t))
        cap.add_color_stop_rgb(1, *_mix(T["ring_bottom"], accent, t * .7))
        cr.arc(px, py, 38, 0, 2 * math.pi)
        cr.set_source(cap)
        cr.fill_preserve()
        cr.set_source_rgba(1, 1, 1, .16)
        cr.set_line_width(2)
        cr.stroke()
        # The cap's textured dish.
        cr.arc(px, py, 27, 0, 2 * math.pi)
        dish = cairo.LinearGradient(px - 20, py - 24, px + 20, py + 24)
        dish.add_color_stop_rgb(0, *_mix(T["dish_top"], accent, t * .5))
        dish.add_color_stop_rgb(1, *_mix(T["dish_bottom"], accent, t * .8))
        cr.set_source(dish)
        cr.fill()
        for radius in (22, 17, 12, 7):
            cr.arc(px, py, radius, 0, 2 * math.pi)
            cr.set_source_rgba(1, 1, 1, .07)
            cr.set_line_width(1.2)
            cr.stroke()

    # ── D-pad: the Series pad's round recess holding a 3x3 grid; the cross keys are raised and soft-edged ──
    dx, dy = DPAD
    R = 47
    cell = 15.5                      # half a cell; the cross is three cells wide and runs out to the rim

    def tone(k):
        """The pad's own dark grey, lit (k > 0) or shaded (k < 0)."""
        base = _mix(T["plate_top"], T["shell_mid"], .30)
        return _mix(base, (1, 1, 1), k) if k >= 0 else _mix(base, (0, 0, 0), -k)

    # Rim: a black ring in a soft shadow, as in the photo.
    cr.arc(dx, dy + 2.5, R + 11, 0, 2 * math.pi)
    cr.set_source_rgba(0, 0, 0, .30)
    cr.fill()
    cr.arc(dx, dy, R + 7.5, 0, 2 * math.pi)
    cr.set_source_rgb(*tone(-.78))
    cr.fill()
    cr.arc(dx, dy, R + 1.5, 0, 2 * math.pi)
    cr.set_source_rgb(*tone(-.62))
    cr.fill()
    cr.save()
    cr.arc(dx, dy, R, 0, 2 * math.pi)
    cr.clip()
    # Floor, lit from the lower right.
    floor = cairo.LinearGradient(dx - R, dy - R, dx + R, dy + R)
    floor.add_color_stop_rgb(0, *tone(-.22))
    floor.add_color_stop_rgb(1, *tone(.06))
    cr.set_source(floor)
    cr.paint()
    # Seams between the nine cells.
    cr.set_source_rgba(0, 0, 0, .55)
    cr.set_line_width(1.6)
    for edge in (-cell, cell):
        cr.move_to(dx + edge, dy - R); cr.line_to(dx + edge, dy + R)
        cr.move_to(dx - R, dy + edge); cr.line_to(dx + R, dy + edge)
    cr.stroke()
    # Centre square.
    cc = cairo.LinearGradient(dx - cell, dy - cell, dx + cell, dy + cell)
    cc.add_color_stop_rgb(0, *tone(.0))
    cc.add_color_stop_rgb(1, *tone(.07))
    cr.rectangle(dx - cell + .8, dy - cell + .8, 2 * cell - 1.6, 2 * cell - 1.6)
    cr.set_source(cc)
    cr.fill()
    # The four keys.
    keys = {
        "BTN_DPAD_UP": (dx - cell, dy - R - 4, dx + cell, dy - cell, (-.20, -.34)),
        "BTN_DPAD_DOWN": (dx - cell, dy + cell, dx + cell, dy + R + 4, (.13, -.02)),
        "BTN_DPAD_LEFT": (dx - R - 4, dy - cell, dx - cell, dy + cell, (-.12, -.30)),
        "BTN_DPAD_RIGHT": (dx + cell, dy - cell, dx + R + 4, dy + cell, (.20, .06)),
    }
    for name, (x0, y0, x1, y1, (k0, k1)) in keys.items():
        t = held(name)
        x0, y0, x1, y1 = x0 + .8, y0 + .8, x1 - .8, y1 - .8
        if t > 0:
            glow_stroke(lambda b=(x0, y0, x1, y1): _rr(cr, *b[:2], b[2] - b[0], b[3] - b[1], 7), t, 4)
        _rr(cr, x0, y0, x1 - x0, y1 - y0, 7)
        face = cairo.LinearGradient(x0, y0, x1, y1)
        face.add_color_stop_rgb(0, *_mix(tone(min(k0, k1) if k0 < k1 else k0), accent, t * .85))
        face.add_color_stop_rgb(1, *_mix(tone(max(k0, k1)), accent, t * .85))
        cr.set_source(face)
        cr.fill_preserve()
        cr.set_source_rgba(0, 0, 0, .5)
        cr.set_line_width(1.2)
        cr.stroke()
        # Soft bevel: light on the edges that face the lamp (right, bottom), shade on the others.
        cr.save()
        _rr(cr, x0, y0, x1 - x0, y1 - y0, 7)
        cr.clip()
        bevel = cairo.LinearGradient(x0, y0, x1, y1)
        bevel.add_color_stop_rgba(0, 0, 0, 0, .28)
        bevel.add_color_stop_rgba(.35, 0, 0, 0, 0)
        bevel.add_color_stop_rgba(.7, 1, 1, 1, 0)
        bevel.add_color_stop_rgba(1, 1, 1, 1, .20)
        cr.set_source(bevel)
        cr.paint()
        cr.restore()
        _rr(cr, x0 + 1.4, y0 + 1.4, x1 - x0 - 2.8, y1 - y0 - 2.8, 6)
        cr.set_source_rgba(1, 1, 1, .07 + .3 * t)
        cr.set_line_width(1)
        cr.stroke()
    cr.restore()

    # ── face buttons ──
    for button, ((cx, cy), letter, colour) in FACE.items():
        t = held(button)
        tint = _hex(colour)
        halo(cx, cy, 24, t)
        cr.arc(cx, cy + 1.5, 25, 0, 2 * math.pi)
        cr.set_source_rgba(0, 0, 0, .5)
        cr.fill()
        cr.arc(cx, cy, 23, 0, 2 * math.pi)
        disc = cairo.LinearGradient(0, cy - 23, 0, cy + 23)
        disc.add_color_stop_rgb(0, *_mix(T["key_top"], _mix(T["plate_top"], accent, .3), t))
        disc.add_color_stop_rgb(1, *_mix(T["key_bottom"], _mix(T["plate_top"], accent, .3), t))
        cr.set_source(disc)
        cr.fill_preserve()
        cr.set_source_rgb(*_mix(silver, accent, t))
        cr.set_line_width(3)
        cr.stroke()
        cr.select_font_face("sans-serif", 0, 1)
        cr.set_font_size(24)
        ext = cr.text_extents(letter)
        cr.set_source_rgb(*_mix(tint, (1, 1, 1), t * .3))
        cr.move_to(cx - ext.width / 2 - ext.x_bearing, cy - ext.height / 2 - ext.y_bearing)
        cr.show_text(letter)
        cr.new_path()

    # ── centre: View, Xbox button, Menu, Share ──
    def small(cx, cy, key, icon):
        t = held(key)
        halo(cx, cy, 12, t)
        cr.arc(cx, cy, 14, 0, 2 * math.pi)
        cr.set_source_rgb(*_mix(T["key_top"], accent, t * .8))
        cr.fill_preserve()
        cr.set_source_rgb(*_mix(silver, accent, t))
        cr.set_line_width(2)
        cr.stroke()
        cr.set_source_rgb(*_mix(T["glyph"], on_accent, t))
        cr.set_line_width(2)
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        if icon == "view":
            cr.rectangle(cx - 6.5, cy - 4.5, 9, 9)
            cr.stroke()
            cr.rectangle(cx - 2.5, cy - 8, 9, 9)
            cr.stroke()
        else:
            for off in (-5, 0, 5):
                cr.move_to(cx - 6, cy + off)
                cr.line_to(cx + 6, cy + off)
            cr.stroke()

    small(294, 206, "BTN_SELECT", "view")
    small(386, 206, "BTN_START", "menu")
    mx, my = 340, 168
    t = held("BTN_MODE")
    halo(mx, my, 24, t)
    cr.arc(mx, my + 1.5, 30, 0, 2 * math.pi)
    cr.set_source_rgba(0, 0, 0, .5)
    cr.fill()
    cr.arc(mx, my, 28, 0, 2 * math.pi)
    glass = cairo.LinearGradient(0, my - 28, 0, my + 28)
    glass.add_color_stop_rgb(0, *_mix(_mix(T["plate_top"], T["shell_mid"], .35), accent, t * .6))
    glass.add_color_stop_rgb(1, *_mix(_mix(T["plate_bottom"], T["shell_mid"], .2), accent, t * .6))
    cr.set_source(glass)
    cr.fill_preserve()
    cr.set_source_rgb(*_mix(silver, accent, t))
    cr.set_line_width(3)
    cr.stroke()
    # The Xbox mark: a sphere with an X cut through it.
    _xbox_logo(cr, mx, my, 21, _mix((1.0, 1.0, 1.0), accent, t * .5), (.09, .09, .16))
    # Share, a small pill under the logo.
    t = 0.0  # no evdev button for Share on most pads
    _rr(cr, 322, 256, 36, 14, 7)
    cr.set_source_rgb(*_mix(T["key_top"], accent, t * .8))
    cr.fill_preserve()
    cr.set_source_rgb(*_mix(silver, accent, t))
    cr.set_line_width(1.8)
    cr.stroke()


def _xbox_logo(cr, cx, cy, r, colour, cut) -> None:
    """The Xbox mark as in the photo: a white sphere with a dark X cut through its upper half.

    The two strokes cross about half a radius above the centre. The upper arms are short and thin; the lower
    ones are long, bow outward and run off the rim.
    """
    cr.save()
    cr.arc(cx, cy, r, 0, 2 * math.pi)
    cr.set_source_rgb(*colour)
    cr.fill()
    cr.arc(cx, cy, r, 0, 2 * math.pi)
    cr.clip()
    cross = (0.02, -0.46)
    # (end point, bow, half-width at the crossing, half-width at the end) in units of the radius.
    arms = (((-0.52, -0.86), .00, .17, .12), ((0.64, -0.84), .00, .17, .12),
            ((-0.76, 0.66), -.07, .17, .15), ((0.82, 0.70), .07, .17, .15))
    cr.set_source_rgb(*cut)
    for end, bow, w0, w1 in arms:
        ex, ey = end
        mx, my = (cross[0] + ex) / 2, (cross[1] + ey) / 2
        dx, dy = ex - cross[0], ey - cross[1]
        length = math.hypot(dx, dy)
        nx, ny = -dy / length, dx / length
        mx, my = mx + nx * bow * 2, my + ny * bow * 2
        steps = 20
        left, right = [], []
        for i in range(steps + 1):
            u = i / steps
            x = (1 - u) ** 2 * cross[0] + 2 * (1 - u) * u * mx + u * u * ex
            y = (1 - u) ** 2 * cross[1] + 2 * (1 - u) * u * my + u * u * ey
            tx = 2 * (1 - u) * (mx - cross[0]) + 2 * u * (ex - mx)
            ty = 2 * (1 - u) * (my - cross[1]) + 2 * u * (ey - my)
            norm = math.hypot(tx, ty) or 1
            px, py = -ty / norm, tx / norm
            half = w0 + (w1 - w0) * u
            left.append((cx + (x + px * half) * r, cy + (y + py * half) * r))
            right.append((cx + (x - px * half) * r, cy + (y - py * half) * r))
        pts = left + right[::-1]
        cr.move_to(*pts[0])
        for point in pts[1:]:
            cr.line_to(*point)
        cr.close_path()
        cr.fill()
    cr.restore()


def _rr(cr, x, y, w, h, r) -> None:
    r = min(r, w / 2, h / 2)
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    cr.close_path()
