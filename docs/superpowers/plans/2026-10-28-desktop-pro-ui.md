# Desktop Pro-Tool UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Electron app's UI as a dark, three-column macOS pro tool (sidebar, viewer and timeline, inspector) with native menus, sheets and spring motion, without changing what any tag measures.

**Architecture:** `index.html` becomes a fixed window shell with four regions: title bar, sidebar, center and inspector. Pure decision logic (tool state, clip layout, avatars, selection) lives in `renderer/ui-logic.js` and is unit-tested with `node:test`. DOM modules render into the regions. A native Electron menu sends actions to the renderer over IPC. A Playwright-for-Electron end-to-end test guards click-to-frame accuracy from the first task to the last.

**Tech Stack:** Electron 45, vanilla ES modules (no build step), better-sqlite3, `node:test`, Playwright (`_electron`) for the e2e test, ffmpeg (dev machine only) to generate the test clip.

**Spec:** `docs/superpowers/specs/2026-10-28-desktop-pro-ui-design.md`. The visual reference is `.superpowers/brainstorm/93782-1793215893/content/pro-detail.html`. Read both before starting any task.

## Global Constraints

- macOS only. Don't add a Windows title bar, window controls or fonts; `dist:win` stays as-is and untested.
- Always dark. No light theme, and no `prefers-color-scheme` branches.
- No UI framework, no CDN or remote assets. CSP stays `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src media:`.
- Fonts: `-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif` and `ui-monospace, "SF Mono", Menlo, monospace`. No bundled fonts.
- Tokens: bg `#1c1c1e`, bars `#2c2c2e`, sidebar/inspector `#232325`, selection `#3a3a3c`, hairline separators `0.5px solid #000`, text `#f2f2f7`, secondary `#98989d`, blue `#0a84ff`, green `#30d158`, orange `#ff9f0a`, red `#ff453a`. Radii: controls 6–7px, cards 10px. Tabular numerals for all numbers.
- Motion: spring `cubic-bezier(.34,1.56,.64,1)`. Tool pill about 320 ms; ball pop about 500 ms (scale 0 → 1.25 → 1); clip spring-in about 550 ms; score count 600 ms ease-out cubic; page change about 220 ms crossfade with an 8px rise; panel width about 250 ms; sheet about 280 ms; chart draw-in about 450 ms; hover tint 100 ms. Nothing over about 550 ms except the count, and no animation blocks input.
- `prefers-reduced-motion: reduce` turns off all animations and transitions, while state changes stay visible.
- Window minimum 1000×700, and all three columns usable at that size.
- `renderer/scoring.js` and `test/scoring.test.js` are not modified. Stored coordinates and their meaning don't change.
- Existing single-key shortcuts stay in the renderer: Space, ←/→ (Shift ×10), G, M, Z, C (frame catcher), ⌫ (undo mark), Esc. ⌘ shortcuts move to the native menu.

## Review Focus

1. **Collapsing the sidebar or inspector after the zone is set.** The catcher view resizes, and clicks must still land on the exact frame pixel. Pinned in Task 10: toggle both panels, then tag, then assert exact readback.
2. **Tagging fast while the previous pitch is still animating.** No pitch is lost or duplicated, and numbering stays 1..n. Pinned in Task 10: tag 4 pitches with no waits and assert 4 rows numbered 4..1.
3. **Deleting the athlete or session currently shown.** The app selects the neighbor (or shows the empty state) and never shows a dead view. Pinned in Task 10.
4. **A session whose video file is gone.** The viewer shows the relink state, and the rest of the window (sidebar, inspector, timeline) still works. Pinned in Task 10.
5. **Reduce motion turned on.** Tagging still works, and nothing animates. Pinned in Task 10: with `reducedMotion: 'reduce'`, `document.getAnimations().length === 0` right after a catch.

---

## File Structure

