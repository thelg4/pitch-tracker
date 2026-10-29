// End-to-end check: drive the real app, tag pitches by clicking, and assert they read back exactly.
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../..');
const OUT = path.join(HERE, '.out');
const DB = path.join(OUT, 'e2e.db'), VIDEO = path.join(OUT, 'test_hevc.mov');
const electronBin = createRequire(path.join(APP, 'package.json'))('electron');

execFileSync(path.join(HERE, 'make-clip.sh'), { stdio: 'inherit' });
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
const PROFILE = path.join(OUT, 'profile'); // a fresh profile each run: a first launch, whatever the real app has stored
fs.rmSync(PROFILE, { recursive: true, force: true });
const menu2 = (app, action) => app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('menu', a), action);
const asNode = code => execFileSync(electronBin, ['--input-type=module', '-e', code], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: APP }).toString();

asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)});
  const a = d.createAthlete({name:'Test Pitcher', throws:'R', level:'College'});
  d.createSession({athleteId:a.id, videoPath:${JSON.stringify(VIDEO)}, title:'test_hevc.mov', fps:60, recordedOn:'2026-10-27'}); d.close();`);

const app = await electron.launch({ executablePath: electronBin, args: [APP], env: { ...process.env, BULLPEN_DB: DB, BULLPEN_USER_DATA: PROFILE } });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const menu = action => app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send('menu', a), action);

  // Welcome: opens on the first launch of this version, never again after that unless asked for.
  const version = await app.evaluate(({ app }) => app.getVersion());
  await page.waitForSelector('body[data-launched]', { state: 'attached' });
  await page.waitForSelector('#sheetHost .welcome');
  assert.match(await page.$eval('#sheetHost .wver', e => e.textContent), new RegExp(`Version ${version.replaceAll('.', '\\.')}\\s+Pre-alpha`));
  assert.equal(await page.$eval('#sheetHost [type=submit]', e => e.textContent), 'Get Started'); // the library already has an athlete
  assert.equal(await page.$eval('#sheetHost [name=always]', e => e.checked), false);
  await page.waitForTimeout(350); // let the slide-down settle before the screenshot
  await page.screenshot({ path: `${OUT}/0-welcome.png` });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#sheetHost form'));
  await page.reload();
  await page.waitForSelector('body[data-launched]', { state: 'attached' });
  assert.equal(await page.$('#sheetHost form'), null, 'the welcome does not reopen once this version has been seen');
  await menu('welcome');
  await page.waitForSelector('#sheetHost .welcome');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sheetHost form'));

  await page.screenshot({ path: `${OUT}/1-roster.png` });
  await page.click('.sb-athlete[data-id]');
  await page.waitForSelector('.sb-session[data-id]');
  await page.waitForSelector('#sessions tr[data-id]');
  await page.screenshot({ path: `${OUT}/shell.png` });
  await page.screenshot({ path: `${OUT}/athlete.png` });
  await page.click('.sb-session[data-id]');
  await page.waitForFunction(() => document.querySelector('#drop')?.hidden && document.querySelector('#scrub').max > 1, null, { timeout: 15000 });
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running')); // let the page crossfade settle

  // Mirror the app's geometry so we can click at frame coordinates.
  const FW = 1080, FH = 1920;
  const rect = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const full = await rect('#cvFull'), cropR = await rect('#cvCrop'), asp = cropR.w / cropR.h;
  const fs_ = Math.min(full.w / FW, full.h / FH), fox = full.x + (full.w - FW * fs_) / 2, foy = full.y + (full.h - FH * fs_) / 2;
  let crop = { cx: FW / 2, cy: FH / 2, w: FW / 3 };
  const onCrop = (x, y) => { const s = cropR.w / crop.w; return [cropR.x + cropR.w / 2 + (x - crop.cx) * s, cropR.y + cropR.h / 2 + (y - crop.cy) * s]; };

  // Move the crop box over the catcher by clicking the full frame, then widen it.
  await page.mouse.click(fox + 540 * fs_, foy + 1250 * fs_); crop = { ...crop, cx: 540, cy: 1250 };
  await page.mouse.move(fox + 540 * fs_, foy + 1250 * fs_);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); crop.w *= 1.15; await page.waitForTimeout(50); }
  await page.screenshot({ path: `${OUT}/2-crop-set.png` });

  // Draw the zone over the plate: 170 px wide = 17 in -> 10 px/in.
  const [zx1, zy1] = onCrop(455, 1110), [zx2, zy2] = onCrop(625, 1400);
  await page.mouse.move(zx1, zy1); await page.mouse.down(); await page.mouse.move((zx1 + zx2) / 2, (zy1 + zy2) / 2); await page.mouse.move(zx2, zy2); await page.mouse.up();
  // Drawing the zone moves the tool control to Target, and the Session tab shows the scale.
  await page.waitForFunction(() => document.querySelector('#tools [data-tool="target"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await page.$eval('#tools [data-tool="zone"]', e => e.getAttribute('aria-pressed')), 'false');
  assert.match(await page.$eval('#toast', e => e.textContent), /Zone set · 10\.0 px per inch/);
  await menu('inspector-session');
  await page.waitForSelector('#zonePpi', { state: 'visible' });
  assert.equal(await page.$eval('#zonePpi', e => e.textContent.trim()), '10.0 px/in');
  await menu('inspector-pitch');
  await page.waitForSelector('#types [data-t]', { state: 'visible' });
  crop = { cx: 540, cy: 1255, w: Math.min(FW, Math.max(170 * 5, 290 * 2.4 * asp)) }; // frameCatcher() after the zone is drawn

  // Tag pitches: glove target, step frames, catch. Offsets are inches (arm side +x for a RHP from behind, up = -y).
  const plan = [['FB', 2, 1], ['FB', 7, 3], ['SL', -4, -6], ['CH', 3, -2], ['FB', 0, 0.5], ['CB', -1, -9]];
  // One pitch: pick its type (if given), step 10 frames, mark the glove, step 2 frames, mark the catch.
  const tagPitch = async (type, dxIn, upIn) => {
    if (type) await page.click(`#types [data-t="${type}"]`);
    await page.keyboard.press('Shift+ArrowRight');
    const [tx, ty] = onCrop(540, 1250); await page.mouse.click(tx, ty);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    const [lx, ly] = onCrop(540 + dxIn * 10, 1250 - upIn * 10); await page.mouse.click(lx, ly);
  };
  const syncCropRect = async () => { Object.assign(cropR, await rect('#cvCrop')); }; // the catcher pane moves when the layout changes
  for (const [type, dxIn, upIn] of plan) {
    await page.click(`#types [data-t="${type}"]`);
    await syncCropRect();
    await tagPitch(null, dxIn, upIn);
    await page.waitForTimeout(150);
  }

  // The timeline shows one clip per pitch; the table lives behind the List toggle.
  await page.click('#viewToggle [data-v="timeline"]'); // the choice persists in localStorage between runs
  assert.equal(await page.$$eval('#timeline .clip', c => c.length), 6);
  await page.screenshot({ path: `${OUT}/timeline.png` });
  // A marker (no glove release before the catch) is centered on its catch, stacks above spans, and stays inside the lane.
  const mk = await page.evaluate(async () => {
    const { renderTimeline } = await import('./session/timeline.js');
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:800px;z-index:99';
    document.body.append(host);
    const P = (id, g, t) => ({ id, n: id, type: 'FB', glove: g === null ? null : { t: g }, loc: { t }, m: { score: 50 } });
    renderTimeline(host, [P(1, null, 5), P(2, 4, 6), P(3, null, 0), P(4, null, 10), P(5, 4, 6.5)], 10, { selectedId: null, onSelect() {}, onScrub() {} });
    const lane = host.querySelector('.lane').getBoundingClientRect();
    const out = [...host.querySelectorAll('.clip')].map(c => { const r = c.getBoundingClientRect(); return { id: +c.dataset.id, cx: r.left + r.width / 2 - lane.left, l: r.left - lane.left, r: r.right - lane.left, z: getComputedStyle(c).zIndex, w: r.width }; });
    host.remove(); return { out, lane: lane.width };
  });
  const byId = Object.fromEntries(mk.out.map(c => [c.id, c]));
  assert.ok(Math.abs(byId[1].cx - 400) <= 1, `marker center ${byId[1].cx}`);
  assert.ok(byId[3].l >= -0.5 && byId[4].r <= mk.lane + 0.5, 'end markers stay inside the lane');
  assert.ok(Number(byId[1].z) > (Number(byId[2].z) || 0), 'markers stack above spans');
  assert.ok(Math.abs(byId[2].l - 320) <= 1 && Math.abs(byId[2].r - 480) <= 1, 'a span keeps its clipFor extent');
  await page.click('#viewToggle [data-v="list"]');
  const rows = await page.$$eval('#log tbody tr', rs => rs.map(r => [...r.cells].map(c => c.textContent.trim()).join(' | ')));
  const expected = ['A 2.0"/U 1.0"', 'A 7.0"/U 3.0"', 'G 4.0"/D 6.0"', 'A 3.0"/D 2.0"', 'A 0.0"/U 0.5"', 'G 1.0"/D 9.0"'];
  assert.equal(rows.length, expected.length, `log rows: ${rows.join(' ; ')}`);
  // The log lists the newest pitch first; the two offsets sit in adjacent cells.
  rows.reverse().forEach((r, i) => assert.ok(r.includes(expected[i].replace('/', ' | ')), `pitch ${i + 1} row "${r}" should read ${expected[i]}`));
  await page.waitForFunction(() => document.querySelector('#bigScore').textContent.trim() === '80', null, { timeout: 3000 }).catch(() => {}); // the score counts up
  assert.equal(await page.$eval('#bigScore', e => e.textContent.trim()), '80');
  await page.screenshot({ path: `${OUT}/session.png` });
  await page.screenshot({ path: `${OUT}/3-session.png`, fullPage: true });
  await menu('inspector-session');
  await page.waitForSelector('#sN', { state: 'visible' });
  assert.equal(await page.$eval('#sN', e => e.textContent.trim()), '6');
  await page.waitForTimeout(500); // let the chart draw-in finish
  await page.screenshot({ path: `${OUT}/session-tab.png` });
  await menu('inspector-pitch');

  // Keys pressed inside an open sheet must not reach the session's shortcuts.
  const timeBefore = await page.$eval('#time', e => e.textContent);
  const openNewAthlete = async () => {
    await menu('new-athlete');
    await page.waitForSelector('#sheetHost form [data-cancel]');
  };
  await openNewAthlete();
  await page.focus('#sheetHost [data-cancel]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space'); // a focused Cancel button presses natively, closing the sheet
  assert.equal(await page.$eval('#time', e => e.textContent), timeBefore);
  assert.equal(await page.$eval('#vid', v => v.paused), true);
  await openNewAthlete();
  // Menu actions wait while a sheet is open: Delete Session doesn't replace it and Timeline/List doesn't switch.
  const viewBefore = await page.$eval('#log', e => e.hidden);
  await menu('delete-session'); await menu('toggle-list');
  await page.waitForTimeout(200);
  assert.equal(await page.$eval('#sheetTitle', e => e.textContent), 'New Athlete');
  assert.equal(await page.$eval('#log', e => e.hidden), viewBefore);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sheetHost form'));
  assert.equal(await page.$eval('#time', e => e.textContent), timeBefore);

  await page.click('.sb-athlete[data-id]');
  await page.waitForSelector('#sessions tr[data-id]');
  await page.screenshot({ path: `${OUT}/4-athlete.png`, fullPage: true });
  await page.waitForTimeout(800); // let the count-up and line draw-in finish
  await page.screenshot({ path: `${OUT}/athlete-tagged.png` });
  // The six tagged pitches are stored exactly (read back before the cases below add to and then delete the session).
  const s = JSON.parse(asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)}); const s = d.getSession(1);
    console.log(JSON.stringify({pitches:s.pitches.map(p=>({n:p.n,g:p.glove.t,l:p.loc.t}))})); d.close();`));
  assert.equal(s.pitches.length, 6);
  assert.equal(s.pitches[0].g, 0.175);
  assert.equal(s.pitches[0].l, 0.208);

  // Back to the session for the review-focus cases.
  const openSession = async id => {
    await page.click(`.sb-session[data-id="${id}"]`);
    await page.waitForFunction(() => document.querySelector('#drop')?.hidden && document.querySelector('#scrub').max > 1, null, { timeout: 15000 });
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));
  };
  await openSession(1);
  const logRows = () => page.$$eval('#log tbody tr', rs => rs.map(r => [...r.cells].map(c => c.textContent.trim())));
  const panelWidths = () => page.evaluate(() => ['#sidebar', '#inspector'].map(s => document.querySelector(s).getBoundingClientRect().width));

  // 1. Panel toggle: with both side panels closed the canvases grow; marks still land where they are clicked.
  await page.click('#types [data-t="FB"]');
  await menu('toggle-sidebar'); await menu('toggle-inspector');
  await page.waitForFunction(() => ['#sidebar', '#inspector'].every(s => document.querySelector(s).getBoundingClientRect().width === 0));
  await page.waitForTimeout(300); // the canvases resize after the panel springs close
  const panelVis = () => page.evaluate(() => ['#sidebar', '#inspector'].map(s => getComputedStyle(document.querySelector(s)).visibility));
  assert.deepEqual(await panelVis(), ['hidden', 'hidden'], 'collapsed panels leave the tab order');
  const cropBefore = cropR.w;
  await syncCropRect();
  assert.ok(cropR.w > cropBefore, `crop pane grows with the panels closed (${cropBefore} -> ${cropR.w})`);
  await tagPitch(null, 5, -1);
  await page.waitForFunction(() => document.querySelectorAll('#log tbody tr').length === 7);
  let r = await logRows();
  assert.deepEqual([r[0][0], r[0][1], r[0][4], r[0][5]], ['7', 'FB', 'A 5.0"', 'D 1.0"'], `newest row ${r[0].join(' | ')}`);
  await page.screenshot({ path: `${OUT}/panels-closed.png` });
  await menu('toggle-sidebar'); await menu('toggle-inspector');
  await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().width === 200 && document.querySelector('#inspector').getBoundingClientRect().width === 240);
  await page.waitForTimeout(300);
  assert.deepEqual(await panelWidths(), [200, 240]);
  assert.deepEqual(await panelVis(), ['visible', 'visible']);

  // 2. Rapid tagging: four pitches with no pause between clicks; none lost, duplicated or merged.
  await syncCropRect();
  const rapid = [['SL', 1, 1], ['FB', -2, 2], ['CH', 0, -3], ['FB', 4, 0]];
  for (const [type, dxIn, upIn] of rapid) await tagPitch(type, dxIn, upIn);
  await page.waitForFunction(() => document.querySelectorAll('#log tbody tr').length >= 11);
  await page.waitForTimeout(300); // a duplicate commit would land after the eleventh row
  r = await logRows();
  assert.equal(r.length, 11, `rows after rapid tagging: ${r.map(x => x[0]).join(',')}`);
  assert.deepEqual(r.slice(0, 4).map(x => x[0]), ['11', '10', '9', '8']);
  const rapidExpected = [['FB', 'A 4.0"', 'U 0.0"'], ['CH', 'A 0.0"', 'D 3.0"'], ['FB', 'G 2.0"', 'U 2.0"'], ['SL', 'A 1.0"', 'U 1.0"']];
  r.slice(0, 4).forEach((x, i) => assert.deepEqual([x[1], x[4], x[5]], rapidExpected[i], `row #${x[0]} ${x.join(' | ')}`));
  await menu('inspector-session');
  await page.waitForSelector('#sN', { state: 'visible' });
  assert.equal(await page.$eval('#sN', e => e.textContent.trim()), '11');
  await menu('inspector-pitch');
  // Faster than any hand: two whole pitches (glove, catch, glove, catch) dispatched in one task, so the
  // second glove click arrives while the first pitch is still being saved.
  const burst = [[540, 1250], [540 + 3 * 10, 1250 - 2 * 10], [540, 1250], [540 - 6 * 10, 1250 + 1 * 10]].map(([x, y]) => onCrop(x, y));
  await page.evaluate(pts => {
    const cv = document.querySelector('#cvCrop');
    for (const [x, y] of pts) for (const type of ['pointerdown', 'pointerup'])
      cv.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }));
  }, burst);
  await page.waitForFunction(() => document.querySelectorAll('#log tbody tr').length >= 13);
  await page.waitForTimeout(300);
  r = await logRows();
  assert.deepEqual(r.slice(0, 3).map(x => x[0]), ['13', '12', '11'], `rows after the burst: ${r.map(x => x[0]).join(',')}`);
  assert.deepEqual([r[1][4], r[1][5], r[0][4], r[0][5]], ['A 3.0"', 'U 2.0"', 'G 6.0"', 'D 1.0"'], `burst rows ${r[1].join(' | ')} ; ${r[0].join(' | ')}`);

  // 2b. A failed save: the next addPitch rejects once in main. The pitch is not dropped silently: a toast says so,
  // the draft comes back so clicking the catch again saves it, and nothing is left unhandled.
  await app.evaluate(({ ipcMain }) => {
    const h = ipcMain._invokeHandlers, orig = h.get('db');
    h.set('db', (e, ...args) => { if (args[0] === 'addPitch') { h.set('db', orig); return Promise.reject(new Error('disk full')); } return orig(e, ...args); });
  });
  await page.click('#types [data-t="FB"]');
  await page.keyboard.press('Shift+ArrowRight');
  await page.mouse.click(...onCrop(540, 1250));
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  const [fx, fy] = onCrop(540 + 2 * 10, 1250 - 1 * 10);
  await page.mouse.click(fx, fy);
  await page.waitForFunction(() => /Couldn.t save pitch #14/.test(document.querySelector('#toast').textContent));
  assert.equal((await logRows()).length, 13, 'the failed pitch is not in the list');
  assert.equal(await page.$eval('#tools [data-tool="catch"]', e => e.getAttribute('aria-pressed')), 'true', 'the draft is restored, waiting for the catch');
  await page.mouse.click(fx, fy);
  await page.waitForFunction(() => document.querySelectorAll('#log tbody tr').length === 14);
  r = await logRows();
  assert.deepEqual([r[0][0], r[0][1], r[0][4], r[0][5]], ['14', 'FB', 'A 2.0"', 'U 1.0"'], `retried row ${r[0].join(' | ')}`);
  assert.deepEqual(errors, [], 'no unhandled rejection from the failed save');

  // Show All Pitches: the menu checkbox follows the renderer, and the choice is kept for the next session.
  const showAllItem = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('show-all').checked);
  assert.equal(await showAllItem(), true);
  await menu('show-all');
  await page.waitForFunction(() => localStorage.getItem('bullpen.showAll') === '0');
  await page.waitForTimeout(100);
  assert.equal(await showAllItem(), false);
  await menu('show-all');
  await page.waitForFunction(() => localStorage.getItem('bullpen.showAll') === '1');
  await page.waitForTimeout(100);
  assert.equal(await showAllItem(), true);

  // Selecting a pitch seeks to the middle of its catch frame, not the rounded stored time.
  const t14 = +asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)}); console.log(d.getSession(1).pitches.find(p=>p.n===14).loc.t); d.close();`).trim();
  await page.click('#viewToggle [data-v="list"]');
  await page.click('#log tbody tr[data-id]');
  await page.waitForFunction(() => document.querySelector('#log tbody tr.sel') && !document.querySelector('#vid').seeking);
  const seekT = await page.$eval('#vid', v => v.currentTime);
  assert.ok(Math.abs(seekT * 60 - (Math.floor(t14 * 60 + 1e-6) + 0.5)) < 1e-3, `seek ${seekT} lands mid-frame for ${t14}`);
  await page.click('#log tbody tr.sel'); // deselect

  // 3. Minimum window size: the catcher view stays usable and the page itself never scrolls.
  const setWinSize = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h]);
  // The viewport is pinned by setViewportSize (a per-session emulation override), so pin it to the window's new content size.
  await setWinSize(1000, 700);
  const [cw, ch] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
  assert.deepEqual([cw, ch], [1000, 700]);
  await page.setViewportSize({ width: cw, height: ch });
  await page.waitForFunction(() => innerWidth === 1000 && innerHeight === 700);
  await page.waitForTimeout(300); // let the canvases resize
  await page.screenshot({ path: `${OUT}/min.png` });
  const min = await page.evaluate(() => ({ crop: document.querySelector('#cvCrop').getBoundingClientRect().width,
    sh: document.scrollingElement.scrollHeight, ih: innerHeight }));
  assert.ok(min.crop > 300, `#cvCrop is ${min.crop}px wide at 1000x700`);
  assert.ok(min.sh <= min.ih, `document scrolls at 1000x700 (${min.sh} > ${min.ih})`);
  // #center itself never scrolls as a page, in either the Timeline or the List view; the list scrolls inside.
  const centerFits = () => page.$eval('#center', c => [c.scrollHeight, c.clientHeight]);
  for (const v of ['list', 'timeline']) {
    await page.click(`#viewToggle [data-v="${v}"]`);
    await page.waitForTimeout(100);
    const [sh, chh] = await centerFits();
    assert.ok(sh <= chh, `#center scrolls in the ${v} view at 1000x700 (${sh} > ${chh})`);
  }
  await setWinSize(1440, 1000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => innerWidth === 1440);
  await page.waitForTimeout(300);
  for (const v of ['list', 'timeline']) {
    await page.click(`#viewToggle [data-v="${v}"]`);
    await page.waitForTimeout(100);
    const [sh, chh] = await centerFits();
    assert.ok(sh <= chh, `#center scrolls in the ${v} view at 1440x1000 (${sh} > ${chh})`);
  }

  // 4. Missing video: a session whose file is gone shows the relink prompt and stays usable.
  const MISSING = path.join(OUT, 'no-such-video.mov');
  const missingId = +asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)});
    console.log(d.createSession({athleteId:1, videoPath:${JSON.stringify(MISSING)}, title:'no-such-video.mov', fps:60, recordedOn:'2026-10-20'}).id); d.close();`).trim();
  await page.evaluate(id => { location.hash = '#/session/' + id; }, missingId);
  await page.waitForSelector('#drop', { state: 'visible' });
  assert.equal(await page.$eval('#dropTitle', e => e.textContent), "Can't open this video");
  assert.match(await page.$eval('#drop', e => e.textContent), /no-such-video\.mov/);
  await page.screenshot({ path: `${OUT}/missing-video.png` });
  await page.click('.sb-athlete[data-id="1"]');
  await page.waitForFunction(() => location.hash === '#/athlete/1' && document.querySelectorAll('#sessions tr[data-id]').length === 2);
  // A session-only menu item on the athlete page says why it did nothing.
  await menu('export-csv');
  await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Open a session first' && !document.querySelector('#toast').hidden);
  await page.click(`.sb-session[data-id="${missingId}"]`);
  await page.waitForFunction(id => location.hash === '#/session/' + id, missingId);
  await page.waitForSelector('#drop', { state: 'visible' });
  const errCount = errors.length;
  await page.click('#types [data-t="SL"]');
  await page.waitForFunction(() => document.querySelector('#types [data-t="SL"]').getAttribute('aria-pressed') === 'true');
  assert.deepEqual(errors.slice(errCount), []);

  // 5. Delete the current session: confirm the sheet with Return; the app goes to the athlete and the sidebar drops it.
  await openSession(1);
  // The Session tab's Delete Session… button asks first; Escape keeps the session.
  await menu('inspector-session');
  await page.waitForSelector('#delSession', { state: 'visible' });
  await page.click('#delSession');
  await page.waitForSelector('#sheetHost form [type=submit]');
  assert.equal(await page.$eval('#sheetTitle', e => e.textContent), 'Delete This Session?');
  assert.equal(await page.$eval('#sheetHost [type=submit]', e => e.textContent), 'Delete Session');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sheetHost form'));
  assert.equal(await page.evaluate(() => location.hash), '#/session/1');
  assert.equal(asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)}); console.log(!!d.getSession(1)); d.close();`).trim(), 'true', 'Escape keeps the session');
  // One press of Space must never confirm a destructive sheet.
  await menu('delete-session');
  await page.waitForSelector('#sheetHost form [type=submit]');
  assert.notEqual(await page.evaluate(() => document.activeElement?.matches('#sheetHost [type=submit]')), true, 'the destructive button is not focused');
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => location.hash), '#/session/1');
  assert.equal(await page.$$eval('.sb-session[data-id="1"]', e => e.length), 1, 'the session is still in the sidebar after Space');
  assert.equal(asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)}); console.log(!!d.getSession(1)); d.close();`).trim(), 'true', 'the session is still in the database after Space');
  // Space on the destructive button itself (focused by Tab or a click) does nothing either.
  if (!(await page.$('#sheetHost form'))) { await menu('delete-session'); }
  await page.waitForSelector('#sheetHost form [type=submit]');
  await page.focus('#sheetHost [type=submit]');
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => location.hash), '#/session/1');
  assert.ok(await page.$('#sheetHost form'), 'the sheet stays open after Space on Delete Session');
  assert.equal(asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)}); console.log(!!d.getSession(1)); d.close();`).trim(), 'true', 'the session survives Space on the destructive button');
  await page.waitForSelector('#sheetHost form [type=submit]');
  await page.keyboard.press('Enter');
  // The hash changes before the route redraws the sidebar and mounts the athlete page, so wait for all three.
  await page.waitForFunction(id => location.hash === '#/athlete/1' && !document.querySelector('.sb-session[data-id="1"]')
    && document.querySelector(`.sb-session[data-id="${id}"]`) && document.querySelectorAll('#sessions tr[data-id]').length === 1, missingId);
  assert.equal(await page.evaluate(() => location.hash), '#/athlete/1');
  assert.equal(await page.$$eval('.sb-session[data-id="1"]', e => e.length), 0);
  assert.equal(await page.$$eval('#sessions tr[data-id]', e => e.length), 1);
  assert.deepEqual(errors, []);
} finally {
  await app.close();
}

