"""Global gamepad chords, independent of the window/compositor and keyboard."""
from __future__ import annotations
import asyncio
import logging
import time
import uuid
import evdev
from evdev import ecodes as e

log = logging.getLogger(__name__)
BUTTONS = ('BTN_SOUTH', 'BTN_EAST', 'BTN_NORTH', 'BTN_WEST', 'BTN_TL', 'BTN_TR',
           'BTN_TL2', 'BTN_TR2', 'BTN_SELECT', 'BTN_START', 'BTN_MODE',
           'BTN_THUMBL', 'BTN_THUMBR', 'BTN_DPAD_UP', 'BTN_DPAD_DOWN',
           'BTN_DPAD_LEFT', 'BTN_DPAD_RIGHT')
CODES = {getattr(e, name): name for name in BUTTONS}


def normalize_controller_combo(value):
    if not isinstance(value, str):
        raise ValueError('Controller shortcut must be a string')
    parts = value.split('+') if value else []
    if any(part not in BUTTONS for part in parts) or len(parts) != len(set(parts)):
        raise ValueError('Invalid controller button combination')
    return '+'.join(sorted(parts))


HOLD_SECONDS = .45
VENDOR_LAYOUTS = {0x054c: 'playstation', 0x045e: 'xbox'}


def controller_layout(dev):
    """Which glyph set a pad uses, from its USB vendor id (Sony/Microsoft), then its name."""
    name = (dev.name or '').lower()
    if dev.info.vendor in VENDOR_LAYOUTS:
        return VENDOR_LAYOUTS[dev.info.vendor]
    if any(word in name for word in ('dualsense', 'dualshock', 'playstation', 'ps4', 'ps5', 'wireless controller')):
        return 'playstation'
    return 'xbox'


