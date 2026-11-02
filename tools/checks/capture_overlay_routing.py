import copy
import unittest
from unittest.mock import Mock
from gloaming.config import Config
from gloaming.main import GloamingDaemon
from gloaming.recorder import _argv_matches, _program_name

class RoutingTests(unittest.TestCase):
 def test_baked_panels_are_not_processed_again(self):
  daemon=GloamingDaemon.__new__(GloamingDaemon);daemon.cfg=Config()
  daemon.cfg.overlay.keys_recording_only=True;daemon.cfg.overlay.pad_recording_only=True
  daemon.cfg.overlay.keys_in_clips=True;daemon.cfg.overlay.pad_in_clips=True
  daemon.recorder=Mock(capture_overlay_baked={'keys','pad'},session_capture_overlay_baked={'pad'})
  result=daemon._post_save_overlay_settings()
  self.assertFalse(result.keys_recording_only);self.assertFalse(result.pad_recording_only)
  self.assertFalse(result.keys_in_clips);self.assertFalse(result.pad_in_clips)
  self.assertTrue(daemon.cfg.overlay.keys_recording_only)
  session=daemon._post_save_overlay_settings(session=True)
  self.assertTrue(session.keys_recording_only);self.assertFalse(session.pad_recording_only)
 def test_fallback_keeps_post_processing(self):
  daemon=GloamingDaemon.__new__(GloamingDaemon);daemon.cfg=Config();daemon.cfg.overlay.pad_recording_only=True
  daemon.recorder=Mock(capture_overlay_baked=set())
  self.assertTrue(daemon._post_save_overlay_settings().pad_recording_only)
 def test_buffer_restarts_only_for_mode_changes(self):
  daemon=GloamingDaemon.__new__(GloamingDaemon);daemon.cfg=Config()
  original=daemon._recording_signature();daemon.cfg.overlay.pad_scale=2
  self.assertEqual(original,daemon._recording_signature())
  daemon.cfg.overlay.pad_recording_only=True
  self.assertNotEqual(original,daemon._recording_signature())
 def test_private_flatpak_process_is_tracked(self):
  args=['flatpak','run','--filesystem=xdg-run/gloaming-capture-overlay',
        '--command=/home/test/run-gsr','com.dec05eba.gpu_screen_recorder','-w','screen']
  self.assertEqual(_program_name(args),'gpu-screen-recorder')
  self.assertTrue(_argv_matches(['bwrap','--','/home/test/run-gsr','-w','screen'],args))
  self.assertFalse(_argv_matches(['bwrap','--','/other/program','-w','screen'],args))
if __name__=='__main__':unittest.main()