| Path | Responsibility |
|---|---|
| `desktop/test/e2e/tagging.e2e.mjs` | Playwright drive: seed DB, open session, crop, zone, tag, assert exact readback |
| `desktop/test/e2e/make-clip.sh` | ffmpeg recipe for the synthetic 1080×1920 60 fps HEVC clip |
| `desktop/db.js` | + `listLibrary()` |
| `desktop/menu-template.js` | Pure function returning the native menu template (no `electron` import) |
| `desktop/main.js` | Builds the menu from the template; sends `menu` IPC |
| `desktop/preload.cjs` | + `onMenu(cb)` |
| `desktop/renderer/ui-logic.js` | Pure: `initials`, `avatarColor`, `toolState`, `clipFor`, `nextSelection` |
| `desktop/renderer/index.html` | Fixed shell: `#titlebar`, `#sidebar`, `#center`, `#inspector`, `#sheetHost` |
| `desktop/renderer/css/tokens.css`, `shell.css`, `controls.css`, `session.css`, `athlete.css` | Replaces `styles.css` |
| `desktop/renderer/motion.js` | `reducedMotion`, `countTo`, `replayClass`, `SPRING` |
| `desktop/renderer/sheets.js` | `openSheet` |
| `desktop/renderer/shell.js` | Title bar text and toolbar slots, panel toggles |
| `desktop/renderer/sidebar.js` | Source list rendering and selection |
| `desktop/renderer/app.js` | Boot, hash router, library state, menu dispatch |
| `desktop/renderer/athlete.js` | Athlete page cards and the edit sheet (moved out of `app.js`) |
| `desktop/renderer/charts.js` | Restyled for dark; draw-in class |
| `desktop/renderer/session/session.js` | Session controller: state, marking, keys, menu actions |
| `desktop/renderer/session/viewer.js` | Canvases, crop geometry, drawing (moved from `session.js`) |
| `desktop/renderer/session/timeline.js` | Timeline lane and List view |
| `desktop/renderer/session/inspector.js` | Pitch and Session tabs |
| `desktop/test/ui-logic.test.js`, `test/menu.test.js` | Unit tests |

**E2E selector contract.** Tasks 5–9 must keep these working:
- Sidebar: `.sb-athlete[data-id]`, `.sb-session[data-id]`
- Session: `#vid`, `#cvFull`, `#cvCrop`, `#drop`, `#play`, `#time`, `#scrub`
- Tool segments: `#tools [data-tool]` with `aria-pressed`
- Inspector: `#types [data-t]` (pitch-type grid), `#bigScore`
- Session tab: `#sN` (pitch count), `#zonePpi` (`"10.0 px/in"`)
- List view: `#viewToggle [data-v="list"]`, rows `#log tbody tr`

---

### Task 1: End-to-end tagging test in the repo

**Files:**
- Create: `desktop/test/e2e/tagging.e2e.mjs`, `desktop/test/e2e/make-clip.sh`
- Modify: `desktop/package.json` (devDependency `playwright@^1`, script `"test:e2e": "node test/e2e/tagging.e2e.mjs"`), `desktop/.gitignore` (+ `test/e2e/.out/`)

**Interfaces:**
- Produces: `npm run test:e2e`. Exit code 0 means pass, and it prints `E2E PASS`. Screenshots go in `test/e2e/.out/`.

- [ ] **Step 1: Write `make-clip.sh`** so it writes `test/e2e/.out/test_hevc.mov` with the exact ffmpeg filter from the scratch run, skipping the work if the file already exists:
`color=c=0x3a5a3a:s=1080x1920:r=60:d=4`, a catcher box `380,1000 320x360 0x1c2c4c`, plate `455,1420 170x40 white`, a moving ball, a frame-number overlay, `-c:v libx265 -tag:v hvc1 -pix_fmt yuv420p`.
- [ ] **Step 2: Port the scratch script** `/private/tmp/claude-501/-Users-larrygunteriv-github-training-pitch-tracker/f93a6efc-f24f-44fd-baf4-610fbaeb6265/scratchpad/e2e/run.mjs` into `tagging.e2e.mjs`. Changes from the scratch version:
  - all paths relative to the file; `executablePath` = `require('electron')` resolved from `desktop/`
  - run `make-clip.sh` first
  - replace the `console.log` checks with `node:assert` assertions
  - no fixed sleeps beyond the existing 150 ms
