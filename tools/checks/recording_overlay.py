"""Real FFmpeg regression for optional post-save overlays and audio preservation."""
import asyncio
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock, AsyncMock

from gloaming import keys, pad_events
from gloaming.config import Config
from gloaming.main import GloamingDaemon
from gloaming.media import probe_media
from gloaming.recording_overlay import burn, _encode


class RecordingOverlayTests(unittest.TestCase):
    def test_both_overlays_preserve_original_and_audio(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with patch.object(keys,'KEYS_DIR',root/'keys'), patch.object(pad_events,'PAD_DIR',root/'pads'):
                path=root/'clip.mp4'
                subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=black:s=640x360:r=30:d=2',
                    '-f','lavfi','-i','sine=frequency=440:duration=2','-f','lavfi','-i','sine=frequency=880:duration=2',
                    '-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-c:a','aac',
                    '-metadata:s:a:0','handler_name=Game','-metadata:s:a:1','handler_name=Chat',str(path)],check=True,capture_output=True)
                original=path.read_bytes()
                def audio_hash(index):
                    return hashlib.sha256(subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map',f'0:a:{index}','-c','copy','-f','adts','-'])).hexdigest()
                hashes=[audio_hash(i) for i in range(2)]
                meta=asyncio.run(probe_media(path))
                keys.save_sidecar('clip',[[.5,1.5,'W']])
                ring=pad_events.PadRing(10);ring.record('button','BTN_SOUTH',True,at=.5)
                pad_events.save_sidecar('clip',ring.snapshot(0,2))
                cfg=Config().overlay;cfg.keys_recording_only=True;cfg.pad_recording_only=True
                burn(path,meta,cfg,'#8ab9f3')
                self.assertEqual((root/'.overlay-originals'/path.name).read_bytes(),original)
                self.assertEqual([audio_hash(i) for i in range(2)],hashes)
                tracks=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(path)]))['streams']
                self.assertEqual([t['tags']['handler_name'] for t in tracks if t['codec_type']=='audio'],['Game','Chat'])
                self.assertIsNone(keys.load_sidecar('clip'));self.assertIsNone(pad_events.load_sidecar('clip'))
                pixels=subprocess.check_output(['ffmpeg','-v','error','-ss','1','-i',str(path),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'])
                self.assertGreater(sum(pixels),100000)
                def keyboard_frame(at):
                    return subprocess.check_output(['ffmpeg','-v','error','-ss',str(at),'-i',str(path),
                        '-frames:v','1','-vf','crop=320:180:0:180','-pix_fmt','rgb24','-f','rawvideo','-'])
                released=keyboard_frame(.25);pressed=keyboard_frame(1);released_again=keyboard_frame(1.75)
                self.assertGreater(sum(abs(a-b) for a,b in zip(released,pressed)),1000)
                self.assertLess(sum(abs(a-b) for a,b in zip(released,released_again)),
                                sum(abs(a-b) for a,b in zip(released,pressed)))

    def test_hardware_failure_retries_software_without_changing_stream_maps(self):
        suffix=['-c:a','copy','-y','output.mp4']
        failure=subprocess.CalledProcessError(1,['ffmpeg'],stderr=b'encoder unavailable')
        with patch('gloaming.recording_overlay._nvenc_available',return_value=True), patch(
                'gloaming.recording_overlay.subprocess.run',side_effect=[failure,Mock()]) as run:
            self.assertEqual(_encode(['ffmpeg','-map','0:a?'],suffix,10),'libx264 (fallback)')
            first,second=[call.args[0] for call in run.call_args_list]
            self.assertIn('h264_nvenc',first);self.assertIn('libx264',second)
            self.assertEqual(first[-len(suffix):],suffix)
            self.assertEqual(second[-len(suffix):],suffix)

    def test_failure_keeps_original_and_inputs(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(keys,'KEYS_DIR',Path(temp)/'keys'):
            path=Path(temp)/'clip.mp4';path.write_bytes(b'original')
            keys.save_sidecar('clip',[])
            cfg=Config().overlay;cfg.keys_recording_only=True
            with patch('gloaming.recording_overlay.subprocess.run',side_effect=RuntimeError('encoder failed')):
                with self.assertRaises(RuntimeError): burn(path,dict(duration=1,width=640,height=360),cfg,'#8ab9f3')
            self.assertEqual(path.read_bytes(),b'original')
            self.assertEqual(keys.load_sidecar('clip'),[])
            self.assertFalse((path.parent/'.overlay-originals').exists())

    def test_recording_only_hides_live_panels_and_collects_inputs(self):
        daemon=GloamingDaemon.__new__(GloamingDaemon);daemon.cfg=Config();daemon._session_active=False
        daemon.cfg.overlay.keys=True;daemon.cfg.overlay.pad=True
        daemon.cfg.overlay.keys_recording_only=True;daemon.cfg.overlay.pad_recording_only=True
        daemon.key_ring=None;daemon.pad_ring=None
        daemon.key_overlay=Mock(sync=AsyncMock());daemon.pad_overlay=Mock(sync=AsyncMock())
        daemon.controller=Mock(pad_down={},axis_sent={},pad_observers=[],layout='xbox')
        asyncio.run(daemon._sync_key_overlay())
        self.assertFalse(daemon.key_overlay.sync.call_args.args[0])
        self.assertFalse(daemon.pad_overlay.sync.call_args.args[0])
        self.assertIsNotNone(daemon.key_ring);self.assertIsNotNone(daemon.pad_ring)

if __name__=='__main__': unittest.main()
