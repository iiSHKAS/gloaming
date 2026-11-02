#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -f /.flatpak-info ]; then
    exec flatpak-spawn --host sh "$here/tools/install-gnome-overlay.sh"
fi
uuid=gloaming-overlay@basilforge.local
extension_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
mkdir -p "$extension_dir"
cp "$here/gnome-extension/$uuid/metadata.json" "$extension_dir/metadata.json"
cp "$here/gnome-extension/$uuid/extension.js" "$extension_dir/extension.js"
# Preserve all other extension preferences. New UUIDs are discovered on login.
/usr/bin/python3 - <<'PY'
from gi.repository import Gio
settings = Gio.Settings.new('org.gnome.shell')
uuid = 'gloaming-overlay@basilforge.local'
enabled = list(settings.get_strv('enabled-extensions'))
if uuid not in enabled:
    settings.set_strv('enabled-extensions', enabled + [uuid])
settings.set_strv('disabled-extensions', [x for x in settings.get_strv('disabled-extensions') if x != uuid])
Gio.Settings.sync()
PY
if gnome-extensions enable "$uuid" 2>/dev/null; then
    gnome-extensions info "$uuid"
else
    echo 'Installed. Sign out and sign back in once so GNOME discovers the new extension.'
fi