- [ ] **Step 3: Assertions (exact values):**
  - zone status reads `10.0 px/in`
  - after tagging plan `[['FB',2,1],['FB',7,3],['SL',-4,-6],['CH',3,-2],['FB',0,0.5],['CB',-1,-9]]`, the log rows read `A 2.0"/U 1.0"`, `A 7.0"/U 3.0"`, `G 4.0"/D 6.0"`, `A 3.0"/D 2.0"`, `A 0.0"/U 0.5"`, `G 1.0"/D 9.0"`
  - score `80`, pitch count `6`
  - DB pitch 1 has `glove.t === 0.175` and `loc.t === 0.208`
  - zero console errors
- [ ] **Step 4: Run** `cd desktop && npm i -D playwright@1 && npm run test:e2e`. Expected: `E2E PASS`.
- [ ] **Step 5: Commit**
```bash
git add desktop/test/e2e desktop/package.json desktop/package-lock.json desktop/.gitignore
git commit -m "Add end-to-end tagging accuracy test"
```

### Task 2: `listLibrary()` for the sidebar

**Files:** Modify `desktop/db.js`, `desktop/main.js` (add `'listLibrary'` to `DB_METHODS`); Test `desktop/test/db.test.js`

**Interfaces:**
- Produces: `listLibrary(): Array<{id, name, throws, level, notes, createdAt, sessions: Array<Session & {pitches: Pitch[]}>}>`. Athletes are ordered by name (NOCASE); sessions newest first. Each session has the same shape as an entry in `getAthlete(id).sessions`.

- [ ] **Step 1: Failing test** `'listLibrary returns every athlete with sessions newest first'`: create athletes `'Zed'` and `'amy'`. Give amy two sessions (`recordedOn` `'2026-10-01'` and `'2026-10-20'`) with 1 and 2 pitches. Assert:
  - `lib.map(a=>a.name)` deep-equals `['amy','Zed']`
  - `lib[0].sessions.map(s=>s.recordedOn)` deep-equals `['2026-10-20','2026-10-01']`
  - `lib[0].sessions[0].pitches.length === 2`
  - `lib[1].sessions` deep-equals `[]`
- [ ] **Step 2:** `npm test`. Expected: FAIL, `db.listLibrary is not a function`.
- [ ] **Step 3: Implement** by reusing the existing `q.athletes`, `q.sessionsFor` and `pitchesFor`.
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `"Add listLibrary for the sidebar"`

### Task 3: Pure UI logic

**Files:** Create `desktop/renderer/ui-logic.js`, `desktop/test/ui-logic.test.js`. Modify the `test` script to run `node --test test/scoring.test.js test/ui-logic.test.js` before the db test.

**Interfaces:**
- Produces:
  - `AVATAR_COLORS = ['#0a84ff','#ff9f0a','#30d158','#bf5af2','#ff375f','#64d2ff','#ffd60a','#5e5ce6']`
  - `initials(name: string): string`: first letter of the first word and of the last word, uppercased, at most 2 characters; `'?'` for a blank name.
  - `avatarColor(name: string): string`: `AVATAR_COLORS[sum of char codes % 8]`.
  - `toolState({mode, hasZone, hasVideo, draft, selected, editField}): {active: 'zone'|'target'|'manual'|'catch'|null, catchEnabled: boolean, hud: string}`. `mode` is the session's existing `'zone'|'target'|'manual'|'location'`; `selected` is `{n}` or null; `editField` is `'glove'|'manual'|'loc'|null`.
  - `HUD = {zone:'Drag a box over the strike zone', target:'Click the glove at release', manual:'Click the intended target', catch:'Click where the ball is caught', noVideo:'Load the bullpen video'}`
  - `MIN_CLIP = 0.012`
  - `clipFor(pitch: {glove, manual, loc}, duration: number): {left: number, width: number, marker: boolean}` (fractions 0..1)
  - `nextSelection(ids: number[], removedId: number): number|null`

