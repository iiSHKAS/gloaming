<p align="center">
  <img src="assets/gloaming-wordmark.png" width="400" alt="Gloaming">
</p>

<p align="center">
  <b>Instant replay for Linux games.</b><br>
  Press a key and the last 20 seconds of your game become a clip. No scenes to build, nothing to upload.
</p>

<p align="center">
  <img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square">
  <img alt="Version 0.5.0" src="https://img.shields.io/badge/version-0.5.0-success?style=flat-square">
  <img alt="Linux" src="https://img.shields.io/badge/platform-Linux-informational?style=flat-square">
  <img alt="Wayland and X11" src="https://img.shields.io/badge/display-Wayland%20%7C%20X11-informational?style=flat-square">
  <img alt="Python 3.10+" src="https://img.shields.io/badge/python-3.10%2B-3776AB?style=flat-square">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-it-does">Features</a> ·
  <a href="#use-it">Use it</a> ·
  <a href="#performance">Performance</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#troubleshooting">Troubleshooting</a> ·
  <a href="docs/DEVELOPMENT.md">Develop</a>
</p>

<p align="center">
  <img src="assets/screenshots/home.png" alt="Gloaming capture studio" width="900">
</p>

> **Gloaming is built on [Vice](https://github.com/splitshotz/Vice)** by Andrew Marin, and keeps its
> GPL-3.0 license. See [Credits](#credits).

## What it does

Gloaming runs quietly in the background and keeps a rolling recording of your screen on the GPU's
video encoder. When something happens in a game, press **F9**: the moment is saved as an MP4 in
`~/Videos/Gloaming/`, with game audio and, if you want, your microphone.

- **Instant replay.** A rolling buffer you size from 1 to 30 minutes, saved with one key. Extra keys
  can save other lengths, for example F6 for 60 seconds.
- **Sessions.** Double-tap the clip key to record a whole match, then tap once to drop a highlight
  marker at any moment.
- **Live replay.** Scrub back through the buffer while it records, mark a start and an end, and save
  just that part.
- **Editor.** Trim in place, or open a multi-track timeline with transitions and text, all built in.
- **Share link.** Every clip gets a link that plays inline when pasted into Discord.
- **Game aware.** Recognizes the game you are playing, names the clip after it and files it into
  that game's playlist. Optional Discord Rich Presence shows what you are playing.
- **Input overlays.** Show the keys or controller buttons you press over the footage, in the viewer
  or burned into an export.
- **Audio tracks.** Record desktop audio and microphone as separate tracks, or pick specific apps.
- **Private.** No account, no telemetry. Clips stay on your disk until you choose to share one.

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/library.png" alt="Clip library"><p align="center"><sub>The library: every clip, searchable, with trim, share and delete</sub></p></td>
    <td width="50%"><img src="assets/screenshots/settings.png" alt="Recording settings"><p align="center"><sub>Settings: pick a capture profile and set the replay buffer</sub></p></td>
  </tr>
</table>

## Install

```bash
git clone https://github.com/iiSHKAS/gloaming
cd gloaming
./install.sh
```

The script detects `apt`, `dnf`, `pacman` or `zypper`, installs the dependencies including the
`gpu-screen-recorder` capture backend, and sets up a systemd user service so clipping starts when
you log in. Open **Gloaming** from your app menu (or run `gloaming-app`), then press **F9** in a game.
If `gloaming: command not found` appears, restart your terminal once.

**NixOS (flake):**

```nix
{
  inputs.gloaming.url = "github:iiSHKAS/gloaming";

  outputs = { nixpkgs, gloaming, ... }: {
    nixosConfigurations.yourhost = nixpkgs.lib.nixosSystem {
      modules = [ gloaming.nixosModules.default { services.gloaming.enable = true; } ];
    };
  };
}
```

The module installs the package, the udev rule the hotkey listener needs, the capability wrapper for
gpu-screen-recorder, and the user daemon. Set `services.gloaming.autoStart = false;` to record only
while the window is open. Without flakes, import `nix/package.nix` and `nix/module.nix` directly.

**Update and remove**

| | Update | Remove |
|---|---|---|
| Git clone | `cd gloaming && git pull && ./install.sh` | `gloaming uninstall && rm -rf gloaming` |
| NixOS | `nix flake update gloaming && sudo nixos-rebuild switch` | Drop `services.gloaming.enable`, rebuild |

Gloaming checks this repository's releases once a day and tells you in the app when a newer one is
out. Turn that off in Settings → Advanced.

Immutable Fedora variants (Bazzite and similar) are not supported yet: `install.sh` cannot run on
rpm-ostree and exits before changing anything.

## Use it

| Key | What happens |
|---|---|
| **F9** | Save the last 20 seconds |
| Extra clip keys | Save their own length (Settings → Shortcuts) |
| **F9** twice | Start or stop a session recording |
| **F9** during a session | Drop a highlight at this moment |
| Click a clip | Open the viewer. ← → move between clips, **H** adds a highlight, **Esc** closes |

Every key can be rebound, including to a combination such as **Alt + F9**. Closing the window leaves
the daemon recording; open it again from your launcher at any time.

### Compatibility

| Desktop | GPU |
|---|---|
| Hyprland, Sway, Niri, GNOME, KDE Plasma (Wayland) | NVIDIA: NVENC |
| Any X11 window manager | AMD and Intel: VAAPI |
| | Anything else: libx264 in software |

Capture runs on [`gpu-screen-recorder`](https://git.dec05eba.com/gpu-screen-recorder/about/). Gloaming
can also use its Flatpak build (`com.dec05eba.gpu_screen_recorder`) when that is the only one
installed, or when you choose it in Settings. `wf-recorder` and `ffmpeg x11grab` exist as explicit
opt-ins through `recording.backend` and are never picked automatically.

Game detection works on X11, Hyprland, Sway and Niri, and on KDE Plasma Wayland when `kdotool` is
installed. Elsewhere clips save without a game tag.

## Performance

Measured with the Black Myth: Wukong benchmark on an RTX 4060 and Ryzen 5 9600X (GNOME on Wayland, under
Proton), recording at 60 fps with a 30 minute buffer, desktop audio and microphone on:

| | Average FPS | Low 5% |
|---|---|---|
| Gloaming off | 54 to 55 | 43 to 45 |
| Gloaming recording (H.264, HEVC or AV1) | 53 to 54 | 41 to 44 |

The cost is about **1 to 2 FPS**, the codec made no measurable difference, and Gloaming used roughly
9% of one CPU core and 280 MB of RAM. Saving a clip mid-game causes a one second dip in the minimum
frame rate. Method, every run and the limits of these numbers are in
[docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Configuration

Everything is in Settings. Under the hood it is `~/.config/gloaming/config.toml`, created on first
run. The options you are most likely to touch:

```toml
[recording]
buffer_duration = 120        # seconds kept in the rolling buffer
clip_duration   = 20         # seconds saved by the clip key
fps             = 60
display         = "DP-1"     # omit to use the default display
follow_mouse_display = false # record whichever monitor the pointer is on
encoder         = "auto"     # auto | h264_nvenc | hevc_nvenc | h264_vaapi | hevc_vaapi | libx264 | libx265
color_depth     = "8"        # 8 | 10 (10-bit needs HEVC or AV1)
container       = "mp4"      # mp4 | mkv (mkv is crash-safe, but Discord will not embed it)
capture_audio   = true
capture_microphone = false
audio_tracks    = []         # e.g. ["default_output", "default_input", "app:Discord"]
gsr_args        = ""         # extra gpu-screen-recorder flags, e.g. "-k hevc -bm cbr -q 20000"

[hotkeys]
clip = "KEY_F9"
disable_while_focused = []   # e.g. ["ggst.exe"] for a game that clips on its own keys

[output]
directory = "~/Videos/Gloaming"
tag_clips_with_game = true

[sharing]
enabled = true
port = 8765                  # local UI, always bound to 127.0.0.1
cloudflare_tunnel = true     # public link through cloudflared

[discord]
enabled = true               # Rich Presence when a known game is focused

[updates]
check_on_start = true        # one GitHub release check per day
```

- `audio_tracks` records each source as its own track, in order. Browsers and Discord play only
  track 1, editors see all of them. `audio_tracks_mix_first` adds a mixed track 1 so shared clips
  carry every sound.
- Buffers over 10 minutes are kept on disk automatically (`gsr_replay_storage = "auto"`).
- `gsr_args` expands `~` and environment variables, and has a `{default_sink_monitor}` placeholder.
- With `gpu-screen-recorder`, `encoder` also accepts `h264_vulkan`, `hevc_vulkan` and `av1_vulkan`.
  These need support from gpu-screen-recorder, FFmpeg and your driver.

### Command line

```
gloaming start [--no-open-ui]   Start the recording daemon
gloaming stop                   Stop it
gloaming clip                   Save a clip right now
gloaming status                 Daemon status, backend and share URL
gloaming ui                     Open the web UI
gloaming clips                  List saved clips
gloaming config                 Print the current config
gloaming list-keys              Valid hotkey names (KEY_F9, KEY_INSERT, ...)
gloaming doctor                 Startup diagnostics
gloaming uninstall              Remove Gloaming
```

The installer's systemd unit runs `gloaming start --no-open-ui`, so clipping begins at login without a
window. Custom units can use the same command.

## Troubleshooting

Start with `gloaming doctor`; it checks the environment and prints what it finds.

**Hotkey does nothing.** Gloaming reads keys from `/dev/input`. Add yourself to the `input` group,
then log in again: `sudo usermod -aG input $USER`.

**Overlay shortcuts do nothing on GNOME.** Install the bridge extension with
`tools/install-gnome-overlay.sh` and sign out and in once. Without it Gloaming falls back to an X11
window, which works but can look soft at fractional scaling.

**The service cannot find the Wayland session (Hyprland or Sway).** The systemd user instance does not
inherit the compositor's environment. Add this to your compositor config, restart the session, then
run `systemctl --user restart gloaming.service`:

```
# Hyprland: exec-once   Sway: exec
systemctl --user import-environment WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR XDG_SESSION_TYPE XDG_CURRENT_DESKTOP
dbus-update-activation-environment --systemd WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_CURRENT_DESKTOP
```

**The launcher icon does nothing.** Read `~/.local/share/gloaming/gloaming-app.log`. The usual cause is
`gpu-screen-recorder` missing from `PATH`. If it mentions `autoaudiosink`, install your distribution's
GStreamer base and good plugins.

**Clips show a grey box in the app but play elsewhere.** The embedded browser has no H.264 decoder,
which happens with the PyPI `PyQt6-WebEngine` wheel. Install the distribution package instead
(`python3-pyqt6.qtwebengine` on Debian and Ubuntu, `python3-pyqt6-webengine` on Fedora,
`python-pyqt6-webengine` on Arch), then run `./install.sh` again. The player also offers
"Open in system player".

**The share link only works on my network.** Enable the tunnel in Settings → Sharing and install
`cloudflared`, the only supported tunnel.

**The clip will not embed on Discord.** Discord inlines videos up to about 50 MB, and only MP4. Trim
the clip or lower the quality. Links change when the daemon restarts, because each run gets a new
tunnel address.

**The window looks like plain HTML after an update.** The old daemon is still running old code. Run
`gloaming stop && gloaming-app`.

**The window is slow or crashes.** `gloaming-app --debug` writes
`~/.local/share/gloaming/gloaming-debug.log`; attach it to an issue. Do not pipe the command through
`tee`, which can freeze the UI loop.

## Translating

The interface is one JSON file per language in `ui-src/locales/`; English is the source. Adding a
language is a pull request that touches nothing else:

```bash
npm install
npm run i18n:new -- pt-BR     # creates ui-src/locales/pt-BR.json
npm run i18n:check            # coverage for every language
```

A partial translation is fine, since missing keys fall back to English. Details are in
[docs/TRANSLATING.md](docs/TRANSLATING.md).

## Development

A Python daemon with a React and TypeScript UI. Layout, building, running from source, packaging and
releasing are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Pull requests are welcome; when you
report a bug, include the output of `gloaming doctor`.

## Credits

Gloaming is built on **[Vice](https://github.com/splitshotz/Vice)**, created by
**Andrew Marin** ([@splitshotz](https://github.com/splitshotz)), including the capture pipeline,
editor, sharing server and most of the interface. Thanks as well to everyone who contributed to Vice;
the list is on its [contributors page](https://github.com/splitshotz/Vice/graphs/contributors).
Gloaming is maintained by [iiSHKAS](https://github.com/iiSHKAS).

Recording is done by [`gpu-screen-recorder`](https://git.dec05eba.com/gpu-screen-recorder/about/) by
dec05eba.

## License

Gloaming is free software under the [GNU General Public License v3.0](LICENSE), the same license as
Vice. Third-party components keep their own licenses.
