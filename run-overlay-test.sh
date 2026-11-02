#!/bin/sh
set -eu
unset PYTHONPATH PYTHONHOME PYTHONUSERBASE LD_LIBRARY_PATH LD_LIBRARY_PATH_ORIG LD_PRELOAD LD_AUDIT
export PYTHONNOUSERSITE=1
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f /.flatpak-info ]; then
    exec flatpak-spawn --host sh "$script_dir/run-overlay-test.sh" "$@"
fi
cd "$script_dir"
# Rebuild the shared frontend so each experiment picks up the latest edits.
export PATH="$HOME/.local/share/gloaming-dev/node/bin:$PATH"
npm run build >&2
exec "$HOME/.local/share/gloaming-dev/venv/bin/python" -I -m gloaming.replay_design_test "$@"
