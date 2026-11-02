"""Gloaming notifications: the approved Soft bank, synthesised in Python.

Six sounds cover clip, failure, session start/end, highlight and screenshot.
Volume scales the generated waveform; zero is silent. User-assigned files still override the built-in bank.
Playback uses paplay, aplay or ffplay without blocking the event loop.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from pathlib import Path
from typing import Optional

from .notification_sounds import SOUNDS_BY_KEY, synthesise

log = logging.getLogger("gloaming.audio")

def _clamp_volume(volume: float) -> float:
    try:
        return max(0.0, min(1.0, float(volume)))
    except (TypeError, ValueError):
        return 1.0


def _wav_for(name: str, volume: float) -> bytes:
    return synthesise(SOUNDS_BY_KEY[name], _clamp_volume(volume))


# ── Playback ───────────────────────────────────────────────────────────────────

# Stable temp paths so we never accumulate files
_TMP_DIR = Path("/tmp/gloaming/soft-v1")


def _find_player() -> Optional[str]:
    for p in ("paplay", "aplay", "ffplay"):
        found = shutil.which(p)
        if found:
            return found
    return None


def _player_cmd(player: str, wav_path: Path) -> list[str]:
    if "ffplay" in player:
        return [player, "-nodisp", "-autoexit", "-loglevel", "quiet", str(wav_path)]
    return [player, str(wav_path)]


def resolve_custom_sound(custom: Optional[str]) -> Optional[Path]:
    """A usable path for a user-supplied sound, or None to use the tone.

    Anything unset, missing, empty or unreadable falls back, because a
    mistyped path must never turn into silence: the sound is how you know
    the clip landed.
    """
    if not custom or not str(custom).strip():
        return None
    path = Path(os.path.expanduser(str(custom).strip()))
    try:
        if not path.is_file():
            missing = "does not exist" if not path.exists() else "is not a file"
            log.warning("Notification sound %s %s, using the built-in tone", path, missing)
            return None
        if not os.access(path, os.R_OK):
            log.warning("Notification sound %s cannot be read, using the built-in tone", path)
            return None
        if path.stat().st_size == 0:
            log.warning("Notification sound %s is empty, using the built-in tone", path)
            return None
    except OSError as exc:
        log.warning("Notification sound %s cannot be used (%s), using the built-in tone", path, exc)
        return None
    return path


async def _play(name: str, volume: float, custom: Optional[str] = None) -> None:
    player = _find_player()
    if not player:
        log.debug("No audio player found (paplay/aplay/ffplay); skipping notification")
        return

    sound = resolve_custom_sound(custom)
    if sound is None:
        # First synthesis can take tens of milliseconds; keep recording and
        # hotkey handling responsive while the waveform is generated.
        wav_data = await asyncio.to_thread(_wav_for, name, volume)
        # One file per sound and volume, written only when it is not already
        # there: two clips in quick succession used to rewrite a single shared
        # path while the previous player still had it open.
        level = int(round(_clamp_volume(volume) * 100))
        sound = _TMP_DIR / f"snd_{name}_{level}.wav"
        try:
            _TMP_DIR.mkdir(parents=True, exist_ok=True)
            if not sound.exists() or sound.stat().st_size != len(wav_data):
                sound.write_bytes(wav_data)
        except OSError as exc:
            log.debug("Failed to write notification WAV: %s", exc)
            return

    try:
        proc = await asyncio.create_subprocess_exec(
            *_player_cmd(player, sound),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=10)
    except asyncio.TimeoutError:
        # A custom file can legitimately be longer than a tone, but not so
        # long that it stacks up player processes.
        try:
            proc.kill()
        except Exception as exc:
            log.debug("Notification player had already exited: %s", exc)
    except Exception as exc:
        log.debug("Audio playback error: %s", exc)


# ── Public helpers (fire-and-forget, safe to call from any async context) ──────

def _fire(name: str, volume: float, custom: Optional[str] = None) -> None:
    # At zero, play nothing rather than playing silence: no temp file, no
    # player process, no device wake-up.
    if _clamp_volume(volume) <= 0.0:
        return
    asyncio.create_task(_play(name, volume, custom))


def play_clip(volume: float = 1.0, custom: Optional[str] = None) -> None:
    """Fire-and-forget: play the clip-saved notification sound."""
    _fire("clip", volume, custom)


def play_clip_failed(volume: float = 1.0, custom: Optional[str] = None) -> None:
    """Fire-and-forget: play the clip-failed notification sound."""
    _fire("clip_failed", volume, custom)


def play_session_start(volume: float = 1.0, custom: Optional[str] = None) -> None:
    """Fire-and-forget: play the session-started notification sound."""
    _fire("session_start", volume, custom)


def play_session_end(volume: float = 1.0, custom: Optional[str] = None) -> None:
    """Fire-and-forget: play the session-ended notification sound."""
    _fire("session_end", volume, custom)


def play_highlight(volume: float = 1.0, custom: Optional[str] = None) -> None:
    """Fire-and-forget: play the session-highlight marker sound."""
    _fire("highlight", volume, custom)


def play_screenshot(volume: float = 1.0, custom: Optional[str] = None) -> None:
    """Fire-and-forget: play the screenshot-taken notification sound."""
    _fire("screenshot", volume, custom)
