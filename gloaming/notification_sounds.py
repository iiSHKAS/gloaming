"""Approved Soft notification sounds, synthesised with the standard library.

Volume scales the waveform while preserving the selected sound design.
"""
from __future__ import annotations
import io
import math
import random
import struct
import wave
from dataclasses import dataclass
from functools import lru_cache

SAMPLE_RATE = 48000

@dataclass(frozen=True)
class Note:
    frequency: float
    start: float
    duration: float
    gain: float = 1.0
    glide: float = 0.0
    pan: float = 0.0


@dataclass(frozen=True)
class Sound:
    key: str
    label: str
    description: str
    notes: tuple[Note, ...]
    colour: str


# A shared soft electric-piano/glass palette, with different rhythms for each
# event. Each sound has a distinct contour, not merely a different pitch.
SOUNDS = (
    Sound('clip', 'Clip / حفظ المقطع', 'Velvet confirmation · warm rising dyad',
          (Note(659.25, 0, .27, .72, 4, -.12), Note(987.77, .095, .40, .78, 0, .14),
           Note(1318.51, .12, .32, .15, 0, .24)), '#76dfb5'),
    Sound('clip_failed', 'Failed / فشل الحفظ', 'Muted double knock · low, clear warning',
          (Note(311.13, 0, .18, .82, -30, -.08), Note(233.08, .21, .31, .85, -12, .08)), '#ff8b9e'),
    Sound('session_start', 'Start / بدء التسجيل', 'Soft rising bloom · ready to record',
          (Note(392, 0, .30, .55, 5, -.18), Note(587.33, .075, .32, .58, 0, 0),
           Note(783.99, .16, .43, .72, 0, .18)), '#81baff'),
    Sound('session_end', 'Stop / انتهاء التسجيل', 'Warm closing chord · settled and complete',
          (Note(659.25, 0, .24, .50, 0, .15), Note(493.88, .105, .31, .53, 0, -.12),
           Note(329.63, .22, .42, .75), Note(415.30, .25, .34, .22, 0, .15)), '#c4a1ff'),
    Sound('highlight', 'Highlight / علامة مميزة', 'Small glass sparkle · delicate and brief',
          (Note(1174.66, 0, .38, .65, 0, -.15), Note(1760, .055, .33, .25, 0, .22)), '#ffd28b'),
    Sound('screenshot', 'Screenshot / لقطة شاشة', 'Tactile shutter · dry click and soft release',
          (Note(1046.50, 0, .055, .70, -300, -.08), Note(1567.98, .065, .10, .45, -420, .08)), '#83e0e7'),
)

def encode_wav(frames: bytes) -> bytes:
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(frames)
    return out.getvalue()


@lru_cache(maxsize=96)
def synthesise(sound: Sound, volume: float = .65) -> bytes:
    """Layered synthesis, short stereo reflections and click-free envelopes.

    The fundamental stays centred enough for mono playback. Upper partials
    decay faster than the body, avoiding a sustained, piercing beep. Fixed
    gain keeps relative loudness; no normalisation that amplifies quiet tails.
    """
    volume = max(0.0, min(1.0, volume))
    dry_length = max(note.start + note.duration for note in sound.notes)
    tail = .02 if sound.key == 'screenshot' else .14
    count = math.ceil((dry_length + tail) * SAMPLE_RATE)
    left, right = [0.0] * count, [0.0] * count
    noise = random.Random(724)  # repeatable shutter texture, including exports
    for note in sound.notes:
        start = round(note.start * SAMPLE_RATE)
        length = round(note.duration * SAMPLE_RATE)
        for i in range(length):
            t = i / SAMPLE_RATE
            progress = t / note.duration
            attack = .002 if sound.key == 'screenshot' else .012
            envelope = math.sin(min(1.0, t / attack) * math.pi / 2) ** 2
            envelope *= math.exp(-3.5 * progress) * min(1.0, (1 - progress) / .20) ** 2
            phase = 2 * math.pi * (note.frequency * t + note.glide * t*t / (2 * note.duration))
            partial = .20 * math.exp(-7 * progress) * math.sin(2 * phase)
            glass = (.12 if sound.key == 'highlight' else .045) * math.exp(-10 * progress) * math.sin(3.01 * phase)
            body = math.sin(phase) + partial + glass
            if sound.key == 'screenshot':
                body = .45 * body + .50 * noise.uniform(-1, 1) * math.exp(-70 * t)
            if sound.key == 'clip_failed':
                body += .16 * math.sin(phase / 2)  # warmth, not a harsh buzzer
            sample = .34 * note.gain * envelope * body / 1.35
            index = start + i
            left[index] += sample * math.sqrt((1 - note.pan) / 2)
            right[index] += sample * math.sqrt((1 + note.pan) / 2)
    # Sparse, quiet room reflections. The dry attack stays intelligible in-game.
    if sound.key != 'screenshot':
        for delay, gain in ((.043, .10), (.079, .055), (.127, .025)):
            offset = round(delay * SAMPLE_RATE)
            # Descending traversal avoids recursively feeding this reflection.
            for i in range(count - 1, offset - 1, -1):
                left[i] += right[i - offset] * gain
                right[i] += left[i - offset] * gain
    frames = bytearray()
    for i, (l, r) in enumerate(zip(left, right)):
        fade = min(1.0, (count - 1 - i) / (SAMPLE_RATE * .015))
        values = [round(max(-1.0, min(1.0, value * volume * fade)) * 32767) for value in (l, r)]
        frames.extend(struct.pack('<hh', *values))
    return encode_wav(frames)



SOUNDS_BY_KEY = {sound.key: sound for sound in SOUNDS}
