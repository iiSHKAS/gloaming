"""Private Cairo panels consumed by a GSR GPU plugin before video encoding."""
import asyncio
import copy
import hashlib
import json
from functools import lru_cache
import logging
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import time

from . import key_overlay, pad_art_ps5, pad_art_xbox, pad_events
from .keys import EVDEV_TO_KEY
from .runtime import actual_home_dir

log = logging.getLogger('gloaming.capture_overlay')
POSITIONS = ['bottom-left','bottom-right','top-left','top-right','bottom-center','custom']


@lru_cache(maxsize=1)
def capture_backend():
    """Only use the locally tested build, never the broken upstream KMS path."""
    root=actual_home_dir()/'.local/share/gloaming-dev/gsr-overlay'
    try:
        receipt=json.loads((root/'verified.json').read_text())
        if receipt.get('sha256') != hashlib.sha256((root/'gpu-screen-recorder').read_bytes()).hexdigest():
            return None
        command=['flatpak','run','--filesystem=xdg-run/gloaming-capture-overlay','--command='+str(root/'run-gsr'),'com.dec05eba.gpu_screen_recorder']
        subprocess.run([*command,'--version'],check=True,capture_output=True,timeout=10)
        return command
    except (OSError,ValueError,subprocess.SubprocessError):
        return None


def build_plugin():
    native = Path(__file__).parent/'native'
    digest = hashlib.sha256((native/'recording_overlay.c').read_bytes()+(native/'gsr_plugin.h').read_bytes()).hexdigest()[:16]
    cache = actual_home_dir()/'.cache/gloaming/capture-overlay'
    cache.mkdir(parents=True,exist_ok=True,mode=0o700)
    target = cache/f'overlay-{digest}.so'
    if not target.exists():
        temp = target.with_suffix(f'.{os.getpid()}.tmp')
        try:
            subprocess.run(['cc','-O2','-shared','-fPIC','-o',str(temp),str(native/'recording_overlay.c'),
                            '-lGL','-ldl'],check=True,capture_output=True,timeout=30)
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)
    return target


