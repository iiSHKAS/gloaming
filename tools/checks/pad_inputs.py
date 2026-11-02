"""Controller sidecar timing, lifecycle, hidden capture and real export checks."""
import asyncio
import copy
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from gloaming import pad_events, pad_export
from gloaming.config import Config
from gloaming.editor import Source, build_export_cmd
from gloaming.main import GloamingDaemon


class PadTests(unittest.TestCase):
    def test_preview_uses_current_art_and_reacts_to_inputs(self):
        from gloaming.pad_preview import render
        for layout in ('playstation', 'xbox'):
            idle = render({'layout': layout})
            pressed = render({'layout': layout, 'buttons': {'BTN_SOUTH': True}, 'axes': {'ls': [1, -1]}})
            self.assertTrue(idle.startswith(b'\x89PNG'))
            self.assertNotEqual(idle, pressed)
            self.assertEqual(idle, render({'layout': layout}))
        with self.assertRaises(ValueError): render({'axes': {'ls': [float('nan'), 0]}})

    def test_window_and_trim_preserve_held_state_and_axes(self):
        ring = pad_events.PadRing(10)
        ring.record('button', 'BTN_SOUTH', True, at=1)
        ring.record('axis', 'ls', .5, -.25, at=2)
        ring.record('layout', 'playstation', at=3)
        ring.record('button', 'BTN_SOUTH', False, at=15)
        data = ring.snapshot(10, 20)
        self.assertTrue(data['initial']['buttons']['BTN_SOUTH'])
        self.assertEqual(data['initial']['axes']['ls'], [.5, -.25])
        self.assertEqual(data['initial']['layout'], 'playstation')
        self.assertEqual(data['events'][0][0], 5)
        before = copy.deepcopy(data)
        cut = pad_events.cut(data, 4, 8)
        self.assertTrue(cut['initial']['buttons']['BTN_SOUTH'])
        self.assertEqual(cut['events'][0][0], 1)
        self.assertEqual(data, before)
        cut = pad_events.cut(data, 6, 8)
        self.assertFalse(cut['initial']['buttons']['BTN_SOUTH'])
        self.assertEqual(cut['events'], [])

    def test_hidden_overlay_still_records_when_enabled(self):
        daemon = GloamingDaemon.__new__(GloamingDaemon)
        daemon.cfg = Config()
        daemon.cfg.overlay.pad = False
        daemon.pad_ring = pad_events.PadRing(60)
        daemon._pad_layout = lambda: 'playstation'
        daemon.pad_overlay = Mock()
        daemon._on_pad_event('button', 'BTN_EAST', True)
        self.assertTrue(daemon.pad_ring.current['buttons']['BTN_EAST'])
        self.assertEqual(daemon.pad_ring.current['layout'], 'playstation')
        daemon.pad_overlay.send.assert_not_called()

    def test_private_sidecar_rename_delete_and_copy_trim(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(pad_events, 'PAD_DIR', Path(tmp)):
            ring = pad_events.PadRing(60)
            ring.record('button', 'BTN_SOUTH', True, at=5)
            data = ring.snapshot(0, 10)
            pad_events.save_sidecar('original', data)
            self.assertEqual(pad_events.sidecar_path('original').stat().st_mode & 0o777, 0o600)
            pad_events.save_sidecar('trim', pad_events.cut(data, 6, 9))
            self.assertEqual(pad_events.load_sidecar('original'), data)
            self.assertTrue(pad_events.load_sidecar('trim')['initial']['buttons']['BTN_SOUTH'])
            pad_events.move_sidecar('trim', 'renamed')
            self.assertIsNone(pad_events.load_sidecar('trim'))
            self.assertIsNotNone(pad_events.load_sidecar('renamed'))
            pad_events.delete_sidecar('renamed')
            self.assertIsNone(pad_events.load_sidecar('renamed'))

    def test_real_export_draws_recorded_inputs_and_keeps_gaps_transparent(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(pad_events, 'PAD_DIR', Path(temp)/'sidecars'):
            root = Path(temp)
            source = root/'source.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=black:s=320x240:r=20:d=2',
                            '-c:v','libx264',str(source)],check=True,capture_output=True)
            ring = pad_events.PadRing(60)
            ring.record('button','BTN_SOUTH',True,at=.5)
            ring.record('axis','ls',1,-1,at=.5)
            ring.record('axis','rt',1,at=.5)
            ring.record('layout','playstation',at=1)
            pad_events.save_sidecar('source',ring.snapshot(0,2))
            project = dict(version=1,tracks=[dict(id='v',type='video',label='V'),dict(id='t',type='text',label='T')],
                items=[dict(id='clip',kind='clip',trackId='v',clipId='source',start=1,dur=2,offset=0,muted=True)])
            pad = pad_export.render(project,240,root/'pad.mov','#8ab9f3')
            self.assertTrue(pad.exists())
            sources = {'source':Source(source,2,320,240,False,0)}
            output=root/'export.mp4'
            subprocess.run(build_export_cmd(project,sources,output,pad_burn=pad,pad_position=[0,0]),check=True,capture_output=True)
            def frame(at):
                return subprocess.check_output(['ffmpeg','-v','error','-ss',str(at),'-i',str(output),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])
            empty=frame(.5);visible=frame(1.5)
            self.assertLess(sum(empty), len(empty)*3)
            self.assertGreater(sum(visible), sum(empty)+5000)
            # The selected top-left position must survive actual FFmpeg export.
            top_left=sum(visible[(y*320+x)*3+c] for y in range(100) for x in range(100) for c in range(3))
            bottom_right=sum(visible[(y*320+x)*3+c] for y in range(140,240) for x in range(220,320) for c in range(3))
            self.assertGreater(top_left, bottom_right+5000)


if __name__ == '__main__': unittest.main()
