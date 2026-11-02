#!/usr/bin/env python3
"""Build the private, patched GSR backend inside Freedesktop SDK 25.08.
No root/install-system actions. Then verify using three seconds of disposable
screen capture. Requires meson, ninja, make, cc, nasm, pkg-config and dev libs.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT=Path.home()/'.local/share/gloaming-dev/gsr-overlay'
if not Path('/.flatpak-info').exists():
 raise SystemExit('Run this builder inside Freedesktop SDK 25.08 (the VS Code Flatpak terminal), not the host shell.')
REPO=Path(__file__).resolve().parents[1]
PINS={
 'gsr-source':('https://repo.dec05eba.com/gpu-screen-recorder','099a55b905a8599b4cc10b7afe6c911f9c1319c7'),
 'ffmpeg-source':('https://github.com/FFmpeg/FFmpeg.git','98581d546ff453ce1f29c4af8448996d6ac992f7'),
 'nv-headers':('https://github.com/FFmpeg/nv-codec-headers.git','e844e5b26f46bb77479f063029595293aa8f812d'),
}
def run(args,**kwargs):subprocess.run(args,check=True,**kwargs)
def install_file(source,target):
 temp=target.with_name(target.name+'.new')
 shutil.copy2(source,temp)
 temp.replace(target)
ROOT.mkdir(parents=True,exist_ok=True)
(ROOT/'verified.json').unlink(missing_ok=True)
for name,(url,commit) in PINS.items():
 source=ROOT/name
 if not source.exists():
  run(['git','init',str(source)]);run(['git','-C',str(source),'remote','add','origin',url])
 result=subprocess.run(['git','-C',str(source),'rev-parse','HEAD'],text=True,capture_output=True)
 current=result.stdout.strip() if result.returncode==0 else ''
 if current!=commit:
  run(['git','-C',str(source),'fetch','--depth','1','origin',commit])
  run(['git','-C',str(source),'checkout','--detach','FETCH_HEAD'])
source=ROOT/'gsr-source/src/plugins.c'
text=source.read_text()
assert '.load_external_image_shader = false,' in text or '.load_external_image_shader = true,' in text
source.write_text(text.replace('.load_external_image_shader = false,','.load_external_image_shader = true,'))
run(['make','-C',str(ROOT/'nv-headers'),f'PREFIX={ROOT}/deps','install'])
env=os.environ.copy();env['PKG_CONFIG_PATH']=str(ROOT/'deps/lib/pkgconfig')+':'+env.get('PKG_CONFIG_PATH','')
run(['./configure',f'--prefix={ROOT}/ffmpeg-install','--disable-programs','--disable-doc','--disable-debug',
 '--disable-static','--enable-shared','--disable-everything','--enable-nvenc','--enable-vaapi','--enable-libopus',
 '--enable-encoder=h264_nvenc,hevc_nvenc,av1_nvenc,h264_vaapi,hevc_vaapi,av1_vaapi,aac,libopus,pcm_s16le,flac',
 '--enable-muxer=mp4,matroska,hls,mpegts','--enable-protocol=file,pipe',
 '--enable-filter=aresample,abuffer,abuffersink,amix,aformat','--enable-swresample','--enable-swscale'],cwd=ROOT/'ffmpeg-source',env=env)
run(['make','-j4'],cwd=ROOT/'ffmpeg-source')
run(['meson','setup',*(['--reconfigure'] if (ROOT/'build/meson-private/coredata.dat').exists() else []),str(ROOT/'build'),str(ROOT/'gsr-source'),'--buildtype=release',
 '-Dcapabilities=false','-Dsystemd=false','-Dnvidia_suspend_fix=false'])
run(['ninja','-C',str(ROOT/'build'),'-j4'])
install_file(ROOT/'build/gpu-screen-recorder',ROOT/'gpu-screen-recorder')
(ROOT/'lib').mkdir(exist_ok=True)
for name,major in [('libavcodec',61),('libavformat',61),('libavutil',59),('libavfilter',10),('libswresample',5),('libswscale',8)]:
 install_file(ROOT/'ffmpeg-source'/name/f'{name}.so.{major}',ROOT/'lib'/f'{name}.so.{major}')
helper=ROOT/'gsr-kms-server'
if not helper.is_symlink():helper.symlink_to('/app/bin/gsr-kms-server')
wrapper=ROOT/'run-gsr'
wrapper.write_text('''#!/bin/sh
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export LD_LIBRARY_PATH="$base/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$base/gpu-screen-recorder" "$@"
''');wrapper.chmod(0o755)
# Test on the host with the same Flatpak and GPU used by the app.
run(['flatpak-spawn','--host',str(Path.home()/'.local/share/gloaming-dev/venv/bin/python'),'-I',str(REPO/'tools/checks/capture_overlay_gsr.py')])
(ROOT/'verified.json').write_text(json.dumps({'sha256':hashlib.sha256((ROOT/'gpu-screen-recorder').read_bytes()).hexdigest(),
 'sources':{name:commit for name,(_,commit) in PINS.items()},'test':'capture_overlay_gsr.py'}))
print('Verified recording overlay backend installed:',ROOT)
