# Desktop app: "pro tool" UI overhaul

Status: approved direction (B, "Final Cut / Logic"), 2026-10-28
Applies to: `desktop/` (Electron app on branch `feat/desktop-app`)

## Intent

The desktop app works, but it looks like a web page: one long scrolling document of panels. The owner wants it to feel like a polished Apple app. After seeing three directions (native light Mac, dark pro tool, Health/Fitness), the owner chose the **dark pro tool**, modeled on Final Cut Pro and Logic Pro. Tagging bullpen video is repetitive, focused work done for a long time on one screen, which is exactly what those apps are built for. The video stays at the center, controls stay where your hands already are, and nothing scrolls away.

The owner approved the interactive mockup (preserved at `.superpowers/brainstorm/93782-1793215893/content/pro-detail.html`), including the layout and the motion. Treat that file as the visual reference.

## Goals

- One window that never scrolls as a page: sidebar, viewer and inspector are fixed regions, and only lists inside them scroll.
- It reads as a native macOS pro app: dark, dense, with SF Pro type, system colors, hairline separators, a unified title bar and a frosted HUD.
- Tagging gets faster, or at least no slower: every step is reachable from the keyboard, and the current tool is always visible.
- Motion is quick and springy and always says what changed. It never just decorates.

## Non-goals

- No new features beyond what the redesign needs. Model detection, calibration-board support, signing and an app icon are separate work.
- No light theme. The app is always dark, the way Final Cut is.
- **macOS only.** The owner decided on 2026-10-28 not to deal with Windows for now. Build and test only on macOS. The `dist:win` script can stay, but its look isn't designed or tested, and the Windows build may run with a rough default frame. No Windows title bar, window controls or font work.
- No change to scoring math, the database schema's meaning, or the stored coordinates.

## Anti-goals (failure even if it "works")

- Anything that makes a mark land somewhere other than where it was clicked, or makes frame stepping less exact. The end-to-end check that tagged pitches read back exactly (for example, 7" arm side and 3" up reads `A 7.0" U 3.0"`) must still pass.
- A web-page feel: page scroll, big padded cards everywhere, hover underlines, browser-default form controls.
- Motion that slows down tagging: no animation may block input, and nothing runs longer than about 550 ms.
- Pulling in a UI framework or CDN assets. The app has to work offline, under its current CSP.

## Constraints

- Electron 45, vanilla ES modules in `desktop/renderer/` (no build step), `better-sqlite3` through the existing IPC bridge. Keep `scoring.js` and its tests unchanged.
- CSP stays `default-src 'self'`, with inline styles allowed and `media:` for video.
- Fonts: the system font stack (`-apple-system`, which resolves to SF Pro, and `ui-monospace`, which resolves to SF Mono). No bundled fonts.
- Respect macOS "Reduce motion" (`prefers-reduced-motion`): all motion off, with state changes still visible.
- Window minimum stays 1000×700, and all three columns must work at that size (the sidebar and inspector are collapsible).

## Layout (decided)

```
┌ title bar (44px, unified, draggable) ───────────────────────────────────────┐
│ ●●●  ◧  Title / subtitle      [Zone Z|Target G|Manual M|Catch C]    ⇪  ◨     │
├──────────────┬──────────────────────────────────────────────┬───────────────┤
│ Sidebar      │ Viewer: full frame (left) | catcher crop     │ Inspector     │
│ ~200px       │   frosted HUD instruction centered on top    │ ~240px        │
│ Athletes     │ Transport: ⏮ ◀1 ▶ 1▶ ⏭  speed   timecode·frame │ Tabs:         │
│  ▸ sessions  ├──────────────────────────────────────────────┤ Pitch|Session │
│   w/ scores  │ Timeline | List toggle                       │               │
│ + New Athlete│ lane: one colored clip per pitch, playhead   │               │
└──────────────┴──────────────────────────────────────────────┴───────────────┘
```

