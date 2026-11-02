"""Small cached replay panels, using the same artists as capture and export."""
from functools import lru_cache
from io import BytesIO
import math
import re
from . import pad_art_ps5, pad_art_xbox


def render(body):
    layout = 'playstation' if body.get('layout') == 'playstation' else 'xbox'
    buttons = body.get('buttons', {})
    axes = body.get('axes', {})
    if not isinstance(buttons, dict) or not isinstance(axes, dict):
        raise ValueError('Invalid controller state')
    held = tuple(sorted(key for key, down in buttons.items() if down))
    values = []
    for name in ('ls', 'rs', 'lt', 'rt'):
        pair = axes.get(name, [0, 0])
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError('Invalid controller axis')
        for value in pair:
            number = float(value)
            if not math.isfinite(number): raise ValueError('Invalid controller axis')
            values.append(round(max(-1, min(1, number)), 2))
    accent = body.get('accent', '#8ab9f3')
    if not isinstance(accent, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', accent):
        accent = '#8ab9f3'
    return _render(layout, held, tuple(values), accent)


@lru_cache(maxsize=128)
def _render(layout, held, values, accent):
    import cairo
    art = pad_art_ps5 if layout == 'playstation' else pad_art_xbox
    width, height = 400, 328
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
    cr = cairo.Context(surface)
    scale = min(width/art.SIZE[0], height/art.SIZE[1])
    cr.scale(scale, scale); cr.translate(-art.X0, -art.Y0)
    axes = {name: values[i*2:i*2+2] for i, name in enumerate(('ls','rs','lt','rt'))}
    rgb = tuple(int(accent[i:i+2],16)/255 for i in (1,3,5))
    art.draw(cr, lambda key: float(key in held), axes, rgb, (.04,.08,.12), {})
    out = BytesIO(); surface.write_to_png(out)
    return out.getvalue()
