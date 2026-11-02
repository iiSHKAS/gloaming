"""Benchmark a temporary 10-second copy; never modifies the supplied recording."""
import asyncio,tempfile,time,subprocess,sys,logging
logging.basicConfig(level=logging.INFO)
if len(sys.argv) != 2:
 raise SystemExit("Usage: python -I tools/checks/overlay_benchmark.py /path/to/clip.mp4")
from pathlib import Path
from unittest.mock import patch
from gloaming import keys,pad_events
from gloaming.config import Config
from gloaming.media import probe_media
from gloaming.recording_overlay import burn
with tempfile.TemporaryDirectory() as temp:
 root=Path(temp);src=root/'clip.mp4'
 subprocess.run(['ffmpeg','-v','error','-i',sys.argv[1],'-t','10','-map','0','-c','copy',str(src)],check=True)
 with patch.object(keys,'KEYS_DIR',root/'keys'),patch.object(pad_events,'PAD_DIR',root/'pads'):
  keys.save_sidecar('clip',[[1,3,'W'],[5,7,'SPACE']]);ring=pad_events.PadRing(60)
  ring.record('button','BTN_SOUTH',True,at=1);ring.record('button','BTN_SOUTH',False,at=3)
  pad_events.save_sidecar('clip',ring.snapshot(0,10))
  cfg=Config().overlay;cfg.keys_recording_only=True;cfg.pad_recording_only=True
  meta=asyncio.run(probe_media(src));start=time.perf_counter()
  burn(src,meta,cfg,'#8ab9f3');print('seconds',round(time.perf_counter()-start,3),'resolution',meta['width'],meta['height'],flush=True)