- **Sidebar (source list).** Every athlete has an avatar circle with initials and a color derived from the name. The selected athlete expands with a disclosure triangle to show its sessions, newest first, each with its date and session score. "＋ New Athlete" is pinned at the bottom. Selecting an athlete shows the athlete page in the center; selecting a session opens the session. Toggle with ◧ or ⌘⌥S.
- **Title bar.** It merges with the macOS traffic lights (`titleBarStyle: hiddenInset`). It shows a title and subtitle for the current page. On a session it also shows the tool segmented control, an Export button and the inspector toggle ◨ (⌘⌥I). On an athlete page it shows the Last 5 | All range control and a "＋ New Session" button.
- **Session viewer.** Full frame and catcher crop side by side on black, with the same interactions as today: drag or scroll the crop box on the full frame, scroll to zoom the catcher view, Shift-drag to pan, drag to draw the zone. The instruction text moves from the side panel into a frosted HUD pill centered at the top of the catcher view. The transport row sits under the viewer, with timecode and frame number in SF Mono on the right.
- **Timeline** (replaces the pitch log as the default). A horizontal lane spanning the video's duration. Each tagged pitch is a clip at its target-to-catch time span, colored by pitch type and labeled `#n` with its score. Clicking a clip selects that pitch and seeks to it. Clicking or dragging empty lane scrubs. A red playhead follows playback. The **List** toggle swaps the lane for the existing pitch table, restyled.
- **Inspector, Pitch tab.** The session command score (large, colored by tone) with its grade; the pitch-type grid (8 buttons, 4×2); target source (Glove | Manual) as a segmented control; a manual zone-third picker when Manual is active; and the selected or last pitch's miss, arm/glove side, up/down and score. Edit actions for a selected pitch go here (re-mark, delete).
- **Inspector, Session tab.** Session settings (date, camera view, hit radius, fps), the stats (hit rate, average miss, in zone, pitches), the written findings, the miss scatter, the hit-rate heat map, the rolling trend and the per-type table. All of these are compact and the tab scrolls on its own.
- **Athlete page** (center, when an athlete is selected). A grid of dark cards: command over time (the large card), current command score, findings, the miss scatter and heat map, and a sessions table. Editing the athlete (name, throws, level, notes, delete) opens as a sheet.
- **Empty states.** No athletes: the center shows a single "Add your first pitcher" prompt with the New Athlete button. A session without a video, or with a missing one: the viewer shows the drop target and a Choose/Relink button, styled to match.
- **Sheets.** New Athlete, Edit Athlete and destructive confirmations appear as macOS-style sheets that slide down from under the title bar over a dimmed backdrop. They replace the inline forms and the "tap again to delete" buttons. Esc cancels, Return confirms.

## Visual tokens (decided)

The macOS dark system palette: background `#1c1c1e`, bars `#2c2c2e`, sidebar and inspector `#232325`, selection `#3a3a3c`, separators black with 0.5px hairlines, text `#f2f2f7`, secondary text `#98989d`. Accents: blue `#0a84ff` (primary and current tool), green `#30d158` (good), orange `#ff9f0a` (warn), red `#ff453a` (bad, and the playhead). Pitch-type colors keep their identity but are retuned to system hues so they read on dark. Corner radii are 6–7px for controls, 10px for cards and 12px for the window. Numbers use tabular figures.

## Motion (decided)

| Event | Motion |
|---|---|
| Tool changes (automatic as you tag, or by key) | The segmented highlight slides with a spring, `cubic-bezier(.34,1.56,.64,1)`, about 320 ms |
| Catch committed | The ball marker pops in (scale 0 → 1.25 → 1, about 500 ms); a new clip springs into the timeline from below (about 550 ms); the score counts to its new value (600 ms, ease-out cubic) |
| Page change (athlete ↔ session) | The center crossfades with an 8px rise, about 220 ms |
| Sidebar or inspector toggle | Width animates with a spring, about 250 ms |
| Sheet open/close | Slides down from the title bar with the backdrop fading, about 280 ms; reverses on close |
| Charts on page open | Lines draw in and bars grow, about 450 ms, once per open |
| Hover and press | Background tint changes only, 100 ms; no movement |

None of these block input. A new mark can be placed while the previous animation is still running.

## Keyboard (decided)