// 6. Reduced motion: relaunch, ask for reduced motion, tag one pitch; nothing may be animating after the catch.
const rmId = +asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)});
  const s = d.createSession({athleteId:1, videoPath:${JSON.stringify(VIDEO)}, title:'test_hevc.mov', fps:60, recordedOn:'2026-10-28'});
  d.updateSession(s.id, {frameW:1080, frameH:1920, zone:{x:455, y:1110, w:170, h:290}, crop:{cx:540, cy:1255, w:900}});
  console.log(s.id); d.close();`).trim();
const app2 = await electron.launch({ executablePath: electronBin, args: [APP], env: { ...process.env, BULLPEN_DB: DB, BULLPEN_USER_DATA: PROFILE } });
try {
  const page = await app2.firstWindow();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForSelector('.sb-athlete[data-id]');
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  await page.evaluate(id => { location.hash = '#/session/' + id; }, rmId);
  await page.waitForFunction(() => document.querySelector('#drop')?.hidden && document.querySelector('#scrub').max > 1, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'no animations after opening the session');
  const cropR = await page.$eval('#cvCrop', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const crop = { cx: 540, cy: 1255, w: 900 };
  const onCrop = (x, y) => { const s = cropR.w / crop.w; return [cropR.x + cropR.w / 2 + (x - crop.cx) * s, cropR.y + cropR.h / 2 + (y - crop.cy) * s]; };
  await page.keyboard.press('Shift+ArrowRight');
  await page.mouse.click(...onCrop(540, 1250));
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.mouse.click(...onCrop(560, 1240));
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'no animations right after the catch click');
  await page.waitForFunction(() => document.querySelectorAll('#log tbody tr, #timeline .clip').length > 0);
  const anims = await page.evaluate(() => document.getAnimations().map(a => a.animationName || a.transitionProperty || a.constructor.name));
  assert.deepEqual(anims, [], 'no animations once the pitch is drawn');
  await menu2(app2, 'inspector-session');
  await page.waitForSelector('#sN', { state: 'visible' });
  assert.equal(await page.$eval('#sN', e => e.textContent.trim()), '1');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'no animations on the Session tab');
  assert.deepEqual(errors, []);
} finally {
  await app2.close();
}
console.log('E2E PASS');