- [ ] **Step 1: Failing tests** (one `test()` each):
  - `initials('Sam Ortiz')==='SO'`, `initials('  cher ')==='C'`, `initials('Mary Jo Van Dyke')==='MD'`, `initials('')==='?'`
  - `avatarColor('Sam Ortiz')===avatarColor('Sam Ortiz')`, and it's in `AVATAR_COLORS`
  - toolState with no zone → `{active:'zone', catchEnabled:false, hud:HUD.zone}`
  - mode `'target'` → active `'target'`, `catchEnabled:false`
  - mode `'location'` with a draft glove → active `'catch'`, `catchEnabled:true`, `hud:HUD.catch`
  - mode `'manual'` → active `'manual'`
  - `selected:{n:4}, editField:'loc'` → active `'catch'`, `hud:'Editing #4'`
  - `editField:'glove'` → `'target'`; `editField:'manual'` → `'manual'`
  - `selected:{n:4}`, editField null → `active:null`, `hud:'Editing #4'`
  - `hasVideo:false` → `active:null`, `hud:HUD.noVideo`
  - clipFor with `glove.t 1, loc.t 1.5`, duration 10 → `{left:0.1, width:0.05, marker:false}`
  - manual only, `loc.t 5` → `{left:0.5-MIN_CLIP/2, width:MIN_CLIP, marker:true}`
  - `glove.t 2, loc.t 1.5` → marker
  - `glove.t 1.00, loc.t 1.05` (duration 10) → width `MIN_CLIP`
  - `loc.t 9.999` → `left + width <= 1`
  - `nextSelection([1,2,3],2)===3`, `([1,2,3],3)===2`, `([5],5)===null`
- [ ] **Step 2:** `npm test`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Check `hasVideo` first, then `editField`/`selected`, then `hasZone`, then `mode`.
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `"Add pure UI logic for tools, clips and avatars"`

### Task 4: Native menu

**Files:** Create `desktop/menu-template.js`, `desktop/test/menu.test.js` (add it to the `node --test` list). Modify `desktop/main.js`, `desktop/preload.cjs`. Add `menu-template.js` to the `build.files` list in `desktop/package.json`.

**Interfaces:**
- Produces: `menuTemplate(send: (action: string) => void): object[]`, a pure Electron `MenuItemConstructorOptions` array.
  - Actions and accelerators:
    - `new-athlete` `CmdOrCtrl+N`, `new-session` `CmdOrCtrl+Shift+N`, `relink-video`, `show-db`, `export-csv` `CmdOrCtrl+E`
    - `undo-mark`, `delete-pitch`
    - `toggle-sidebar` `Alt+CmdOrCtrl+S`, `toggle-inspector` `Alt+CmdOrCtrl+I`, `toggle-list` `CmdOrCtrl+L`, `inspector-pitch` `CmdOrCtrl+1`, `inspector-session` `CmdOrCtrl+2`
    - `show-all` (type `checkbox`, checked), `frame-catcher`, `redraw-zone`, `delete-session`, `help-score`
  - Menus: app menu (`role:'appMenu'`), File, Edit (`role:'editMenu'` items, then a separator, then Undo Mark and Delete Pitch), View, Session, Help.
  - Single-key commands have **no** accelerator; their labels carry the key, e.g. `'Undo Mark  ⌫'`, `'Redraw Zone  Z'`, `'Frame Catcher  C'`.
- Produces in preload: `window.bullpen.onMenu(cb: (action: string) => void)`.

