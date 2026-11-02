"""Opt-in real replay test. Uses isolated buffer/output directories, then deletes them."""
import asyncio
from pathlib import Path
import tempfile
import time
import sys
import logging
logging.basicConfig(level=logging.INFO)
from unittest.mock import patch
from gloaming.config import Config, load as load_config
from gloaming.live_replay import LiveReplayRecorder
from gloaming.media import probe_media

async def main():
 with tempfile.TemporaryDirectory(dir=Path.home()/'.cache/gloaming') as tmp:
  root=Path(tmp)
  real_settings='--current-config' in sys.argv
  cfg=load_config() if real_settings else Config();cfg.output.directory=str(root/'clips')
  if not real_settings:
   cfg.recording.display='screen';cfg.recording.resolution='2560x1440';cfg.recording.fps=60
  if not real_settings:
   cfg.recording.capture_audio=True;cfg.recording.capture_microphone=False
  cfg.recording.buffer_duration=15
  if not real_settings:
   cfg.overlay.keys_recording_only=True;cfg.overlay.pad_recording_only=True
  enabled={kind for kind in ("keys","pad") if getattr(cfg.overlay,kind+"_recording_only")}
  with patch('gloaming.live_replay.actual_home_dir',return_value=root),patch('gloaming.recorder._gsr_source_pref','flatpak'):
   recorder=LiveReplayRecorder(cfg)
   if real_settings: recorder.display_override="DP-3"
   try:
    await recorder.start()
    assert recorder.capture_overlay and recorder.capture_overlay.active,recorder.last_output()
    assert recorder.capture_overlay_baked==enabled
    recorder.capture_overlay.key('KEY_W',True)
    recorder.capture_overlay.pad('button','BTN_SOUTH',True)
    await asyncio.sleep(7)
    start=time.perf_counter();path=await recorder.save_clip(5);elapsed=time.perf_counter()-start
    assert path,recorder.last_clip_error
    meta=await probe_media(path)
    assert meta and meta['duration']>1
    assert meta.get('audio_tracks'),'Replay audio track missing'
    if real_settings: assert len(meta['audio_tracks'])==4,meta['audio_tracks']
    print('Replay save seconds:',round(elapsed,4),'duration:',meta['duration'])
    print('Capture overlay replay stream-copy: PASS')
    session=await recorder.start_session()
    assert session,'Session start failed'
    assert recorder.session_capture_overlay_baked==enabled
    await asyncio.sleep(2)
    session=await recorder.stop_session()
    assert session and session.exists()
    session_meta=await probe_media(session)
    assert session_meta.get('audio_tracks'),'Session audio track missing'
    if real_settings: assert len(session_meta['audio_tracks'])==4,session_meta['audio_tracks']
    assert recorder.capture_overlay.active,'Session stop must not stop replay overlay'
    print('Separate session uses live panels: PASS')
   finally:await recorder.stop()

asyncio.run(main())
