# Development

Gloaming is a Python daemon (recording, hotkeys, sharing) with a web UI written in React and
TypeScript. Node is only used to build that UI. The built files are committed under
`gloaming/ui/`, so running or packaging the app needs no Node.

## Layout

| Path | What lives there |
|---|---|
| `gloaming/` | The app: daemon (`main.py`), window (`app.py`), recorder backends, hotkeys, sharing server, overlays |
| `gloaming/ui/` | Built web UI (`scripts/app.js`, `styles/app.css`) plus fonts and `index.html` |
| `ui-src/` | UI source: screens, components, editor engine, locales (`locales/*.json`) |
| `src/themes/` | Design-system theme used by the UI build |
| `gloaming/gnome-extension/` | GNOME Shell extension that places the native Wayland replay overlay (installed by `gloaming/gnome_extension.py`) |
| `packaging/` | systemd user unit and udev rule |
| `nix/`, `flake.nix` | Nix package and NixOS module |
| `PKGBUILD`, `.SRCINFO` | Arch package |
| `tools/` | Build, locale and packaging scripts |

## Run from source

```bash
git clone https://github.com/iiSHKAS/gloaming && cd gloaming
./install.sh                          # installs system packages and a normal install
python3 -m venv --system-site-packages ~/.local/share/gloaming-dev/venv
~/.local/share/gloaming-dev/venv/bin/pip install -e .
sh run-dev.sh                         # runs the app from this checkout
```

`run-dev.sh` also works from a Flatpak terminal (it re-runs itself on the host).

## Build the UI

```bash
npm install
npm run build          # writes gloaming/ui/scripts/app.js and styles/app.css
npm run dev            # rebuild on change
npm run typecheck      # tsc --noEmit
npm run i18n:check     # translation coverage and hardcoded strings
```

The build must emit exactly two flat, unhashed files, because `share.py` serves them by name.
See the comment in `vite.config.mts`.

## The replay overlay and keyboard focus

The replay overlay is a separate GTK + WebKit process (`gloaming/replay_overlay.py`) with three
paths, chosen at start:

1. **GNOME on Wayland with the bridge extension.** `gloaming/gnome_extension.py` installs and enables it
   automatically at daemon start (once per extension version, and it respects a user who turns it off).
   GNOME loads it at the next login. `tools/install-gnome-overlay.sh` does the same by hand. The
   extension finds the window by app id and gives it focus.
2. **Wayland compositors with layer-shell** (Hyprland, Sway, KDE, Niri). The overlay is a
   layer-shell surface with exclusive keyboard mode.
3. **XWayland fallback.** The overlay is an ordinary managed X11 window. Do not make it
   override-redirect: compositors never give those keyboard focus, and every shortcut in the
   overlay stops working.

## Packaging

- **Arch:** `PKGBUILD` and `.SRCINFO`. CI builds it with `tools/ci/arch-package.sh`.
- **Nix:** `flake.nix`, `nix/package.nix`, `nix/module.nix`. CI checks that the flake version
  matches `gloaming/__init__.py`.
- **AppImage:** `tools/packaging/build-local-appimage.py`.

## Releasing

1. Bump the version in `gloaming/__init__.py`, `package.json`, `PKGBUILD` (`pkgver`) and `.SRCINFO`.
2. Rebuild the UI (`npm run build`) and commit `gloaming/ui/`.
3. Add `docs/release-notes/<version>.md`. The in-app update notice shows the first lines of the
   GitHub release body, so lead each item with a bold title: `- **Thing.** detail`.
4. Tag `<version>` (no `v` prefix, for example `0.5.0`) and publish a GitHub release. The app's update check reads
   `https://api.github.com/repos/iiSHKAS/gloaming/releases/latest`, and the PKGBUILD builds from
   the tag archive.

## Developer scripts

| Script | Purpose |
|---|---|
| `tools/install-desktop.sh` | Adds a launcher and icon for this checkout (it starts `run-dev.sh`) |
| `tools/build-capture-backend.py` | Builds the patched `gpu-screen-recorder` used to burn input overlays into recordings. Optional: without it, that feature is skipped |
| `tools/derive-accents.mjs`, `tools/gen-light-theme.mjs` | Regenerate the accent palette and light theme (`npm run accents`, `npm run theme:light`) |

## Translating

See [TRANSLATING.md](TRANSLATING.md).