- [ ] **Step 1: Failing tests:**
  - collect every item with `click`; calling each item's `click()` sends exactly its action string (record via a `send` spy)
  - `accelerator` of `toggle-sidebar` is `'Alt+CmdOrCtrl+S'` and of `export-csv` is `'CmdOrCtrl+E'`
  - no item's accelerator is a bare single key (each matches `/(Cmd|Ctrl|Alt|Shift)/`)
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the template. In `main.js`, call `Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(a => BrowserWindow.getFocusedWindow()?.webContents.send('menu', a))))` inside `whenReady`. Add `onMenu` to the preload.
- [ ] **Step 4:** `npm test && npm run test:e2e`. Expected: both pass. The renderer ignores menu messages for now.
- [ ] **Step 5: Commit** `"Add native macOS menu"`

### Task 5: Window shell, sidebar, sheets, router

**Files:**
- Create: `renderer/css/tokens.css`, `css/shell.css`, `css/controls.css`, `renderer/motion.js`, `renderer/sheets.js`, `renderer/shell.js`, `renderer/sidebar.js`, `renderer/athlete.js` (moved from `app.js` unchanged for now)
- Modify: `renderer/index.html`, `renderer/app.js`, `test/e2e/tagging.e2e.mjs` (navigation only)
- Delete: the roster `homeView` from `app.js`

**Interfaces:**
- `motion.js`: `SPRING`; `reducedMotion(): boolean`; `countTo(el: HTMLElement, to: number, ms = 600): void` (ease-out cubic, sets the value directly when motion is reduced); `replayClass(el, cls): void` (removes the class, forces reflow, adds it).
- `sheets.js`: `openSheet({title, body: string, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false}): Promise<FormData|null>`. The sheet slides down from under the title bar over a dimmed backdrop. Esc resolves `null`; Return or Confirm resolves `new FormData(form)`, where `body` is HTML placed inside a `<form>`. Only one sheet is open at a time.
- `shell.js`:
  - `setTitle(title: string, subtitle = '')`
  - `setToolbar({center = '', right = ''})`: HTML for `#tbCenter`/`#tbRight`
  - `togglePanel(name: 'sidebar'|'inspector', open?: boolean): void`: animates the width; persists to `localStorage` keys `bullpen.panel.sidebar` and `bullpen.panel.inspector` inside try/catch
  - `setInspector(html: string)`
- `sidebar.js`: `renderSidebar(el, library, {athleteId, sessionId}, {onAthlete(id), onSession(id), onNewAthlete()})`
  - each row: avatar (`initials`/`avatarColor`), name with ellipsis truncation
  - the selected athlete expands its sessions: date (`fmtDate` without the year) and score (`Math.round(summary(scored(...)).score)` or `–`)
  - row classes `.sb-athlete`/`.sb-session`; "＋ New Athlete" pinned at the bottom; the list scrolls inside the sidebar
- `app.js`:
  - holds `library` (from `listLibrary`)
  - routes `#/athlete/:id`, `#/session/:id`, and `#/`, which redirects to the last athlete (`localStorage` `bullpen.lastAthlete`), else the first athlete, else the empty state
  - `ctx = {reload(): Promise<void>, go(hash), library}` passed to views
  - the page change crossfades `#center` (220 ms, 8px rise)
  - `onMenu` dispatches `new-athlete`, `toggle-sidebar`, `toggle-inspector` and `show-db` here; everything else forwards to the active view's `onMenu(action)` if it has one
- New Athlete is now an `openSheet` with name, a throws segmented control and level.

