"""Render recorded controller states to a transparent export input, without GTK."""
import copy
import math
from pathlib import Path
import re
import subprocess
import tempfile
import time

from . import pad_events, pad_art_ps5, pad_art_xbox


def render(project, height: int, destination: Path, accent: str, scale: float = 1.0):
    import cairo
    recordings = {it['clipId']: pad_events.load_sidecar(it['clipId'])
                  for it in project['items'] if it['kind'] == 'clip'}
    if not any(recordings.values()): return None
    # Match keyboard export semantics: the bottom video lane is the program.
    main = [track['id'] for track in project['tracks'] if track['type'] == 'video'][-1]
    program = sorted([it for it in project['items'] if it['trackId'] == main and it['kind'] == 'clip'], key=lambda it: it['start'])
    if not any(recordings.get(it['clipId']) for it in program): return None
    extent = max(it['start'] + it['dur'] for it in project['items'])
    width = max(100, min(480, round(300*height/1080*scale)))
    panel_h = round(width * .82)
    fps = 20
    color = accent if re.fullmatch(r'#[0-9a-fA-F]{6}', accent) else '#8ab9f3'
    rgb = tuple(int(color[i:i+2],16)/255 for i in (1,3,5))
    destination.parent.mkdir(parents=True, exist_ok=True)
    cmd = ['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','bgra',
           '-video_size',f'{width}x{panel_h}','-framerate',str(fps),'-i','pipe:0',
           '-vf','unpremultiply=inplace=1','-an','-c:v','qtrle','-threads','1',str(destination)]
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, panel_h)
    cr = cairo.Context(surface)
    active = None; state = None; cursor = 0; lane_index = 0
    last_state = object()
    pixels = None
    deadline = time.monotonic() + 600
    with tempfile.TemporaryFile() as errors:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
        try:
            for frame in range(math.ceil(extent*fps)):
                if time.monotonic() > deadline: raise TimeoutError('Controller overlay preparation timed out')
                at = frame/fps
                while lane_index < len(program) and program[lane_index]['start']+program[lane_index]['dur'] <= at:
                    lane_index += 1
                item = program[lane_index] if lane_index < len(program) and program[lane_index]['start'] <= at else None
                data = recordings.get(item['clipId']) if item else None
                if data:
                    if active != item['id']:
                        active = item['id'];state = copy.deepcopy(data['initial']);cursor = 0
                    source_time = at-item['start']+item.get('offset',0)
                    while cursor < len(data['events']) and data['events'][cursor][0] <= source_time:
                        pad_events.apply_event(state,data['events'][cursor]);cursor += 1
                else:
                    active = None
                    state = None
                if state != last_state:
                    cr.set_operator(cairo.OPERATOR_CLEAR);cr.paint();cr.set_operator(cairo.OPERATOR_OVER)
                    if state is not None:
                        art = pad_art_ps5 if state['layout'] == 'playstation' else pad_art_xbox
                        art_scale = min(width/art.SIZE[0],panel_h/art.SIZE[1])
                        cr.save();cr.scale(art_scale,art_scale);cr.translate(-art.X0,-art.Y0)
                        art.draw(cr,lambda key:float(state['buttons'].get(key,False)),state['axes'],rgb,(.04,.08,.12),{})
                        cr.restore()
                    surface.flush()
                    pixels = bytes(surface.get_data())
                    last_state = copy.deepcopy(state)
                proc.stdin.write(pixels)
            proc.stdin.close()
            if proc.wait(timeout=max(1,deadline-time.monotonic())):
                errors.seek(0);raise RuntimeError(errors.read().decode(errors='replace')[-500:])
        except BaseException:
            if proc.poll() is None: proc.kill()
            proc.wait()
            destination.unlink(missing_ok=True)
            raise
        finally:
            if not proc.stdin.closed: proc.stdin.close()
    return destination
