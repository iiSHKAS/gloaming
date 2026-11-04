#!/usr/bin/env python3
"""Build a testing AppImage for the current Ubuntu 24.04/Zorin x86_64 host.

Bundles Python, application and pip dependencies. GTK/WebKit/GStreamer,
FFmpeg, GPU drivers and the configured recording backend remain host tools.
Run with the development venv's Python on the host, not inside Flatpak.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone

repo = Path(__file__).resolve().parents[2]
if Path('/.flatpak-info').exists():
    raise SystemExit('Run on the host with flatpak-spawn --host and the development venv Python.')
if sys.version_info[:2] != (3, 12):
    raise SystemExit('This local build requires the tested Python 3.12 environment.')
work = Path.home() / '.cache/gloaming-appimage-build'
app = work / 'Gloaming.AppDir'
out = repo / 'dist'
tool = Path.home() / '.cache/gloaming-appimage-tools/appimagetool.AppImage'
if not tool.is_file():
    raise SystemExit(f'Missing official AppImage packaging tool: {tool}')
env = dict(os.environ)
env['PATH'] = str(Path.home()/'.local/share/gloaming-dev/node/bin') + ':' + env['PATH']
subprocess.run(['npm', 'run', 'typecheck'], cwd=repo, env=env, check=True)
subprocess.run(['npm', 'run', 'build'], cwd=repo, env=env, check=True)
if app.exists():
    shutil.rmtree(app)
(app/'usr/bin').mkdir(parents=True)
stdlib = app/'usr/lib/python3.12'
ignore = shutil.ignore_patterns('__pycache__', '*.pyc', 'test', 'tests', 'idlelib', 'tkinter', 'ensurepip')
shutil.copytree(Path(sys.base_prefix)/'lib/python3.12', stdlib, ignore=ignore)
shutil.copy2(Path(sys.executable).resolve(), app/'usr/bin/python3.12')
site = stdlib/'dist-packages'
site.mkdir(exist_ok=True)
venv_site = Path(sys.prefix)/'lib/python3.12/site-packages'
for source in venv_site.iterdir():
    if source.name.startswith(('__', 'pip', 'gloaming-', 'gloaming.')) or source.name == 'gloaming':
        continue
    if source.is_dir():
        shutil.copytree(source, site/source.name, ignore=ignore)
    else:
        shutil.copy2(source, site/source.name)
# GI, Cairo and their native dependencies match the target host.
(site/'host-desktop.pth').write_text('/usr/lib/python3/dist-packages\n')
shutil.copytree(repo/'gloaming', site/'gloaming', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
# The tray icon is resolved as <package>/../assets/gloaming.png.
(site/'assets').mkdir(exist_ok=True)
shutil.copy2(repo/'assets/gloaming.png', site/'assets/gloaming.png')
shutil.copy2(repo/'assets/gloaming.svg', site/'assets/gloaming.svg')
shutil.copytree(Path.home()/'.local/share/gloaming-dev/gstreamer-1.0', app/'usr/lib/gstreamer-1.0')
shutil.copy2(repo/'assets/gloaming.png', app/'gloaming.png')
(app/'.DirIcon').symlink_to('gloaming.png')
(app/'gloaming.desktop').write_text('''[Desktop Entry]
Type=Application
Name=Gloaming
Exec=AppRun
Icon=gloaming
Terminal=false
Categories=Game;AudioVideo;
StartupWMClass=Gloaming
''')
(app/'AppRun').write_text('''#!/bin/sh
set -eu
unset PYTHONPATH PYTHONHOME PYTHONUSERBASE LD_LIBRARY_PATH LD_LIBRARY_PATH_ORIG LD_PRELOAD LD_AUDIT
bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export GST_PLUGIN_PATH="$bundle_dir/usr/lib/gstreamer-1.0${GST_PLUGIN_PATH:+:$GST_PLUGIN_PATH}"
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    export GDK_BACKEND="${GDK_BACKEND:-wayland}"
fi
if [ "${1:-}" = "--self-test" ]; then
    exec "$bundle_dir/usr/bin/python3.12" -I "$bundle_dir/self-test.py"
fi
exec "$bundle_dir/usr/bin/python3.12" -I -m gloaming.app "$@"
''')
(app/'AppRun').chmod(0o755)
(app/'self-test.py').write_text('''import pathlib, sys, subprocess
import gloaming, gloaming.app, gloaming.main, aiohttp, evdev, click, tomli_w, webview, cairo, gi
root = pathlib.Path(__file__).resolve().parent
assert pathlib.Path(gloaming.__file__).is_relative_to(root), gloaming.__file__
assert pathlib.Path(sys.prefix).is_relative_to(root), sys.prefix
for name, version in [('Gtk','3.0'),('WebKit2','4.1'),('Gst','1.0')]:
    gi.require_version(name, version)
from gi.repository import Gtk, WebKit2, Gst
Gst.init(None)
assert Gst.ElementFactory.find('h264parse'), 'Missing H.264 parser'
ui = pathlib.Path(gloaming.__file__).parent/'ui'
assert (ui/'scripts/app.js').is_file()
assert b'replay-tool-shortcut' in (ui/'scripts/app.js').read_bytes()
subprocess.run([sys.executable, '-I', '-m', 'gloaming.main', '--version'], check=True)
print('PASS: bundled app/Python, daemon subprocess, UI, GTK, WebKit, H.264 parser and dependencies')
print('App:', gloaming.__file__)
''')
shutil.copy2(repo/'LICENSE', app/'LICENSE')
licenses=app/'usr/share/doc/python3.12'
licenses.mkdir(parents=True)
shutil.copy2('/usr/share/doc/python3.12/copyright', licenses/'copyright')
(app/'BUILD-INFO.json').write_text(json.dumps({
    'built_utc':datetime.now(timezone.utc).isoformat(),
    'target':'Zorin 18 / Ubuntu 24.04 x86_64',
    'system_dependencies':['GTK3', 'WebKit2 4.1', 'GStreamer', 'FFmpeg', 'GPU drivers', 'configured GPU Screen Recorder backend'],
    'note':'Testing build from current working tree. Existing preferences and recording backend are reused.'
}, indent=2)+'\n')
subprocess.run([str(app/'AppRun'), '--self-test'], check=True)
# Extract the packaging tool to avoid requiring FUSE during the build.
work.mkdir(exist_ok=True)
subprocess.run([str(tool), '--appimage-extract'], cwd=work, check=True, stdout=subprocess.DEVNULL)
out.mkdir(exist_ok=True)
version = subprocess.check_output([str(app/'usr/bin/python3.12'), '-I', '-c', 'import gloaming; print(gloaming.__version__)'], text=True).strip()
artifact = out/f'Gloaming-{version}-local-x86_64.AppImage'
env['ARCH']='x86_64'
subprocess.run([str(work/'squashfs-root/AppRun'), str(app), str(artifact)], env=env, check=True)
artifact.chmod(0o755)
print(f'Created: {artifact}')
