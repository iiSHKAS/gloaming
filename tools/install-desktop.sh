#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -f /.flatpak-info ]; then exec flatpak-spawn --host sh "$here/tools/install-desktop.sh"; fi
export GLOAMING_SOURCE_DIR="$here"
/usr/bin/python3 - <<'PY'
import os,shutil
from pathlib import Path
root=Path(os.environ['GLOAMING_SOURCE_DIR'])
data=Path(os.environ.get('XDG_DATA_HOME', str(Path.home()/'.local/share')))
icons=data/'icons/hicolor/256x256/apps';icons.mkdir(parents=True,exist_ok=True)
shutil.copyfile(root/'assets/gloaming.png',icons/'gloaming.png')
apps=data/'applications';apps.mkdir(parents=True,exist_ok=True)
launcher=str(root/'run-dev.sh').replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$')
(apps/'gloaming.desktop').write_text('[Desktop Entry]\nType=Application\nName=Gloaming\nComment=Gameplay replay and clips\nExec=sh "'+launcher+'"\nIcon=gloaming\nTerminal=false\nCategories=AudioVideo;Video;Recorder;\nStartupWMClass=gloaming\nStartupNotify=true\n')
PY
update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications" 2>/dev/null || true
gtk-update-icon-cache -f -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor" 2>/dev/null || true
