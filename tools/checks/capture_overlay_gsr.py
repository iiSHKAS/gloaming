"""Opt-in real GSR smoke test: three seconds in a disposable directory.
The recording is never added to the library and is deleted after probing.
"""
import asyncio
import json
import os
from pathlib import Path
import signal
import tempfile
from gloaming.capture_overlay import CaptureOverlay
from gloaming.config import Config

async def main():
 cfg=Config();cfg.overlay.keys_recording_only=True;cfg.overlay.pad_recording_only=True
 capture=CaptureOverlay(cfg)
 proc=None
 try:
  capture.key('KEY_W',True);capture.pad('button','BTN_SOUTH',True)
  capture._render(capture.settings,capture.accent,capture.pressed,capture.pad_state,360)
  await capture.start()
  with tempfile.TemporaryDirectory(dir=Path.home()/'.cache/gloaming') as tmp:
   dest=Path(tmp)/'test.mp4'
   proc=await asyncio.create_subprocess_exec('flatpak','run','--filesystem=xdg-run/gloaming-capture-overlay','--command='+str(Path.home()/'.local/share/gloaming-dev/gsr-overlay/run-gsr'),
     'com.dec05eba.gpu_screen_recorder','-w','screen','-s','640x360','-f','30','-k','h264',
     # Exercise amix as well as separate tracks; video-only smoke tests miss
     # an incomplete private FFmpeg build and the resulting fallback.
     '-a','default_output|default_output','-a','default_output',
     '-c','mp4','-p',str(capture.plugin),'-o',str(dest),stdout=asyncio.subprocess.DEVNULL,
     stderr=asyncio.subprocess.PIPE,start_new_session=True)
   reader=asyncio.create_task(proc.communicate())
   await asyncio.sleep(3)
   initialized=capture.active
   if proc.returncode is None:os.killpg(proc.pid,signal.SIGINT)
   _,err=await asyncio.wait_for(reader,20)
   print(err.decode(errors='replace')[-6000:])
   assert initialized,'GSR plugin did not initialize'
   assert proc.returncode in (0,-signal.SIGINT),proc.returncode
   assert b'external texture not loaded' not in err, 'GSR external texture regression'
   probe=await asyncio.create_subprocess_exec('ffprobe','-v','error','-show_entries','format=duration:stream=codec_type',
      '-of','json',str(dest),stdout=asyncio.subprocess.PIPE)
   out,_=await probe.communicate()
   metadata=json.loads(out)
   assert float(metadata['format']['duration'])>1
   assert sum(s['codec_type']=='audio' for s in metadata['streams'])==2,'Mixed/separate audio missing'
   decode=await asyncio.create_subprocess_exec('ffmpeg','-v','error','-ss','1','-i',str(dest),
      '-frames:v','1','-vf','crop=iw/3:ih/3:iw/3:ih/3','-pix_fmt','rgb24','-f','rawvideo','-',
      stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
   pixels,errors=await decode.communicate()
   assert decode.returncode==0 and pixels,errors
   assert max(pixels)-min(pixels)>10,'Capture center is blank; inspect capture backend'
   print('Real GSR plugin capture and nonblank background: PASS')
 finally:
  if proc is not None and proc.returncode is None:
   os.killpg(proc.pid,signal.SIGKILL);await proc.wait()
  await capture.stop()

asyncio.run(main())
