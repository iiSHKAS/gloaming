"""Integration checks: run with the project's Python; requires ffmpeg/ffprobe."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from gloaming.config import Config
from gloaming.live_replay import LiveReplayRecorder


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_packets', '-show_streams',
        '-show_entries', 'packet=stream_index,pts_time:stream=index,codec_type,start_time',
        '-of', 'json', str(path)], text=True))


class CaptureLayoutTests(unittest.TestCase):
    def test_multiple_outputs_and_microphone_stay_separate(self):
        from gloaming.recorder import _gsr_audio_args, GSRRecorder
        from unittest.mock import patch
        cfg = Config()
        cfg.recording.capture_audio = True
        cfg.recording.capture_microphone = True
        cfg.recording.audio_tracks = ['device:speakers.monitor', 'device:headset.monitor']
        cfg.recording.audio_tracks_mix_first = True
        audio = _gsr_audio_args(cfg.recording)
        values = audio[1::2]
        self.assertEqual(values[1:], ['device:speakers.monitor', 'device:headset.monitor', 'default_input'])
        rec = LiveReplayRecorder(cfg)
        rec.directory = Path('/tmp/unused')
        with patch.object(GSRRecorder, '_build_cmd', return_value=['gpu-screen-recorder', *audio]):
            rec._build_cmd()
        self.assertEqual(rec._audio_track_titles,
                         ['Combined mix', 'speakers.monitor', 'headset.monitor', 'Microphone'])
        cfg.recording.audio_tracks = ['default_output']
        self.assertEqual(rec._audio_track_titles[1], 'speakers.monitor')

    def test_output_slots_always_include_a_playback_mix(self):
        from gloaming.recorder import _gsr_audio_args
        cfg = Config()
        cfg.recording.capture_audio = True
        cfg.recording.capture_microphone = True
        cfg.recording.audio_tracks = ['device:game.monitor', 'device:media.monitor']
        cfg.recording.audio_output_slots = [{'source': 'device:media.monitor', 'enabled': True}]
        cfg.recording.audio_tracks_mix_first = False
        args = _gsr_audio_args(cfg.recording)
        self.assertEqual(args[1], 'device:game.monitor|device:media.monitor|default_input')
        self.assertEqual(args[3::2], ['device:game.monitor', 'device:media.monitor', 'default_input'])


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class ExportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        cfg = Config()
        cfg.output.directory = str(root / 'clips')
        cfg.recording.apply_watermark = False
        self.recorder = LiveReplayRecorder(cfg)
        self.recorder.directory = root
        self.recorder.generation = 'test'
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
            'testsrc2=size=160x90:rate=30', '-f', 'lavfi', '-i',
            'sine=frequency=440:sample_rate=48000',
            '-itsoffset', '0.15', '-f', 'lavfi', '-i',
            'sine=frequency=880:sample_rate=48000',
            '-map', '0:v', '-map', '1:a', '-map', '2:a', '-t', '12',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60',
            '-sc_threshold', '0', '-c:a', 'aac', '-f', 'hls',
            '-hls_time', '2', '-hls_list_size', '0', '-hls_flags',
            'independent_segments+program_date_time', str(root / 'live.m3u8')
        ], check=True, capture_output=True)

    async def test_boundaries_and_audio_timeline(self):
        segments = self.recorder.segments()
        source = probe(self.recorder.directory / 'live.m3u8')
        for offset in (0, 0.00001, 0.75):
            with self.subTest(offset=offset):
                clip = await self.recorder.save_range(
                    'test', segments[0].start + offset, segments[-1].end)
                result = probe(clip)
                self.assertEqual(len(result['streams']), 3)
                # All packets, including packets across segment boundaries,
                # must move by ONE shared offset. This checks A/V sync and
                # intentional offsets between multiple audio tracks.
                shifts = []
                for index in range(3):
                    before = [float(p['pts_time']) for p in source['packets']
                              if p['stream_index'] == index]
                    after = [float(p['pts_time']) for p in result['packets']
                             if p['stream_index'] == index]
                    self.assertGreaterEqual(len(after), len(before) - 2)
                    shifts.extend(a - b for a, b in zip(after, before))
                self.assertLess(max(shifts) - min(shifts), 0.002)
                self.assertLess(float(result['streams'][0]['start_time']), 0.05)
                subprocess.run(['ffmpeg', '-v', 'error', '-i', str(clip),
                                '-f', 'null', '-'], check=True, capture_output=True)

    async def test_later_segment_and_partial_end(self):
        segments = self.recorder.segments()
        clip = await self.recorder.save_range(
            'test', segments[2].start + 0.7, segments[4].start + 0.5)
        result = probe(clip)
        self.assertLess(float(result['streams'][0]['start_time']), 0.1)
        video = [float(p['pts_time']) for p in result['packets'] if p['stream_index'] == 0]
        self.assertAlmostEqual(max(video) - min(video), 4.5, delta=0.1)

    async def test_rounded_playlist_boundary(self):
        # GSR writes millisecond program dates and finer EXTINF durations.
        # A tiny overlap must not add the previous segment to the export.
        from dataclasses import replace
        from unittest.mock import patch
        segments = self.recorder.segments()
        segments[1] = replace(segments[1], duration=segments[1].duration + 0.000244)
        with patch.object(self.recorder, 'segments', return_value=segments):
            clip = await self.recorder.save_range(
                'test', segments[2].start + 0.00001, segments[4].start + 0.5)
        video = [float(p['pts_time']) for p in probe(clip)['packets'] if p['stream_index'] == 0]
        self.assertAlmostEqual(max(video) - min(video), 4.5, delta=0.1)

    async def test_range_beyond_last_segment_is_rejected(self):
        end = self.recorder.segments()[-1].end
        with self.assertRaisesRegex(ValueError, 'not ready'):
            await self.recorder.save_range('test', end + 0.01, end + 0.05)
        with self.assertRaises(ValueError):
            await self.recorder.save_range('test', float('nan'), end)

    async def test_source_names_survive_mp4_and_probe(self):
        from gloaming.media import probe_media
        self.recorder._audio_track_titles = ['Speakers', 'Headphones']
        rc = self.recorder.cfg.recording
        rc.capture_audio = True
        rc.capture_microphone = False
        rc.audio_tracks = ['device:speakers.monitor', 'device:headphones.monitor']
        rc.audio_track_volumes = {'device:speakers.monitor': 0.5}
        segments = self.recorder.segments()
        clip = await self.recorder.save_range('test', segments[0].start, segments[1].end)
        info = await probe_media(clip)
        self.assertEqual([s['title'] for s in info['audio_tracks']], ['Speakers', 'Headphones'])

    async def test_editor_mute_and_remove_only_selected_source(self):
        import hashlib
        import math
        import struct
        from gloaming.editor import Source, build_export_cmd, validate_project
        segments = self.recorder.segments()
        clip = await self.recorder.save_range('test', segments[0].start, segments[1].end)
        original = hashlib.sha256(clip.read_bytes()).digest()
        sources = {'clip': Source(clip, 4, 160, 90, True, 2)}
        for removed in (False, True):
            items = [dict(id='video', kind='clip', trackId='v', clipId='clip',
                          start=0, dur=2, offset=0, muted=True),
                     dict(id='keep', kind='audio', trackId='a1', clipId='clip',
                          start=0, dur=2, offset=0, audioStream=1, volume=1)]
            if not removed:
                items.append(dict(id='mute', kind='audio', trackId='a0', clipId='clip',
                                  start=0, dur=2, offset=0, audioStream=0, muted=True))
            project, errors = validate_project(dict(version=1, items=items, tracks=[
                dict(id='v', type='video', label='Video'), dict(id='text', type='text', label='Text'),
                dict(id='a0', type='audio', label='Speakers'), dict(id='a1', type='audio', label='Headphones')
            ]), sources)
            self.assertFalse(errors, errors)
            output = Path(self.temp.name) / f'edited-{removed}.mp4'
            cmd = build_export_cmd(project, sources, output)
            subprocess.run(cmd, check=True, capture_output=True)
            pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(output),
                                          '-ss', '0.5', '-t', '1', '-vn', '-ac', '1',
                                          '-ar', '48000', '-f', 'f32le', '-'])
            samples = struct.unpack(f'<{len(pcm)//4}f', pcm)
            def level(hz):
                real = sum(x * math.cos(2 * math.pi * hz * n / 48000) for n, x in enumerate(samples))
                imag = sum(x * math.sin(2 * math.pi * hz * n / 48000) for n, x in enumerate(samples))
                return math.hypot(real, imag)
            self.assertGreater(level(880), 100 * level(440))
            self.assertEqual(hashlib.sha256(clip.read_bytes()).digest(), original)

    async def test_normal_preview_mixes_existing_sources_without_changing_original(self):
        import hashlib
        import math
        import struct
        from unittest.mock import patch
        from gloaming import share
        from gloaming.media import probe_media
        segments = self.recorder.segments()
        clip = await self.recorder.save_range('test', segments[0].start, segments[1].end)
        original = hashlib.sha256(clip.read_bytes()).digest()
        meta = await probe_media(clip)
        with patch.object(share, 'PROXY_DIR', Path(self.temp.name) / 'previews'):
            mixed = await share._make_preview_proxy(clip, meta['vcodec'], meta['audio_tracks'])
        self.assertIsNotNone(mixed)
        mixed_meta = await probe_media(mixed)
        self.assertEqual(mixed_meta['audio_streams'], 1)
        pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(mixed), '-ss', '0.5',
                                       '-t', '1', '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])
        samples = struct.unpack(f'<{len(pcm)//4}f', pcm)
        def level(hz):
            return abs(sum(x * complex(math.cos(2*math.pi*hz*n/48000), math.sin(2*math.pi*hz*n/48000))
                           for n, x in enumerate(samples)))
        self.assertGreater(level(440), 100 * level(2000))
        self.assertGreater(level(880), 100 * level(2000))
        self.assertEqual(hashlib.sha256(clip.read_bytes()).digest(), original)


if __name__ == '__main__':
    unittest.main()
