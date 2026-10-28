# Roadmap

Where Bullpen Command Tracker is today, where it's going, and the decisions behind the plan.
It's written for the project owner, for pitching coaches who'll use it, and for developers who'll join later.

## The idea in one paragraph

We film a bullpen session from behind the pitcher. The camera is offset a little so the pitcher doesn't block the catcher. For every pitch we measure two points: where the catcher set his glove as the target, and where the ball was actually caught. The gap between them is the **miss**, in inches, split into arm side vs. glove side and up vs. down. Misses roll up into a **command score** for each pitch, each session and each athlete over time.

## Where we are today

| Part | What it does | Limits |
|---|---|---|
| `app/bullpen-command.html` | A single-page tracker. You tap the target and the catch, and it scores misses, draws trends and exports CSV. | Fully manual. Scale comes from the plate width (wrong depth, see [Calibration](#calibration)). Data lives in one browser's storage. |
| `pipeline/` | A hand-tuned OpenCV pipeline: it finds the pitches, tracks the ball, finds the catcher by his blue gear and renders a review video. | The crop, the rejected tracks and the glove ids were tuned by eye for one clip (IMG_5997), so it doesn't work on new videos. About 2 px per inch. The ball gets lost against the catcher's uniform. |

The pipeline proved the concept and showed us what's hard. The plan below replaces its hand-tuned parts with a trained detector and a proper desktop app.

## Key design decisions

### What counts as the target
**The target is the glove position at the pitcher's release frame.** It is not the moment the glove "opens". Catchers drift and some set late, so release is the fairest moment to measure the pitcher's intent against.

### How we find the catch point
**The catch point comes from the ball, not the glove.** We track the ball, fit a curve to its path, and find the frame where it stops. If the ball disappears in the last few frames (which happens against gray gear), we extend the fitted curve to the stop. This way we never need to know whether the glove is open or closed at the catch.

### Why a trained detector
Pure motion-based glove detection failed. A set glove doesn't move, so motion can't see it, and body shifts and the glove opening and closing create false motion. A detector trained on labeled frames recognizes the ball, mitt and catcher by how they look, not by how they move.

| Choice | Decision |
|---|---|
| Model | Fine-tune **RF-DETR** (Roboflow, Apache-2.0 license) |
| Rejected alternative | Ultralytics YOLO. Its AGPL license would complicate selling the app later. |
| Classes | `ball`, `mitt`, `catcher` |
| Input | A **full-resolution crop around the catcher**, not a shrunken full frame. The ball and mitt are small, and shrinking the frame throws away the detail we need. |

### Training
- **Tools:** Python with the `rfdetr` package, data in COCO format.
- **Data:** about 500–1,500 labeled frames, labeled in CVAT or Label Studio. Keep a separate validation set that is never trained on.
- **Compute:** a rented GPU (Colab or RunPod). About 1–2 hours and a few dollars per run.
- **The real work is labeling.** To speed it up:
  - Let model v1 pre-label new frames, so people only fix its mistakes.
  - Reuse the target taps users make in the app as free labels.

### Running the model in the app
Export the trained model to **ONNX** and run it with **ONNX Runtime**, using the CoreML execution provider on Apple Silicon. Users never need to install Python.

### People stay in the loop
The app proposes the target and catch points, and the user confirms or nudges each with a tap, about 2 seconds per pitch. As the model improves, fewer pitches need a nudge. We never silently trust the model.

### Capture guidance
Good video makes everything downstream easier. The recommended setup:

| Setting | Recommendation |
|---|---|
| Mount | Tripod, never handheld |
| Frame rate | 240 fps (120 fps minimum) |
| Focus and exposure | Locked |
| Shutter | Fast, 1/1000 s or faster, so the ball isn't a blur |
| Framing | Zoom so the catcher fills a large part of the frame. Aim for about 20–30 px per inch (today's video is about 2). |
| Position | Behind the pitcher, offset so the catcher's target stays visible |

### Calibration
Once per session, someone holds a board of known size (for example 24" × 24" with corner markers) **in the catcher's receiving plane**, roughly where the glove catches the ball. The user taps its 4 corners, and the app computes a mapping from pixels to inches (a homography).

We don't use home plate for scale. It sits 2–3 ft in front of the glove, so from behind the pitcher it gives the wrong scale.

### Proving it's accurate
1. Hand-tag about 100 pitches **twice** to measure how consistent people are with themselves.
2. Compare the app's points with the hand tags.
3. Goal: **95% of pitches within 1.5 in** of the hand tags (to be confirmed against the human-consistency numbers).

## The product: a desktop app

The desktop app is being built now, in parallel with the detector work.

| Area | Plan |
|---|---|
| Stack | Electron, with SQLite through `better-sqlite3` |
| Users | A small group of athletes to start |
| Data model | Athletes → sessions → pitches, with trends over time for each athlete |
| Review layout | The full frame on the left and a synced, zoomed crop of the catcher on the right. The target, ball path and catch overlays go on the crop, and a box on the full frame shows where the crop is. |
| Distribution | A download link on GitHub Releases. macOS needs code signing and notarization, or Gatekeeper warns users that the app is unsafe. |

## Phases

| Phase | Goal | Main deliverables | Done when |
|---|---|---|---|
| **0. Capture protocol** | Record video the system can measure | A one-page filming guide (see [Capture guidance](#capture-guidance)) and a built calibration board | A test session is filmed to spec with the board |
| **1. Desktop app, manual** | Replace the HTML page with a real app | Electron app with manual target/catch tagging, 4-tap calibration, athletes/sessions/pitches in SQLite, the review layout, CSV export, and a packaged download | A coach can install it, tag a session and see scores and trends |
| **2. Dataset + detector v1** | Teach a model to see the ball, mitt and catcher | Labeled frames in COCO format with a held-out validation set, a training script, and an RF-DETR v1 checkpoint | v1 finds the mitt and ball reliably on the validation set |
| **3. Detection in the app** | Let the app propose the points | ONNX export running in the app, ball tracking with curve fit and catch extrapolation, target taken at the release frame, and confirm/nudge UI | Most pitches only need a confirm tap |
| **4. Accuracy validation** | Show the numbers can be trusted | The ~100-pitch double-tagged test and an app-vs-human report | The accuracy goal is met, or we know what to fix |
| **5. Later ideas** | Grow the product | Trend reports for coaches, richer exports (PDF/CSV), capture or review on multiple devices, model retraining from confirmed taps | Driven by feedback |

Phases 0–1 and phase 2 can run at the same time. Phase 3 needs both.

## Open questions

- **Who reviews the results, and when?** The coach during the session, the athlete afterward, or both? This is still unanswered, and it affects how fast the review flow needs to be.
- **Windows support?** Electron makes it possible, but it needs testing, a Windows build and a different ONNX Runtime execution provider (for example DirectML or CPU).
- **Signing certificate.** An Apple Developer account ($99/year) is needed for macOS signing and notarization. If we ship on Windows, a Windows code-signing certificate is too.
