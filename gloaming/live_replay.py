"""Private rolling HLS DVR. One GPU capture; only explicit exports are clips."""
from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
from datetime import datetime
import math
from pathlib import Path
import re
import secrets
import shutil
import tempfile
import time

from .recorder import (GSRRecorder, _next_clip_path, _apply_volume_mix,
                       _apply_track_volumes, _apply_watermark, _separate_track_layout)
from .runtime import actual_home_dir

SEGMENT_SECONDS = 2


@dataclass(frozen=True)
class Segment:
    name: str
    start: float
    duration: float

    @property
    def end(self):
        return self.start + self.duration


def parse_playlist(text: str) -> list[Segment]:
    segments = []
    start = None
    duration = None
    for line in text.splitlines():
        if line.startswith('#EXT-X-PROGRAM-DATE-TIME:'):
            start = datetime.fromisoformat(line.split(':', 1)[1].replace('Z', '+00:00')).timestamp()
        elif line.startswith('#EXTINF:'):
            duration = float(line.split(':', 1)[1].split(',')[0])
        elif line and not line.startswith('#'):
            if start is not None and duration is not None and re.fullmatch(r'live\d+\.ts', line):
                segments.append(Segment(line, start, duration))
                start += duration
            duration = None
    return segments


class LiveReplayRecorder(GSRRecorder):
    def __init__(self, cfg):
        super().__init__(cfg)
        self.directory: Path | None = None
        self.generation = ''
        self._save_lock = asyncio.Lock()
        self._audio_track_titles: list[str] = []

    @property
    def window_seconds(self):
        return max(5, min(1800, int(self.cfg.recording.buffer_duration)))

    async def start(self):
        root = actual_home_dir() / '.cache' / 'gloaming' / 'live-replay'
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        # The daemon has an exclusive instance lock. Remove only our previous
        # crash leftovers, never recordings or arbitrary user directories.
        for path in root.glob('session-*'):
            if path.is_dir() and not path.is_symlink():
                await asyncio.to_thread(shutil.rmtree, path)
        self.directory = Path(tempfile.mkdtemp(prefix='session-', dir=root))
        self.generation = secrets.token_hex(12)
        try:
            await super().start()
        except BaseException:
            await self.stop()
            raise

    def _build_cmd(self, cpu_encoder=False, avoid_codec=None):
        # Reuse capture target, audio and GPU fallback handling. HLS requires
        # an independently decodable H.264/AAC stream, not a second encoder.
        original = self.cfg
        cfg = copy.deepcopy(original)
        cfg.recording.gsr_args = ''
        cfg.recording.encoder = 'auto'
        # HLS below forces H.264, whose GSR path is 8-bit. Resolve codec
        # capabilities with that depth too, without changing saved preferences.
        cfg.recording.color_depth = '8'
        cfg.recording.container = 'mp4'
        cfg.recording.gsr_replay_storage = 'ram'
        self.cfg = cfg
        try:
            command = super()._build_cmd(cpu_encoder, avoid_codec)
        finally:
            self.cfg = original
        # Snapshot the actual capture command, not mutable settings at export
        # time. A repeated -a is a separate stream; pipes mix into one stream.
        sources = [command[i + 1] for i, flag in enumerate(command[:-1]) if flag == '-a']
        names = {'default_output': 'Default output', 'default_input': 'Microphone'}
        self._audio_track_titles = [
            ' + '.join(names.get(part, part.removeprefix('device:')) for part in source.split('|'))
            for source in sources
        ]
        if _separate_track_layout(original.recording)[1] and len(sources) > 1:
            self._audio_track_titles[0] = 'Combined mix'
        for flag in ('-r', '-c', '-o', '-k', '-ac'):
            while flag in command:
                index = command.index(flag)
                del command[index:index + 2]
        assert self.directory is not None
        return command + [
            '-c', 'hls', '-k', 'h264', '-ac', 'aac', '-keyint', '2',
            '-ffmpeg-opts', f'hls_time={SEGMENT_SECONDS};hls_list_size={math.ceil(self.window_seconds / SEGMENT_SECONDS)};hls_delete_threshold=1;'
            'hls_flags=delete_segments+temp_file+independent_segments+program_date_time',
            '-o', str(self.directory / 'live.m3u8'),
        ]

    def segments(self):
        if self.directory is None:
            return []
        try:
            segments = parse_playlist((self.directory / 'live.m3u8').read_text())
        except (OSError, ValueError):
            return []
        if not segments:
            return []
        cutoff = segments[-1].end - self.window_seconds
        return [s for s in segments if s.end > cutoff]

    def status(self):
        segments = self.segments()
        return dict(enabled=True, running=self.is_healthy(), session=self.generation,
                    window=self.window_seconds, start=max(segments[0].start, segments[-1].end-self.window_seconds) if segments else None,
                    end=segments[-1].end if segments else None,
                    playlist=f'/api/live/{self.generation}/live.m3u8',
                    error=self.last_output() if not self.is_healthy() else '')

    async def stop(self):
        await super().stop()
        async with self._save_lock:
            directory, self.directory = self.directory, None
            if directory:
                await asyncio.to_thread(shutil.rmtree, directory, True)

    async def save_range(self, session: str, start: float, end: float):
        async with self._save_lock:
            if session != self.generation or self.directory is None:
                raise ValueError('The live recording restarted. Select a new range.')
            segments = self.segments()
            if not all(math.isfinite(n) for n in (start, end)) or end <= start:
                raise ValueError('Choose a valid start and end.')
            if not segments or start < max(segments[0].start, segments[-1].end-self.window_seconds) or end > segments[-1].end + .1:
                raise ValueError('This range has expired or is not ready yet.')
            end = min(end, segments[-1].end)
            if start >= end:
                raise ValueError('This range has expired or is not ready yet.')
            # PROGRAM-DATE-TIME is rounded to milliseconds by the muxer while
            # EXTINF has microseconds. Adjacent segments can therefore appear
            # to overlap slightly: use start boundaries to pick the keyframe.
            first = max(i for i, s in enumerate(segments) if s.start <= start)
            selected = [s for s in segments[first:] if s.start < end]
            # Pin completed segments during the export; rotation can continue.
            with tempfile.TemporaryDirectory(prefix='export-', dir=self.directory) as temp:
                temp = Path(temp)
                try:
                    for s in selected:
                        (temp / s.name).hardlink_to(self.directory / s.name)
                except FileNotFoundError:
                    raise ValueError('This range just expired. Select a newer range.') from None
                # These TS files share one capture clock. The concat demuxer
                # instead retimes each file using its longest stream, which
                # introduces gaps/offsets at every audio packet overhang.
                # A finite HLS snapshot preserves the original packet timing.
                manifest = temp / 'input.m3u8'
                manifest.write_text(
                    '#EXTM3U\n#EXT-X-VERSION:6\n'
                    f'#EXT-X-TARGETDURATION:{math.ceil(max(s.duration for s in selected))}\n'
                    '#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n'
                    '#EXT-X-INDEPENDENT-SEGMENTS\n'
                    + ''.join(f'#EXTINF:{s.duration:.6f},\n{s.name}\n' for s in selected)
                    + '#EXT-X-ENDLIST\n')
                output = temp / 'clip.mp4'
                # Stream copy must start at the segment's keyframe. Output-side
                # -ss used to drop video until the NEXT keyframe while keeping
                # audio, leaving up to a GOP of audio before the first picture.
                # Keep the preceding keyframe (usually <= 2s of pre-roll) and
                # use the same origin for both streams and the requested end.
                # Fixed decimal avoids scientific notation, rejected by FFmpeg
                # for tiny durations produced by epoch timestamp subtraction.
                export_duration = end - selected[0].start
                metadata = []
                for index, title in enumerate(self._audio_track_titles):
                    # MP4 stores the track name as handler_name; Matroska and
                    # some other readers use title instead.
                    metadata += [f'-metadata:s:a:{index}', f'title={title}',
                                 f'-metadata:s:a:{index}', f'handler_name={title}']
                proc = await asyncio.create_subprocess_exec(
                    'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', str(manifest), '-t', f'{export_duration:.6f}',
                    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
                    *metadata,
                    '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', str(output),
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
                try:
                    _, error = await asyncio.wait_for(proc.communicate(), 120)
                except BaseException:
                    if proc.returncode is None:
                        proc.kill()
                        await proc.wait()
                    raise
                if proc.returncode or not output.exists():
                    raise ValueError(error.decode(errors='replace')[-500:] or 'Export failed.')
                await _apply_volume_mix(output, self.cfg.recording)
                await _apply_track_volumes(output, self.cfg.recording)
                if self.cfg.recording.apply_watermark:
                    await _apply_watermark(output)
                self._out_dir.mkdir(parents=True, exist_ok=True)
                final = _next_clip_path(self._out_dir, ext='mp4', template=self._clip_name_template())
                await asyncio.to_thread(shutil.move, str(output), str(final))
            # HLS uses wall-clock program dates. Sidecars use monotonic input time.
            clock_offset = time.monotonic() - time.time()
            self.last_clip_span = (selected[0].start + clock_offset, end + clock_offset)
            self._emit(final)
            return final

    async def save_clip(self, duration=None):
        self.last_save_signal_at = time.monotonic()
        segments = self.segments()
        if not segments:
            self.last_clip_error = 'The live buffer is still warming up.'
            return None
        end = segments[-1].end
        start = max(segments[0].start, end-min(duration or self.cfg.recording.clip_duration, self.window_seconds))
        try:
            return await self.save_range(self.generation, start, end)
        except (ValueError, OSError) as exc:
            self.last_clip_error = str(exc)
            return None