class CaptureOverlay:
    def __init__(self, cfg):
        plugin = build_plugin()
        # Runtime storage is tmpfs: animated panels must not continually write to SSD.
        runtime=Path(os.environ.get('XDG_RUNTIME_DIR',f'/run/user/{os.getuid()}'))/'gloaming-capture-overlay'
        runtime.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.directory = Path(tempfile.mkdtemp(prefix='run-',dir=runtime))
        self.plugin = self.directory/'overlay.so'
        shutil.copy2(plugin,self.plugin)
        self.modes = {kind for kind in ("keys", "pad") if getattr(cfg.overlay,kind+"_recording_only")}
        self.settings = copy.deepcopy(cfg.overlay)
        self.accent = cfg.sharing.embed_color
        self.pressed = set()
        self.pad_state = {'buttons':{},'axes':{},'layout':'xbox'}
        self.panel_cache = {}
        self.version = 0
        self.task = None
        self.failed = False
        self._write_empty()

    def _write_empty(self):
        path=self.directory/'empty.tmp';path.write_bytes(struct.pack('<II',0x564f5631,0));path.replace(self.directory/'frame.bin')

    @property
    def active(self):
        return not self.failed and (self.directory/'ready').exists()

    def configure(self,cfg,layout):
        self.settings=copy.deepcopy(cfg.overlay);self.accent=cfg.sharing.embed_color
        for kind in ('keys','pad'):
            setattr(self.settings,kind+'_recording_only',kind in self.modes)
        self.pad_state['layout']=layout;self.version+=1

    def key(self,name,down):
        if name not in EVDEV_TO_KEY or not self.settings.keys_recording_only:return
        if (name in self.pressed)==bool(down):return
        if down:self.pressed.add(name)
        else:self.pressed.discard(name)
        self.version+=1

    def pad(self,kind,name,a,b=0):
        if not self.settings.pad_recording_only:return
        if kind=='layout' and self.pad_state['layout']==name:return
        if kind=='axis' and self.pad_state['axes'].get(name)==[a,b]:return
        if kind=='button' and self.pad_state['buttons'].get(name,False)==bool(a):return
        pad_events.apply_event(self.pad_state,[0,kind,name,a,b]);self.version+=1

    def session_plugin(self):
        # Session and replay have separate GSR contexts/ready files, but share pixels.
        directory=Path(tempfile.mkdtemp(prefix='session-',dir=self.directory))
        shutil.copy2(self.plugin,directory/'overlay.so')
        (directory/'frame.bin').symlink_to(self.directory/'frame.bin')
        return directory/'overlay.so'

    async def start(self):
        if self.task is None:self.task=asyncio.create_task(self._run())

    async def stop(self):
        # Let any to_thread render finish before removing its private directory.
        self.failed=True
        if self.task:
            await self.task
            self.task=None
        shutil.rmtree(self.directory,ignore_errors=True)

    async def _run(self):
        last=None
        while not self.failed:
            if self.active:
                try:
                    width,height=map(int,(self.directory/'ready').read_text().split())
                    current=(self.version,width,height)
                    if current!=last:
                        snapshot=(copy.deepcopy(self.settings),self.accent,set(self.pressed),copy.deepcopy(self.pad_state),height)
                        await asyncio.to_thread(self._render,*snapshot)
                        last=current
                except Exception:
                    log.exception('Recording overlay renderer failed')
                    self._write_empty()
                    self.failed=True
                    break
            await asyncio.sleep(1/30)

    def _render(self,ov,accent,pressed,pad,height):
        import cairo
        panels=[]
        if ov.keys_recording_only:
            scale=max(.1,min(3.,height/1080*ov.keys_scale))
            cache_key=(scale,accent,frozenset(pressed))
            cached=self.panel_cache.get('keys')
            if cached and cached[0]==cache_key:
                surface=cached[1]
            else:
                width,ph=key_overlay.panel_size(scale)
                surface=cairo.ImageSurface(cairo.FORMAT_ARGB32,width,ph)
                key_overlay.draw(cairo.Context(surface),key_overlay.ramp_for(accent),scale,
                                 {EVDEV_TO_KEY[k]:1. for k in pressed})
                self.panel_cache['keys']=(cache_key,surface)
            panels.append(('keys',surface))
        if ov.pad_recording_only:
            width=max(100,min(480,round(300*height/1080*ov.pad_scale)));ph=round(width*.82)
            cache_key=(width,accent,repr(pad))
            cached=self.panel_cache.get('pad')
            if cached and cached[0]==cache_key:
                surface=cached[1]
            else:
                surface=cairo.ImageSurface(cairo.FORMAT_ARGB32,width,ph);cr=cairo.Context(surface)
                art=pad_art_ps5 if pad['layout']=='playstation' else pad_art_xbox
                scale=min(width/art.SIZE[0],ph/art.SIZE[1]);cr.scale(scale,scale);cr.translate(-art.X0,-art.Y0)
                color=accent if len(accent or '')==7 and accent.startswith('#') else '#8ab9f3'
                rgb=tuple(int(color[i:i+2],16)/255 for i in (1,3,5))
                art.draw(cr,lambda key:float(pad['buttons'].get(key,False)),pad['axes'],rgb,(.04,.08,.12),{})
                self.panel_cache['pad']=(cache_key,surface)
            panels.append(('pad',surface))
        path=self.directory/'frame.tmp'
        with path.open('wb') as out:
            out.write(struct.pack('<II',0x564f5631,len(panels)))
            for kind,surface in panels:
                surface.flush()
                pos=getattr(ov,kind+'_position');pos=POSITIONS.index(pos) if pos in POSITIONS else 0
                out.write(struct.pack('<IIIii',surface.get_width(),surface.get_height(),pos,
                                      getattr(ov,kind+'_x'),getattr(ov,kind+'_y')))
                out.write(surface.get_data())
        path.replace(self.directory/'frame.bin')
