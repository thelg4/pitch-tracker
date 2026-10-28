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
const asNode = code => execFileSync(electronBin, ['--input-type=module', '-e', code], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: APP }).toString();

asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)});
  const a = d.createAthlete({name:'Test Pitcher', throws:'R', level:'College'});
  d.createSession({athleteId:a.id, videoPath:${JSON.stringify(VIDEO)}, title:'test_hevc.mov', fps:60, recordedOn:'2026-10-27'}); d.close();`);

const app = await electron.launch({ executablePath: electronBin, args: [APP], env: { ...process.env, BULLPEN_DB: DB } });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.waitForSelector('.sb-athlete[data-id]');
  await page.screenshot({ path: `${OUT}/1-roster.png` });
  await page.click('.sb-athlete[data-id]');
  await page.waitForSelector('.sb-session[data-id]');
  await page.waitForSelector('#sessions tr[data-id]');
  await page.screenshot({ path: `${OUT}/shell.png` });
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
  await page.waitForFunction(() => document.querySelector('#stZone span')?.textContent.includes('px/in'));
  assert.match(await page.$eval('#stZone span', e => e.textContent), /10\.0 px\/in/);
  crop = { cx: 540, cy: 1255, w: Math.min(FW, Math.max(170 * 5, 290 * 2.4 * asp)) }; // frameCatcher() after the zone is drawn

  // Tag pitches: glove target, step frames, catch. Offsets are inches (arm side +x for a RHP from behind, up = -y).
  const plan = [['FB', 2, 1], ['FB', 7, 3], ['SL', -4, -6], ['CH', 3, -2], ['FB', 0, 0.5], ['CB', -1, -9]];
  for (const [type, dxIn, upIn] of plan) {
    await page.click(`#types [data-t="${type}"]`);
    await page.evaluate(() => document.querySelector('#center').scrollTo(0, 0)); Object.assign(cropR, await rect('#cvCrop'));
    await page.keyboard.press('Shift+ArrowRight');
    const [tx, ty] = onCrop(540, 1250); await page.mouse.click(tx, ty);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    const [lx, ly] = onCrop(540 + dxIn * 10, 1250 - upIn * 10); await page.mouse.click(lx, ly);
    await page.waitForTimeout(150);
  }

  const rows = await page.$$eval('#log tbody tr', rs => rs.map(r => [...r.cells].map(c => c.textContent.trim()).join(' | ')));
  const expected = ['A 2.0"/U 1.0"', 'A 7.0"/U 3.0"', 'G 4.0"/D 6.0"', 'A 3.0"/D 2.0"', 'A 0.0"/U 0.5"', 'G 1.0"/D 9.0"'];
  assert.equal(rows.length, expected.length, `log rows: ${rows.join(' ; ')}`);
  // The log lists the newest pitch first; the two offsets sit in adjacent cells.
  rows.reverse().forEach((r, i) => assert.ok(r.includes(expected[i].replace('/', ' | ')), `pitch ${i + 1} row "${r}" should read ${expected[i]}`));
  assert.equal(await page.$eval('#bigScore', e => e.textContent.trim()), '80');
  assert.equal(await page.$eval('#sN', e => e.textContent.trim()), '6');
  await page.screenshot({ path: `${OUT}/3-session.png`, fullPage: true });

  // Keys pressed inside an open sheet must not reach the session's shortcuts.
  const timeBefore = await page.$eval('#time', e => e.textContent);
  const openNewAthlete = async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-athlete'));
    await page.waitForSelector('#sheetHost form [data-cancel]');
  };
  await openNewAthlete();
  await page.focus('#sheetHost [data-cancel]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space'); // a focused Cancel button presses natively, closing the sheet
  assert.equal(await page.$eval('#time', e => e.textContent), timeBefore);
  assert.equal(await page.$eval('#vid', v => v.paused), true);
  await openNewAthlete();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sheetHost form'));
  assert.equal(await page.$eval('#time', e => e.textContent), timeBefore);

  await page.click('.sb-athlete[data-id]');
  await page.waitForSelector('#sessions tr[data-id]');
  await page.screenshot({ path: `${OUT}/4-athlete.png`, fullPage: true });
  assert.deepEqual(errors, []);
} finally {
  await app.close();
}

const s = JSON.parse(asNode(`import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)}); const s = d.getSession(1);
  console.log(JSON.stringify({pitches:s.pitches.map(p=>({n:p.n,g:p.glove.t,l:p.loc.t}))}));`));
assert.equal(s.pitches.length, 6);
assert.equal(s.pitches[0].g, 0.175);
assert.equal(s.pitches[0].l, 0.208);
console.log('E2E PASS');