class ControllerListener:
    def __init__(self):
        self.bindings = {}
        self.devices = {}
        self.held = {}
        self.chords = {}
        self.blocked = set()
        self.task = None
        self.capture_token = None
        self.capture_until = 0
        self.captured = ''
        self.actions = set()
        self.capture_chords = set()
        self.overlay_until = 0
        self.overlay_events = []
        self.overlay_seq = 0
        self.overlay_chords = set()
        self.overlay_subscribers = set()
        self.layouts = {}
        self.always = set()
        self.last_chord = {}
        self.pad_observers = []
        self.pad_down = {}
        self.stick_pos = {}
        self.axis_sent = {}
        self.layout_at = 0
        self.gesture_combo = ''
        self.gesture_actions = {}
        self.gesture_modal = None
        self.hold_timer = None
        self.hold_fired = set()
        self.active_layout = ''

    @property
    def layout(self):
        if self.active_layout:
            return self.active_layout
        return next(iter(self.layouts.values()), 'xbox')

    def bind(self, bindings, always=(), gesture=None):
        """`always` combos still fire while the replay overlay is open (its toggle button)."""
        self.bindings = {normalize_controller_combo(k): v for k, v in bindings.items() if k}
        self.always = {normalize_controller_combo(k) for k in always if k}
        # One combo, three actions: tap, double tap and hold. `modal()` is true while a
        # Gloaming panel is open, where any tap just dismisses it instead of waiting for a double.
        combo, actions, modal = gesture if gesture else ('', {}, None)
        self.gesture_combo = normalize_controller_combo(combo) if combo else ''
        self.gesture_actions = actions
        self.gesture_modal = modal
        self._cancel_gesture_timers()
        self.chords.clear()
        self.blocked.update(path for path, held in self.held.items() if held)

    def _pad_event(self, *event):
        for observer in tuple(self.pad_observers):
            try:
                observer(*event)
            except Exception:
                log.exception('Controller overlay observer failed')

    def _pad_button(self, name, down):
        """Pressed state across every device mirroring the same pad, for the on-screen pad."""
        count = self.pad_down.get(name, 0) + (1 if down else -1)
        self.pad_down[name] = max(0, count)
        if (count == 1 and down) or (count <= 0 and not down):
            self._pad_event('button', name, bool(down))

    def _pad_axis(self, name, x, y=0.0):
        last = self.axis_sent.get(name)
        now = time.monotonic()
        if last and abs(last[0] - x) < .02 and abs(last[1] - y) < .02:
            return
        if last and now - last[2] < .016 and (x or y):
            return
        self.axis_sent[name] = (x, y, now)
        self._pad_event('axis', name, x, y)

    def _cancel_gesture_timers(self):
        if self.hold_timer:
            self.hold_timer.cancel()
        self.hold_timer = None

    def _gesture_fire(self, kind):
        callback = self.gesture_actions.get(kind)
        if callback:
            task = asyncio.create_task(self._call(callback))
            self.actions.add(task)
            task.add_done_callback(self.actions.discard)

    def _arm_hold(self, path):
        combo = set(self.gesture_combo.split('+')) if self.gesture_combo else set()
        if self.hold_timer:
            self.hold_timer.cancel()
            self.hold_timer = None
        if (not combo or self.chords.get(path) != combo or self.held.get(path) != combo
                or path in self.blocked or time.monotonic() < self.capture_until
                or (self.gesture_modal and self.gesture_modal())):
            return
        self.hold_timer = asyncio.get_running_loop().call_later(HOLD_SECONDS, self._hold_fire, path, combo)

    def _hold_fire(self, path, combo):
        self.hold_timer = None
        if self.held.get(path) != combo or self.chords.get(path) != combo:
            return
        # Every device mirroring this press, so releasing any of them is not a tap that
        # would dismiss the menu the hold just opened.
        self.hold_fired.update(p for p, down in self.held.items() if down == combo)
        self.hold_fired.add(path)
        self._gesture_fire('hold')

    def _gesture_release(self, path):
        if path in self.hold_fired:
            self.hold_fired.discard(path)
            return
        # Any tap while a Gloaming panel is open dismisses it; otherwise a tap is just a tap and
        # fires at once. There is no double tap to wait for.
        self._gesture_fire('close' if self.gesture_modal and self.gesture_modal() else 'tap')

    def capture(self, token=None, stop=False):
        now = time.monotonic()
        active = self.capture_token and now < self.capture_until
        if active and token != self.capture_token:
            raise ValueError('Controller assignment is already open in another window')
        if stop:
            if token == self.capture_token:
                self.capture_until = 0
            return {'ok': True}
        if not active:
            if token:
                raise ValueError('Assignment expired. Try again.')
            self.capture_token = uuid.uuid4().hex
            self.captured = ''
            self.chords.clear()
            self.blocked.update(path for path, held in self.held.items() if held)
        self.capture_until = now + 3
        return {'token': self.capture_token, 'combo': self.captured,
                'devices': [dev.name for dev, _ in self.devices.values()],
                'pressed': sorted(set().union(*self.held.values())) if self.held else []}

    def overlay_poll(self, after=0, stop=False):
        self.overlay_until = 0 if stop else time.monotonic() + 1
        return {'events': [event for event in self.overlay_events if event['seq'] > after],
                'seq': self.overlay_seq,
                'held': sorted(set().union(*self.held.values())) if self.held else []}

    def button(self, path, name, down):
        held = self.held.setdefault(path, set())
        changed = (name not in held) if down else (name in held)
        if down and changed:
            # A mirrored virtual pad must not flip the glyphs while the real one is in use.
            seen = self.layouts.get(path.split(':')[0], self.active_layout)
            if seen == self.active_layout or time.monotonic() - self.layout_at > 1.5:
                self.active_layout = seen
                self.layout_at = time.monotonic()
        if changed and not path.endswith(':stick') and name in CODES.values():
            self._pad_button(name, down)
        if changed and self.overlay_subscribers and time.monotonic() >= self.capture_until:
            for queue in tuple(self.overlay_subscribers):
                if queue.full():
                    queue.get_nowait()
                queue.put_nowait({'button': name, 'down': down, 'layout': self.layout})
        if down:
            if name in held:
                return
            held.add(name)
            if (self.overlay_subscribers or time.monotonic() < self.overlay_until) and time.monotonic() >= self.capture_until:
                self.overlay_chords.add(path)
                self.overlay_seq += 1
                self.overlay_events.append({'seq': self.overlay_seq, 'button': name})
                self.overlay_events = self.overlay_events[-64:]
            if time.monotonic() < self.capture_until:
                self.capture_chords.add(path)
            self.chords.setdefault(path, set()).add(name)
            self._arm_hold(path)
        else:
            held.discard(name)
            if self.hold_timer:
                self.hold_timer.cancel()
                self.hold_timer = None
        if held:
            return
        chord = '+'.join(sorted(self.chords.pop(path, set())))
        was_overlay = path in self.overlay_chords
        self.overlay_chords.discard(path)
        was_capturing = path in self.capture_chords
        self.capture_chords.discard(path)
        if path in self.blocked:
            self.blocked.discard(path)
            return
        if not chord:
            return
        if time.monotonic() < self.capture_until:
            if not self.captured:
                self.captured = chord
            return
        # One physical press can arrive from two devices at once (a pad plus the virtual
        # pad Steam or the game creates for it). Fire that combo once, or a toggle opens
        # and closes in the same instant.
        now = time.monotonic()
        previous = self.last_chord.get(chord)
        self.last_chord[chord] = (path, now)
        if previous and previous[0].split(':')[0] != path.split(':')[0] and now - previous[1] < .08:
            self.hold_fired.discard(path)
            return
        if self.gesture_combo and chord == self.gesture_combo and not was_capturing:
            self._gesture_release(path)
            return
        if was_capturing or (was_overlay and chord not in self.always):
            return
        callback = self.bindings.get(chord)
        if callback:
            task = asyncio.create_task(self._call(callback))
            self.actions.add(task)
            task.add_done_callback(self.actions.discard)

    async def _call(self, callback):
        try:
            await callback()
        except Exception:
            log.exception('Controller action failed')

    async def start(self):
        self.task = asyncio.create_task(self._supervise())

    async def stop(self):
        tasks = [self.task] if self.task else []
        tasks += [task for _, task in self.devices.values()] + list(self.actions)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for dev, _ in self.devices.values():
            dev.close()
        self.devices.clear()
        self.held.clear()
        self.chords.clear()
        self.blocked.clear()
        self.capture_chords.clear()
        self.hold_fired.clear()
        self._cancel_gesture_timers()
        self.task = None

    @staticmethod
    def _probe(paths):
        """Open candidate devices. Blocking ioctls, so this runs off the event loop."""
        pads, others = [], []
        for path in paths:
            dev = None
            try:
                dev = evdev.InputDevice(path)
                keys = dev.capabilities().get(e.EV_KEY, [])
                if any(code in keys for code in (e.BTN_SOUTH, e.BTN_GAMEPAD)):
                    pads.append(dev)
                else:
                    dev.close()
                    others.append(path)
            except OSError:
                if dev:
                    dev.close()
        return pads, others

    async def _supervise(self):
        ignored = set()
        while True:
            for path, (dev, task) in list(self.devices.items()):
                if task.done():
                    dev.close()
                    del self.devices[path]
            listed = set(evdev.list_devices())
            ignored &= listed
            fresh = sorted(listed - ignored - self.devices.keys())
            if fresh:
                # Keyboards and mice never become gamepads: probe each only once, and
                # never on the loop thread (a slow device would stall every button press).
                pads, others = await asyncio.to_thread(self._probe, fresh)
                ignored.update(others)
                for dev in pads:
                    self.devices[dev.path] = (dev, asyncio.create_task(self._listen(dev)))
            await asyncio.sleep(2)

    def _resync(self, dev, path):
        try:
            down = {CODES[k] for k in dev.active_keys() if k in CODES}
            for code, low, high in ((e.ABS_HAT0X, 'BTN_DPAD_LEFT', 'BTN_DPAD_RIGHT'), (e.ABS_HAT0Y, 'BTN_DPAD_UP', 'BTN_DPAD_DOWN')):
                try:
                    value = dev.absinfo(code).value
                except (OSError, AttributeError):
                    continue
                if value < 0:
                    down.add(low)
                elif value > 0:
                    down.add(high)
        except OSError:
            return
        held = self.held.get(path, set())
        for name in sorted(held - down):
            self.button(path, name, False)
        for name in sorted(down - held):
            self.button(path, name, True)

    async def _listen(self, dev):
        path = dev.path
        self.layouts[path] = controller_layout(dev)
        try:
            # Ignore buttons already held when connecting/starting.
            self.held[path] = {CODES[k] for k in dev.active_keys() if k in CODES}
            if self.held[path]:
                self.blocked.add(path)
            axes = {axis: info for axis, info in dev.capabilities().get(e.EV_ABS, [])}
            async for event in dev.async_read_loop():
                if event.type == e.EV_SYN and event.code == e.SYN_DROPPED:
                    # Events were lost: resync from the device instead of dropping it, which
                    # used to leave the controller dead until the next rescan.
                    self._resync(dev, path)
                    continue
                if event.type == e.EV_KEY and event.code in CODES and event.value in (0, 1):
                    self.button(path, CODES[event.code], bool(event.value))
                elif event.type == e.EV_ABS:
                    if self.pad_observers and event.code in axes:
                        info = axes[event.code]
                        span = max(1, info.max - info.min)
                        norm = (event.value - info.min) / span * 2 - 1
                        stick = {e.ABS_X: ('ls', 0), e.ABS_Y: ('ls', 1), e.ABS_RX: ('rs', 0), e.ABS_RY: ('rs', 1)}.get(event.code)
                        if stick:
                            pos = self.stick_pos.setdefault(stick[0], [0.0, 0.0])
                            pos[stick[1]] = 0.0 if abs(norm) < .08 else max(-1.0, min(1.0, norm))
                            self._pad_axis(stick[0], pos[0], pos[1])
                        elif event.code in (e.ABS_Z, e.ABS_RZ):
                            self._pad_axis('lt' if event.code == e.ABS_Z else 'rt', (norm + 1) / 2)
                    if event.code == e.ABS_X and self.overlay_subscribers and time.monotonic() >= self.capture_until and event.code in axes:
                        info = axes[event.code]
                        center = (info.min + info.max) / 2
                        deadzone = (info.max - info.min) * .2
                        self.button(path + ':stick', 'BTN_DPAD_LEFT', event.value < center - deadzone)
                        self.button(path + ':stick', 'BTN_DPAD_RIGHT', event.value > center + deadzone)
                    elif event.code == e.ABS_Y and self.overlay_subscribers and time.monotonic() >= self.capture_until and event.code in axes:
                        info = axes[event.code]
                        center = (info.min + info.max) / 2
                        deadzone = (info.max - info.min) * .35
                        # Not D-pad names: only menus that ask for the stick react to it.
                        self.button(path + ':stick', 'STICK_UP', event.value < center - deadzone)
                        self.button(path + ':stick', 'STICK_DOWN', event.value > center + deadzone)
                    elif event.code in (e.ABS_HAT0X, e.ABS_HAT0Y):
                        negative, positive = (('BTN_DPAD_LEFT', 'BTN_DPAD_RIGHT') if event.code == e.ABS_HAT0X else ('BTN_DPAD_UP', 'BTN_DPAD_DOWN'))
                        self.button(path, negative, event.value < 0)
                        self.button(path, positive, event.value > 0)
                    elif event.code in (e.ABS_Z, e.ABS_RZ) and event.code in axes:
                        info = axes[event.code]
                        name = 'BTN_TL2' if event.code == e.ABS_Z else 'BTN_TR2'
                        threshold = .45 if name in self.held.get(path, set()) else .65
                        self.button(path, name, event.value > info.min + (info.max-info.min)*threshold)
        except OSError:
            pass
        finally:
            for queue in tuple(self.overlay_subscribers):
                if queue.full():
                    queue.get_nowait()
                queue.put_nowait({'reset': True})
            for state in (self.held, self.chords):
                state.pop(path + ':stick', None)
            self.overlay_chords.discard(path + ':stick')
            for name in tuple(self.held.get(path, ())):
                self._pad_button(name, False)
            self.layouts.pop(path, None)
            self.hold_fired.discard(path)
            self.held.pop(path, None)
            self.chords.pop(path, None)
            self.blocked.discard(path)
            self.capture_chords.discard(path)
            self.overlay_chords.discard(path)