Existing keys stay: Space, ←/→ (Shift ×10), G, M, Z, C (frame catcher), ⌫, Esc. The segmented control shows the keys for Zone (Z), Target (G) and Manual (M). The Catch segment shows no key: you reach it automatically once a target is placed, and C keeps its current meaning (frame catcher). This differs from the mockup, which labeled Catch with C. Add ⌘N (New Athlete), ⌘⌥S and ⌘⌥I (toggle panels), ⌘1/⌘2 (inspector tabs) and ⌘L (Timeline/List).

## Tool control states (builder's call, recorded here)

- There is one source of truth for the target type: the title-bar segments. The inspector does **not** repeat a Glove | Manual control. When Manual is active, the inspector shows the zone-third picker.
- **Zone** (click or Z) enters redraw mode, the same as Z today. The existing zone stays until a new one is dragged, so it isn't destructive.
- **Catch** is disabled until a target is placed, and then it becomes active automatically.
- **Editing a selected pitch:** the control highlights the step being re-marked (Target for glove or manual, Catch for location), and the HUD reads "Editing #n".

## Where today's controls go (builder's call, recorded here)

A native macOS menu bar (Electron `Menu`) is in scope, because pro Mac apps put secondary commands there. Menu items send IPC to the renderer, and their accelerators replace the renderer keydown handlers for the ⌘ shortcuts.

- **File:** New Athlete ⌘N, New Session ⌘⇧N, Relink Video…, Show Database File, Export CSV ⌘E
- **Edit:** the standard items, plus Undo Mark ⌫ and Delete Pitch
- **View:** Toggle Sidebar ⌘⌥S, Toggle Inspector ⌘⌥I, Timeline/List ⌘L, Show All Pitches, Frame Catcher (C)
- **Session:** Redraw Zone (Z), Delete Session… (opens a confirmation sheet)
- **Help:** How the Score Works (a sheet)

These remain in the inspector, on the Pitch tab for a selected pitch: Go to Target Frame, Go to Catch Frame, Re-mark Glove/Manual/Location, Use Glove Instead, Delete, and the catcher setup-offset note. The Session tab keeps the pitch-type filter above its charts.

- **Export (⇪)** copies the session CSV to the clipboard, the same as today's Copy CSV, with the same fallback. Saving to a file is out of scope.
- **Default center view:** on launch, the last-opened athlete is selected (remembered in `localStorage`), falling back to the first athlete. With no athletes, the "Add your first pitcher" empty state appears. After deleting an athlete, the next athlete in the list is selected.

## Timeline clips (builder's call, recorded here)

A clip spans from the glove time to the catch time. When the only target is manual, or the target time isn't before the catch, the clip is a fixed-width marker centered on the catch time. Clicking a clip selects the pitch and seeks to its catch frame.

## Regression check (builder's call, recorded here)

The "end-to-end tagging check" is the Playwright-for-Electron script used during v0.1 development, which lives outside the repo (in session scratch). The first plan task moves it into `desktop/test/e2e/`: it generates the synthetic HEVC clip with ffmpeg, seeds a scratch DB through `BULLPEN_DB`, sets the crop and zone, tags 6 pitches at known inch offsets, and asserts the log reads them back exactly. It is added as `npm run test:e2e`, with Playwright as a dev dependency. It must pass before and after the redesign, so its click helpers have to be updated to the new layout without changing what they assert.

## Data needed

The sidebar needs every athlete's sessions with a score, without opening each one. Add a DB method (for example, `listLibrary`) that returns the athletes with their sessions and pitches, scored in the renderer as the athlete page already does. The data is small: a handful of athletes with tens of sessions.

## Left to the builder

- How the renderer is split into modules (sidebar, viewer, timeline, inspector, sheets).
- Exact pixel sizes, beyond the approximate widths above.
- Whether the athlete page keeps the current chart builders, restyled, or gets new ones, as long as they match the dark card look.
- How to handle the pitch-type clip colors when two clips are very close on the timeline (overlap, stacking or minimum width).
- Any additional regression tests, beyond keeping the existing tests and the end-to-end tagging check passing.
