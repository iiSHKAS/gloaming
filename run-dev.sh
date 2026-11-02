#!/bin/sh
set -eu
# A launcher may export another application's bundled Python libraries.
# Clear these before crossing Flatpak and again on the host invocation.
unset PYTHONPATH PYTHONHOME PYTHONUSERBASE
# This launcher uses the host Python and system media tools. AppImage /
# PyInstaller launchers can leak their private native libraries into the
# terminal (e.g. ignite-panel's libtinfow needs a newer glibc than the host).
# Clear loader overrides before Python, GTK, ffmpeg or ffprobe is started.
unset LD_LIBRARY_PATH LD_LIBRARY_PATH_ORIG LD_PRELOAD LD_AUDIT
export PYTHONNOUSERSITE=1
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f /.flatpak-info ]; then
    exec flatpak-spawn --host sh "$script_dir/run-dev.sh" "$@"
fi
cd "$script_dir"
# WebKit uses GStreamer to play clips. Include locally installed parsers.
gst_plugins="$HOME/.local/share/gloaming-dev/gstreamer-1.0"
if [ -d "$gst_plugins" ]; then
    export GST_PLUGIN_PATH="$gst_plugins${GST_PLUGIN_PATH:+:$GST_PLUGIN_PATH}"
fi
# Native Wayland lets GTK render at each monitor's scale instead of having
# the compositor enlarge an XWayland window. Keep explicit user overrides.
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    export GDK_BACKEND="${GDK_BACKEND:-wayland}"
fi
exec "$HOME/.local/share/gloaming-dev/venv/bin/python" -I -m gloaming.app "$@"
