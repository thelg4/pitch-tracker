# Bullpen Command Tracker

Measures pitch command from bullpen video: where the catcher sets up versus where the ball is caught.
It has two parts: a browser app for tagging and scoring, and a Python/OpenCV pipeline that finds the pitches in a video and renders a side-by-side review video.

## app/

| File | What it is |
|---|---|
| `bullpen-command.html` | The tracker. It's a single page with no build step. Open it in Chrome or Safari, or publish it as an artifact. |
| `autotags.json` | The detected pitch list for IMG_5997. The page loads it from the same folder and offers a "Load auto-tags" banner. |

**How it works**
- **Scale:** the zone box you drag across the plate is 17 in wide, which gives pixels per inch.
- **Miss:** distance from the target to the catch in inches, split into arm side vs. glove side and up vs. down.
- **Pitch score:** 100 at a third of the hit radius or less, falling linearly to 0 at three times the hit radius (default radius 6 in).
- **Command score:** the average pitch score, also shown on the 20–80 scouting scale.
- **Trends:** miss scatter around the target, hit rate by target zone section, 5-pitch rolling score, per-pitch-type table, and written findings.
- **Saving:** the session lives in the browser's localStorage. Copy CSV exports it.

## pipeline/ (run in order, or use `run_all.sh`)

| Step | Script | Technique |
|---|---|---|
| 1 | `01_scan.py` | Decodes every frame (OpenCV/FFmpeg, auto-rotation) and saves the catcher-area region (432×308) plus whole-frame 90×160 thumbnails as memory-mapped arrays. |
| 2 | `02_cuts.py` | Finds hard cuts (one pitch per segment in this edit) from whole-frame mean absolute difference: local maxima within ±90 frames above 8. |
| 3 | `03_ball_candidates.py` | Aligns frame t−1 and t+1 to frame t with phase correlation on a background patch (translation only), then takes the symmetric three-frame difference min(Iₜ−W(Iₜ₋₁), Iₜ−W(Iₜ₊₁)). Thresholds on the difference and on brightness, then filters connected components by area, size and aspect ratio. |
| 4 | `04_tracks.py` | Links candidates with a constant-velocity model (velocity smoothed with α=0.5, prediction damped 0.92 per frame), a nearest-neighbor gate, an area gate and one frame of coasting. Hand-set rules classify a track as a pitch (length, shrinking area, direction toward the catcher). Temporal non-maximum suppression keeps one track per 2.5 s. |
| 5 | `05_catch_and_setup.py` | Catch frame = the first point that deviates more than 3.2 px from the predicted path. Setup frame = the stillest frame in the catcher window before the throw. Writes `info.json` and review sheets. |
| 6–7 | `06_glove.py`, `07_glove_retry.py` | Finds the catcher by his blue gear (chest-protector blob above a shin-guard blob, in HSV), skips frames where the pitcher blocks the view, and detects the mitt in the 4K frame as the largest dark, non-blue blob below the protector. |
| 8 | `08_render_plan.py` | Computes the camera offset of every frame relative to its segment's reference frame (phase correlation, median-smoothed), the zoom anchor for each segment, and the overlays. |
| 9 | `09_render.py` | Renders 1920×1080: the full view on the left, a 3× zoom from the 4K source on the right, with the target, ball ring and trail, and last-detection overlays. |
| 10 | `10_autotags.py` | Writes the pitch list (setup and catch times) that the tracker page loads. |

## tools/

| File | What it is |
|---|---|
| `sheet.py`, `zoom.py` | Contact sheets of frames around a given frame. |
| `review4k.py` | Review tiles from the 4K source. |
| `catcher.py` | Debug output for the blue-gear blobs. |
| `probe.swift` | Prints codec, fps, size and rotation via AVFoundation. |
| `frames.swift`, `crop.swift` | Frame grabs via AVFoundation. |

## Clip-specific values (IMG_5997)
Several values were set by reviewing this clip by eye. Re-check them for a new video:
- the region crop `270,702,882,1190` in 01
- the `drop` sets of rejected tracks in 06, 07 and 10
- the `verified` glove ids in 08
- the estimated segments in 10

## Setup
```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
./run_all.sh IMG_5997.MOV IMG_5997_1080p.mp4 data
```
To make the 1080p copy on macOS: `avconvert -s IMG_5997.MOV -p Preset1920x1080 -o IMG_5997_1080p.mp4`

## Known limits
- **Catch position:** the ball is lost against the catcher's gray uniform in the last frames, so the last detection is not always the catch.
- **Single camera:** there's no depth, so the end of the 2D track carries parallax.
- **Resolution:** about 2 px per inch at 1080p.
- **Camera alignment:** translation only, so zoom and rotation are not corrected.
