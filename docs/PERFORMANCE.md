# Performance

How much does Gloaming cost while you play? These are measurements from one machine, repeatable
with the same method, not a promise for every system.

## Result in one line

With instant replay running, **Black Myth: Wukong lost about 1 to 2 FPS (2 to 4%)**. The encoder
choice made no difference you can measure. Saving a clip while playing is the only moment you can
see: the minimum frame rate dipped for that second.

## Test setup

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 4060 (NVENC) |
| CPU | AMD Ryzen 5 9600X |
| Desktop | GNOME on Wayland, game through Steam Proton Experimental |
| Workload | Black Myth: Wukong Benchmark Tool, High preset, 2048x1152 borderless, DLSS, ray tracing off |
| Gloaming | 60 fps, `very_high` quality, 8-bit, 30 minute buffer, desktop audio and microphone |

The benchmark is a fixed 150 second scene, so every run renders the same frames.

## Results

| Case | Avg FPS | Max | Min | Low 5% | Gloaming CPU | Gloaming RAM |
|---|---|---|---|---|---|---|
| Baseline, Gloaming off | 55 | 66 | 39 | 45 | n/a | n/a |
| Baseline, second run | 54 | 65 | 38 | 43 | n/a | n/a |
| Gloaming, default settings | 53 | 65 | 37 | 41 | 9.0% | 278 MB |
| No audio, no microphone | 53 | 65 | 38 | 43 | 6.0% | 276 MB |
| Buffer 30 s instead of 30 min | 53 | 64 | 38 | 43 | 9.5% | 277 MB |
| H.264 | 54 | 64 | 39 | 44 | 9.3% | 277 MB |
| HEVC | 53 | 64 | 38 | 42 | 9.3% | 282 MB |
| AV1 | 53 | 64 | 37 | 42 | 9.7% | 282 MB |
| Default settings + clip saved mid-run | 52 | 63 | **31** | 40 | 9.5% | 280 MB |

CPU is the sum of the Gloaming daemon, `gpu-screen-recorder` and its helper, as a percentage of one
core, sampled for 6 seconds in the middle of the run. RAM is their combined resident memory.

## What to take from it

- **FPS cost is small.** The two baseline runs differ by 1 FPS on their own, so differences of 1 FPS
  between the Gloaming rows are inside the noise.
- **Codec does not matter for frame rate.** H.264, HEVC and AV1 all land within one frame of each
  other. Pick by file size and where you want to share the clip.
- **Audio capture is the cheapest thing to trim.** Turning off desktop audio and the microphone
  took the CPU figure from 9% to 6% of a core and gave back about two frames in the low 5%.
- **A longer buffer costs disk, not memory.** Buffers over 10 minutes are kept on disk
  (`gsr_replay_storage = "auto"`), and resident memory was about 280 MB with both a 30 second and a
  30 minute buffer.
- **Saving a clip causes a one-second dip.** Minimum FPS fell from 38 to 31 while the clip was
  being written.

## Limits of these numbers

- One run per case. The benchmark reports whole frames per second, so 1 FPS is the resolution.
- One machine, one game, one resolution. A GPU already at 100% in a heavier scene will show the
  encoder's cost differently.
- The benchmark tool shows 0 GB for VRAM under Proton, so VRAM is not reported.
- CPU is a single 6 second sample, not an average over the run.

## Reproduce it

Run the same scene with Gloaming stopped (`gloaming stop`), then with it running, and compare the
results screen. To change one setting between runs, edit `~/.config/gloaming/config.toml`, for
example `encoder = "av1"` or `capture_audio = false`, and restart with
`gloaming stop && gloaming start --no-open-ui`. Keep the preset, resolution and driver the same
for every run, and discard the first run after a reboot.
