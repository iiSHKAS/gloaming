"""The on-screen gamepad, run as its own process by the daemon.

Same plumbing as the keyboard overlay (it subclasses it), fed over stdin:

    {"t": "key", "k": "BTN_SOUTH", "d": true}
    {"t": "axis", "a": "ls", "x": -0.4, "y": 0.9}      # ls, rs: sticks; lt, rt: triggers 0..1 in x
    {"t": "layout", "v": "xbox" | "playstation"}
    {"t": "style", "accent": "#8ab9f3"}   {"t": "place", ...}

Each pad is drawn as its own hardware, in pad_art_ps5 and pad_art_xbox.
"""

from __future__ import annotations

from . import pad_art_ps5, pad_art_xbox
from .key_overlay import Overlay, _rgb, _rounded

ART = {"playstation": pad_art_ps5, "xbox": pad_art_xbox}


class PadOverlay(Overlay):
    MODULE = "gloaming.pad_overlay"
    TITLE = "Gloaming pad"
    NAMESPACE = "gloaming-pad"
    # Set before Overlay.__init__ runs: it sizes and places the window immediately.
    layout = "xbox"
    axes: dict = {}

    def _art(self):
        return ART.get(self.layout, pad_art_xbox)

    def panel(self) -> tuple[int, int]:
        art = self._art()
        k = art.DISPLAY_SCALE * self.scale
        return round(art.SIZE[0] * k), round(art.SIZE[1] * k)

    def _handle(self, message: dict) -> None:
        kind = message.get("t")
        if kind == "layout":
            layout = "playstation" if message.get("v") == "playstation" else "xbox"
            if layout != self.layout:
                self.layout = layout
                self._resize()
                self._place()
            self.area.queue_draw()
        elif kind == "axis":
            self.axes = {**self.axes, str(message.get("a")): (float(message.get("x", 0) or 0), float(message.get("y", 0) or 0))}
            self.area.queue_draw()
        else:
            super()._handle(message)

    def paint(self, cr, eased: dict) -> None:
        import cairo
        accent = _rgb(self.scheme.get("base", "#8ab9f3"))
        on_accent = _rgb(self.scheme.get("onBase", "#08233f"))

        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)

        if self.moving:
            # Exactly the keyboard overlay's cue: a card behind it with an accent border.
            width, height = self.panel()
            _rounded(cr, 0, 0, width, height, 28 * self.scale)
            cr.set_source_rgba(*_rgb(self.scheme.get("surfaceLow", "#191b23"), .88))
            cr.fill_preserve()
            cr.set_line_width(2 * self.scale)
            cr.set_source_rgba(*accent[:3], 1)
            cr.stroke()

        art = self._art()
        k = art.DISPLAY_SCALE * self.scale
        cr.scale(k, k)
        cr.translate(-art.X0, -art.Y0)
        art.draw(cr, lambda name: eased.get(name, 0.0), self.axes, accent[:3], on_accent[:3], self.scheme)


def main() -> int:
    overlay = PadOverlay()
    overlay.Gtk.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
