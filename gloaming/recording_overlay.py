"""Optional post-save overlay burn. Audio packets and the original are retained."""
import logging
import time
from functools import lru_cache
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from . import keys, pad_events, pad_export
from .editor import _GraphCtx, _windows
from .key_overlay import render_burn_assets


log = logging.getLogger("gloaming.recording_overlay")
SOFTWARE = ['-c:v','libx264','-preset','veryfast','-crf','20']
NVENC = ['-c:v','h264_nvenc','-preset','p2','-tune','hq','-rc','vbr',
         '-cq','20','-b:v','0','-rc-lookahead','0']


@lru_cache(maxsize=1)
def _nvenc_available():
    # Listing encoders alone does not prove the driver can open one.
    try:
        subprocess.run(['ffmpeg','-v','error','-nostdin','-f','lavfi','-i',
                        'color=s=640x360:r=30','-frames:v','1',*NVENC,
                        '-f','null','-'],check=True,capture_output=True,timeout=10)
        return True
    except (OSError, subprocess.SubprocessError) as exc:
        log.debug("Overlay NVENC probe unavailable: %s", exc)
        return False


def _encode(prefix, suffix, duration):
    hardware = _nvenc_available()
    try:
        subprocess.run([*prefix,*(NVENC if hardware else SOFTWARE),*suffix],
                       check=True,capture_output=True,timeout=max(600,duration*10))
    except subprocess.CalledProcessError as exc:
        if not hardware: raise
        log.warning("Overlay NVENC encode failed, retrying on CPU: %s",
                    (exc.stderr or b'').decode(errors='replace')[-500:])
        subprocess.run([*prefix,*SOFTWARE,*suffix],check=True,capture_output=True,
                       timeout=max(600,duration*10))
        return 'libx264 (fallback)'
    return 'h264_nvenc' if hardware else 'libx264'


def position(overlay, kind, w, h, pw, ph):
    place = getattr(overlay, kind + '_position')
    margin = round(32*h/1080)
    x = (w-pw)//2 if 'center' in place else w-pw-margin if 'right' in place else margin
    y = margin if 'top' in place else h-ph-margin
    if place == 'custom':
        x, y = getattr(overlay, kind+'_x'), getattr(overlay, kind+'_y')
    return max(0, min(w-pw, x)), max(0, min(h-ph, y))


def burn(path: Path, meta: dict, overlay, accent: str):
    """Replace only after successful render; keep the source under a hidden folder."""
    started = time.perf_counter()
    duration = float(meta['duration'])
    w, h = int(meta['width']), int(meta['height'])
    if duration <= 0 or min(w,h) <= 0:
        raise ValueError('Cannot determine recording dimensions or duration')
    with tempfile.TemporaryDirectory(prefix='.overlay-', dir=path.parent) as temp:
        work = Path(temp)
        item = dict(id='clip', kind='clip', clipId=path.stem, trackId='v', start=0, offset=0, dur=duration)
        project = dict(tracks=[dict(id='v',type='video')], items=[item])
        ctx = _GraphCtx(w,h,accent,{}, {})
        images = []
        cur = '0:v:0'
        if overlay.keys_recording_only:
            intervals = keys.load_sidecar(path.stem)
            if intervals is None: raise RuntimeError('Keyboard inputs were not saved')
            assets = render_burn_assets(work/'keys',accent,max(.1,h/1080*overlay.keys_scale))
            # Compose key highlights on the small panel first. Previously every
            # held key added another overlay pass over the full-resolution video.
            images.append(assets['panel'])
            panel = ctx.label('keys')
            ctx.lines.append(f'[1:v]format=rgba[{panel}]')
            held = {}
            for start, end, key in intervals:
                if key in assets['keys'] and end > start:
                    held.setdefault(key, []).append((start,end))
            for key, spans in sorted(held.items()):
                image, x, y = assets['keys'][key]
                images.append(image)
                label = ctx.label('keys')
                ctx.lines.append(f"[{panel}][{len(images)}:v]overlay=x={x}:y={y}:"
                                 f"format=auto:enable='{_windows(spans)}'[{label}]")
                panel = label
            x, y = position(overlay,'keys',w,h,*assets['size'])
            label = ctx.label('video')
            ctx.lines.append(f'[{cur}][{panel}]overlay=x={x}:y={y}[{label}]')
            cur = label
        pad = None
        if overlay.pad_recording_only:
            pad = pad_export.render(project,h,work/'pad.mov',accent,overlay.pad_scale)
            if pad is None: raise RuntimeError('Controller inputs were not saved')
            pw = max(100,min(480,round(300*h/1080*overlay.pad_scale)))
            x,y = position(overlay,'pad',w,h,pw,round(pw*.82))
            label = ctx.label('pad')
            ctx.lines.append(f'[{cur}][{1+len(images)}:v]overlay=x={x}:y={y}:eof_action=pass[{label}]')
            cur = label
        output = work/('rendered'+path.suffix)
        cmd = ['ffmpeg','-v','error','-nostdin','-filter_complex_threads','1','-i',str(path)]
        for image in images:
            cmd += ['-loop','1','-framerate','60','-t',f'{duration:.6f}','-i',str(image)]
        if pad: cmd += ['-i',str(pad)]
        cmd += ['-filter_complex',';'.join(ctx.lines),'-map',f'[{cur}]','-map','0:a?',
                '-map_metadata','0']
        prepared = time.perf_counter()
        encoder = _encode(cmd, ['-pix_fmt','yuv420p','-c:a','copy','-t',
                               f'{duration:.6f}','-y',str(output)], duration)
        log.info('Recording overlay %s: %.2fs preparation, %.2fs encode (%s, %sx%s, %.2fs clip)',
                 path.name, prepared-started, time.perf_counter()-prepared, encoder, w, h, duration)
        if not output.exists() or output.stat().st_size == 0: raise RuntimeError('Empty overlay render')
        archive = path.parent/'.overlay-originals'
        archive.mkdir(mode=0o700,exist_ok=True)
        original = archive/path.name
        # Never overwrite an earlier original, even if a name was reused.
        if original.exists(): raise FileExistsError(f'Original already exists: {original}')
        os.link(path,original)
        try:
            for enabled, store, suffix in [(overlay.keys_recording_only,keys,'keys'),(overlay.pad_recording_only,pad_events,'pad')]:
                if enabled:
                    shutil.copy2(store.sidecar_path(path.stem),archive/f'{path.name}.{suffix}.json')
            os.replace(output,path)
        except BaseException:
            original.unlink(missing_ok=True)
            raise
        # These inputs are now pixels; do not draw them a second time in playback/export.
        if overlay.keys_recording_only: keys.delete_sidecar(path.stem)
        if overlay.pad_recording_only: pad_events.delete_sidecar(path.stem)
