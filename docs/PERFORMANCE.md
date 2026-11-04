# Performance

What does Gloaming cost while you play? These numbers come from one machine and one method, so treat them as a measured example, not a promise for every system.

## Result

With instant replay recording, **Black Myth: Wukong lost about 7% of its frame rate**.

| Metric | Gloaming off | Gloaming on | Change |
|---|---:|---:|---:|
| Average FPS | 57.3 | 53.0 | −7.6% |
| Low 5% FPS | 47.0 | 43.7 | −7.1% |

Three benchmark runs per condition, averaged.

## Test setup

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 4060 (NVENC) |
| CPU | AMD Ryzen 5 9600X |
| Desktop | GNOME on Wayland, game through Steam Proton Experimental |
| Workload | Black Myth: Wukong Benchmark Tool, a fixed 150 second scene, so every run renders the same frames |
| Gloaming | 60 fps, `very_high` quality, 8-bit, 30 minute buffer, desktop audio and microphone |

## What changes the cost, and what does not

These comparisons are single runs of the benchmark, so read them for direction, not for exact frame counts. The benchmark reports whole frames per second, and two runs of the same condition can differ by one.

| Gloaming setting | Average FPS | Low 5% | CPU used by Gloaming | RAM |
|---|---:|---:|---:|---:|
| Default (H.264) | 53 | 41 | 9.0% of one core | 278 MB |
| H.264, encoder set explicitly | 54 | 44 | 9.3% | 277 MB |
| HEVC | 53 | 42 | 9.3% | 282 MB |
| AV1 | 53 | 42 | 9.7% | 282 MB |
| Desktop audio and microphone off | 53 | 43 | 6.0% | 276 MB |
| Buffer 30 seconds instead of 30 minutes | 53 | 43 | 9.5% | 277 MB |
| Default, clip saved mid-run | 52 | 40 | 9.5% | 280 MB |

CPU is the sum of the Gloaming daemon, `gpu-screen-recorder` and its helper, as a percentage of one core, sampled for 6 seconds in the middle of the run. RAM is their combined resident memory.

What to take from it:

- **Codec does not matter for frame rate.** H.264, HEVC and AV1 land within one frame of each other. Pick by file size and where you want to share the clip.
- **Audio capture is the cheapest thing to trim.** Turning off desktop audio and the microphone took the CPU figure from 9% to 6% of a core.
- **A longer buffer costs disk, not memory.** Buffers over 10 minutes are kept on disk (`gsr_replay_storage = "auto"`), and resident memory was about 280 MB with both a 30 second and a 30 minute buffer.
- **Saving a clip causes a one second dip.** The minimum frame rate fell from 38 to 31 while the clip was being written.

## Limits of these numbers

- One machine, one game, one resolution. A GPU already at 100% in a heavier scene will show the encoder's cost differently.
- The benchmark tool shows 0 GB for VRAM under Proton, so VRAM is not reported.
- CPU is a single 6 second sample, not an average over the run.

## Reproduce it

Run the same scene with Gloaming stopped (`gloaming stop`), then with it recording, and compare the results screen. Repeat each condition at least three times and average them. To change one setting between runs, edit `~/.config/gloaming/config.toml`, for example `encoder = "av1"` or `capture_audio = false`, and restart with `gloaming stop && gloaming start --no-open-ui`. Keep the preset, resolution and driver the same for every run, and discard the first run after a reboot.
