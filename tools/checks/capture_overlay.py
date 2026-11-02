"""Exercise the real GPU plugin offscreen and private Cairo transport."""
import asyncio
from pathlib import Path
import subprocess
import tempfile
import time
import struct
from gloaming.capture_overlay import CaptureOverlay
from gloaming.config import Config

cfg=Config();cfg.overlay.keys_recording_only=True;cfg.overlay.pad_recording_only=True
capture=CaptureOverlay(cfg)
try:
 capture.key('KEY_W',True);capture.pad('button','BTN_SOUTH',True)
 capture._render(capture.settings,capture.accent,capture.pressed,capture.pad_state,1440)
 with tempfile.TemporaryDirectory() as tmp:
  binary=Path(tmp)/'check'
  subprocess.run(['cc','-O2',str(Path(__file__).with_name('capture_overlay_gl.c')),'-o',str(binary),'-lEGL','-lGL','-ldl'],check=True)
  subprocess.run([str(binary),str(capture.plugin)],check=True)
  # Position 5 is custom. BGRA red on top and blue below must stay in that
  # order in GSR's framebuffer (whose GL row zero becomes video row zero).
  frame=capture.plugin.parent/'frame.bin'
  frame.write_bytes(struct.pack('<IIIIIii',0x564f5631,1,16,16,5,100,100)
                    + bytes([0,0,255,255])*128 + bytes([255,0,0,255])*128)
  subprocess.run([str(binary),str(capture.plugin),'orientation'],check=True)
 start=time.perf_counter()
 for i in range(120):
  capture.pad('axis','ls',i/120,0)
  capture._render(capture.settings,capture.accent,capture.pressed,capture.pad_state,1440)
 print('changing_state_render_ms:',round((time.perf_counter()-start)*1000/120,3))
finally:
 asyncio.run(capture.stop())