- [ ] **Step 1: Update the e2e navigation** to click `.sb-athlete[data-id]`, then `.sb-session[data-id]`, instead of `.card` and the sessions table. Run `npm run test:e2e`. Expected: FAIL (selector not found).
- [ ] **Step 2: Build the shell.**
  - `index.html` regions: `#titlebar` (44px, `-webkit-app-region: drag`, 78px left inset for the traffic lights, `#tbTitle`, `#tbCenter`, `#tbRight`, a ◧ button `#tglSidebar` and a ◨ button `#tglInspector`), `#sidebar` (~200px), `#center`, `#inspector` (~240px), `#sheetHost`
  - `body` is `overflow: hidden`, height 100vh; regions scroll internally
  - the existing session view mounts into `#center` for now; it scrolls inside `#center`
  - with no athletes, `#center` shows the empty state: the title "Add your first pitcher", one line of help, and a primary "＋ New Athlete" button that opens the sheet
  - `controls.css`: buttons, segmented controls, rows and inputs in the token palette; hover and press change only the background tint (`transition: background-color 100ms`); no underlines and no browser-default control chrome
- [ ] **Step 3:** `npm run test:e2e`. Expected: `E2E PASS`.
- [ ] **Step 4: Visual check.** Take a screenshot of the athlete page in the e2e run (`.out/shell.png`) and compare it with the reference mockup's title bar and sidebar: hairlines, avatar circles, selection fill `#3a3a3c`, active session `#0a84ff`.
- [ ] **Step 5: Commit** `"Add pro window shell, sidebar, sheets and router"`

### Task 6: Athlete page

**Files:** Modify `renderer/athlete.js`, `renderer/charts.js`; create `renderer/css/athlete.css`

**Interfaces:**
- Consumes: `setTitle`, `setToolbar`, `setInspector`, `openSheet`, `countTo`, `ctx.reload`, `nextSelection`.
- Produces: `athleteView(center: HTMLElement, athlete, ctx): () => void` (returns cleanup).

- [ ] **Step 1: Title bar.** The title is the athlete name; the subtitle is `RHP · Level · N sessions`. The right side holds a `Last 5 | All` segmented control (default as today: `5` when there are more than 5 sessions) and a "＋ New Session" primary button. When the athlete page is shown, the inspector is hidden.
- [ ] **Step 2: Card grid** (`grid-template-columns: 1.4fr 1fr`):
  - "Command over time" spans 2 rows, with Trend (last minus first session score, signed), Hit rate and Avg miss beneath it
  - "Command" score card: the number uses `countTo` on open
  - "What the misses say" (insights)
  - "Miss pattern" plus the heat map
  - "Pitch types" table
  - "Sessions" table: row click goes to the session
- [ ] **Step 3: Charts.** Restyle `charts.js` for dark: grid lines `rgba(255,255,255,.07)`, labels `#98989d`. Lines get `class="draw"`, animated with `stroke-dasharray`/`stroke-dashoffset` over 450 ms; heat cells use tints of the system colors. Keep the function signatures as they are.
- [ ] **Step 4: Edit Athlete** (from a title-bar "Edit" button) is an `openSheet` with name, throws, level and notes. **Delete Athlete** is a destructive confirm sheet. After deleting, go to `nextSelection(library ids, id)`, or `#/` when there's no neighbor.
- [ ] **Step 5:** `npm test && npm run test:e2e`. Expected: both pass. Screenshot `.out/athlete.png` and compare it with the reference's athlete window.
- [ ] **Step 6: Commit** `"Restyle athlete page as dark cards with sheets"`

### Task 7: Session viewer, tool control and HUD

**Files:**
- Create: `renderer/session/viewer.js`, `renderer/session/session.js` (moved from `renderer/session.js`, which is deleted), `renderer/css/session.css`
- Modify: `renderer/app.js` (import path), `test/e2e/tagging.e2e.mjs`: the old `#stZone` step boxes go away in this task, so the zone check becomes "`#tools [data-tool="target"]` has `aria-pressed="true"` after the zone drag". Task 9 adds the exact `#zonePpi` check back.

