"""Bounded controller history and private, timed clip sidecars."""
from collections import deque
import copy
import json
import math
import os
from pathlib import Path
import time

from .runtime import actual_home_dir

PAD_DIR = actual_home_dir() / '.local/share/gloaming/pad-inputs'
BUTTONS = frozenset(('BTN_SOUTH', 'BTN_EAST', 'BTN_NORTH', 'BTN_WEST', 'BTN_TL', 'BTN_TR',
    'BTN_TL2', 'BTN_TR2', 'BTN_SELECT', 'BTN_START', 'BTN_MODE', 'BTN_THUMBL', 'BTN_THUMBR',
    'BTN_DPAD_UP', 'BTN_DPAD_DOWN', 'BTN_DPAD_LEFT', 'BTN_DPAD_RIGHT'))
AXES = frozenset(('ls', 'rs', 'lt', 'rt'))


def empty_state():
    return {'buttons': {}, 'axes': {}, 'layout': 'xbox'}


def apply_event(state, event):
    _, kind, name, a, b = event
    if kind == 'button': state['buttons'][name] = bool(a)
    elif kind == 'axis': state['axes'][name] = [a, b]
    elif kind == 'layout': state['layout'] = name


class PadRing:
    def __init__(self, horizon):
        self.horizon = horizon
        self.events = deque()
        self.base = empty_state()
        self.current = empty_state()

    def record(self, kind, name, a=0, b=0, at=None):
        now = time.monotonic() if at is None else at
        if kind == 'button' and name in BUTTONS:
            a, b = bool(a), 0
            if self.current['buttons'].get(name, False) == a: return
        elif kind == 'axis' and name in AXES:
            a, b = round(max(-1, min(1, float(a))), 2), round(max(-1, min(1, float(b))), 2)
            if self.current['axes'].get(name, [0, 0]) == [a, b]: return
        elif kind == 'layout' and name in ('xbox', 'playstation'):
            if self.current['layout'] == name: return
            a = b = 0
        else: return
        event = [now, kind, name, a, b]
        self.events.append(event)
        apply_event(self.current, event)
        self.trim(now)

    def trim(self, now):
        while self.events and self.events[0][0] < now-self.horizon:
            apply_event(self.base, self.events.popleft())

    def snapshot(self, start, end):
        initial = copy.deepcopy(self.base)
        events = []
        for event in self.events:
            if event[0] <= start: apply_event(initial, event)
            elif event[0] <= end: events.append([round(event[0]-start, 4), *event[1:]])
        return {'version': 1, 'duration': max(0, end-start), 'initial': initial, 'events': events}


def cut(data, start, end):
    initial = copy.deepcopy(data['initial'])
    events = []
    for event in data['events']:
        if event[0] <= start: apply_event(initial, event)
        elif event[0] <= end: events.append([round(event[0]-start, 4), *event[1:]])
    return {'version': 1, 'duration': max(0, end-start), 'initial': initial, 'events': events}


def sidecar_path(slug):
    # Slugs originate in the library, never request paths.
    if Path(slug).name != slug or slug in ('.', '..'): raise ValueError('Invalid clip name')
    return PAD_DIR / f'{slug}.json'


def save_sidecar(slug, data):
    PAD_DIR.mkdir(parents=True, exist_ok=True)
    path = sidecar_path(slug)
    tmp = path.with_suffix('.json.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as file: json.dump(data, file)
    tmp.replace(path)


def load_sidecar(slug):
    try:
        data = json.loads(sidecar_path(slug).read_text())
        if data.get('version') != 1 or not isinstance(data.get('events'), list): return None
        initial = data['initial']
        if not isinstance(initial.get('buttons'), dict) or not isinstance(initial.get('axes'), dict): return None
        events = []
        last = 0
        for event in data['events']:
            if not isinstance(event, list) or len(event) != 5: return None
            at, kind, name, a, b = event
            if not isinstance(at, (int, float)) or not math.isfinite(at) or at < last: return None
            if not ((kind == 'button' and name in BUTTONS) or (kind == 'axis' and name in AXES)
                    or (kind == 'layout' and name in ('xbox', 'playstation'))): return None
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (a, b)): return None
            events.append(event); last = at
        return {**data, 'events': events}
    except (OSError, ValueError, TypeError, KeyError, AttributeError): return None


def delete_sidecar(slug):
    sidecar_path(slug).unlink(missing_ok=True)


def move_sidecar(old, new):
    if sidecar_path(old).exists(): sidecar_path(old).replace(sidecar_path(new))