**Interfaces:**
- Consumes: `toolState`, `HUD`, `setTitle`, `setToolbar`, `countTo`, `replayClass`.
- Produces:
  - `createViewer({fullCanvas, cropCanvas, video, getSession, getList, getDraft, getSelectedId}): {draw(), resize(), setCrop(c, persist?), frameCatcher(), toFrameCrop(e), toFrameFull(e), crop}`. This moves the existing geometry and drawing code from `session.js` unchanged; behavior must be identical.
  - `sessionView(center, id, ctx): {cleanup(), onMenu(action)}`
- Toolbar center: `#tools` segmented control with buttons `[data-tool="zone|target|manual|catch"]`, labels `Zone Z`, `Target G`, `Manual M`, `Catch` (no key). The sliding pill uses the spring at 320 ms. `aria-pressed` follows `toolState().active`, and Catch is `disabled` unless `catchEnabled`. Clicking Zone acts like Z, Target like G, Manual like M.
- The HUD is a frosted pill (`backdrop-filter: blur(14px)`, `rgba(28,28,30,.72)`) centered at the top of the catcher view, with text from `toolState().hud`.
- The title is `<date> Bullpen`; the subtitle is `Name · RHP · <fps> fps`.
- The transport row sits under the viewer. Timecode `#time` is SF Mono, right-aligned, format unchanged.
- On a committed catch: `replayClass` pops the new ball marker (it's drawn on canvas, so animate a DOM ring overlay positioned at the catch point for 500 ms instead), and `countTo(#bigScore)`.

- [ ] **Step 1:** Move the code; run `npm run test:e2e`. Expected: PASS (pure refactor).
- [ ] **Step 2:** Build the tool control and HUD, and remove the old step boxes and instruction text. Run `npm run test:e2e` with its tool-state assertion. Expected: PASS.
- [ ] **Step 3: Commit** `"Move session viewer into pro layout with tool control and HUD"`

### Task 8: Timeline and List

**Files:** Create `renderer/session/timeline.js`; modify `renderer/session/session.js`, `css/session.css`

**Interfaces:**
- Consumes: `clipFor`, `TCOL`.
- Produces: `renderTimeline(el, list, duration, {selectedId, onSelect(id), onScrub(t)}): {setPlayhead(t)}` and `renderList(el, list, {selectedId, onSelect(id)})` (the existing pitch-log table, restyled).
- The lane is 34px with a ruler pattern. Each clip is positioned by `clipFor` and colored by pitch type, labeled `#n` with the score in small text. A clip whose id is newer than any rendered before gets `class="in"` (spring-in, 550 ms). The red playhead with its head marker follows `timeupdate` and rAF during playback. Click or drag on empty lane calls `onScrub(fraction*duration)`; clicking a clip calls `onSelect(id)`, which selects and seeks to `loc.t`.
- `#viewToggle` is a segmented control `Timeline | List` (`[data-v="timeline"|"list"]`). The `toggle-list` menu action flips it, and the choice persists in `localStorage` `bullpen.view`.

- [ ] **Step 1:** Update the e2e test to switch to List (`#viewToggle [data-v="list"]`) before reading `#log tbody tr`, and to assert 6 `.clip` elements in the timeline before switching. Run. Expected: FAIL.
- [ ] **Step 2:** Implement. Run `npm run test:e2e`. Expected: PASS.
- [ ] **Step 3: Commit** `"Add pitch timeline and list toggle"`

### Task 9: Inspector and menu actions

**Files:** Create `renderer/session/inspector.js`; modify `renderer/session/session.js`, `renderer/app.js`, `css/session.css`

**Interfaces:**
- Produces:
  - `renderPitchTab(el, {list, selected, draft, curType, source, hasVideo, onType(t), onPreset(col,row), onAction(a)})`
  - `renderSessionTab(el, {session, list, filter, onSetting(patch), onFilter(t)})`
- **Pitch tab:**
  - `#bigScore` with grade (session score; `countTo` on change)
  - `#types` 4×2 grid `[data-t]`
  - a zone-third picker, shown only when Manual is active
  - a "Last pitch" / "Pitch #n" block: miss, arm/glove, up/down, score
  - for a selected pitch: Go to Target Frame, Go to Catch Frame, Re-mark Glove/Manual/Location, Use Glove Instead, Delete (a destructive sheet, not tap-twice), and the setup-offset note
- **Session tab:**
  - settings: date, camera view, hit radius, fps
  - stats: hit rate, average miss, in zone, `#sN` pitches, `#zonePpi` (`fmt(zone.w/17)+' px/in'` or `Not set`)
  - insights, a pitch-type filter, then scatter, heat, rolling trend and type table, compact; the tab scrolls internally
- Tabs switch via `⌘1`/`⌘2` (menu actions).
- **Session `onMenu`:**
  - `export-csv`: clipboard copy as today, with a toast and the textarea fallback inside a sheet
  - `relink-video`, `undo-mark`, `delete-pitch` (selected only)
  - `show-all`, `frame-catcher`, `redraw-zone`
  - `delete-session`: destructive sheet, then go to the athlete
  - `new-session`: same as the athlete page button
  - `help-score`: a sheet with the existing "How the score works" text
- The title bar right side holds Export ⇪ (`export-csv`) and ◨.

- [ ] **Step 1:** Update the e2e test: zone check via the Session tab `#zonePpi === '10.0 px/in'`, count via `#sN === '6'`. Run. Expected: FAIL.
- [ ] **Step 2:** Implement, and remove everything below the viewer and timeline in the center (the old bench, trends and log sections). Run `npm test && npm run test:e2e`. Expected: PASS.
- [ ] **Step 3: Visual check.** Screenshot `.out/session.png` and compare it with the reference session window.
- [ ] **Step 4: Commit** `"Add inspector tabs and wire menu actions"`

### Task 10: Review-focus tests, reduced motion, packaging

**Files:** Modify `desktop/test/e2e/tagging.e2e.mjs`; fix whatever the new tests expose

- [ ] **Step 1: Add the e2e cases** (in the same run, after the main tagging assertions):
  1. **Panel toggle.** Send `toggle-sidebar` and `toggle-inspector` through `app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.send('menu','toggle-sidebar'))`, wait 300 ms, recompute the canvas rects, tag `['FB',5,-1]`, and assert the newest log row reads `A 5.0"`/`D 1.0"`. Then toggle both back.
  2. **Rapid tagging.** Tag 4 pitches with no waits between clicks; assert the List shows 4 more rows and the first column reads `n..n-3` in order, with `#sN` equal to the total.
  3. **Delete the current session.** Send `delete-session`, confirm the sheet (press Return), and assert the hash becomes `#/athlete/<id>` and the sidebar no longer lists the session id.
  4. **Missing video.** Seed a second session with `videoPath` pointing at a nonexistent file, open it, and assert `#drop` is visible with the text "Can't open this video", the sidebar still works, and clicking `#types [data-t="SL"]` doesn't throw (no new console errors).
  5. **Reduced motion.** Relaunch with `electron.launch({... })`, then `page.emulateMedia({reducedMotion:'reduce'})`. Tag one pitch and assert `await page.evaluate(() => document.getAnimations().length) === 0` immediately after the catch click.
- [ ] **Step 2:** `npm run test:e2e`. Fix the failures in the owning modules until it prints `E2E PASS`.
- [ ] **Step 3: Minimum size.** Resize the window to 1000×700 in the e2e test (`BrowserWindow.setSize`), screenshot `.out/min.png`, and assert `#cvCrop` width > 300 and that the document is not scrollable (`document.scrollingElement.scrollHeight <= innerHeight`).
- [ ] **Step 4: Packaging.** Run `npm run dist:mac`, then launch the packaged arm64 app via Playwright with the seeded DB, open the session, and assert `#bigScore` is visible.
- [ ] **Step 5:** `npm test && npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit** `"Cover panel toggles, rapid tagging, deletion, missing video and reduced motion"`
