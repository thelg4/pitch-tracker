// Smoke test for the packaged app: run `npm run dist:mac` first. Launches the built arm64 app with a seeded
// database, opens the session, and checks that the video loads and the inspector renders.
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
const DB = path.join(OUT, 'packaged.db'), VIDEO = path.join(OUT, 'test_hevc.mov');
const BIN = path.join(APP, 'dist/mac-arm64/Bullpen Command.app/Contents/MacOS/Bullpen Command');
const electronBin = createRequire(path.join(APP, 'package.json'))('electron');

if (!fs.existsSync(BIN)) { console.error(`No packaged app at ${BIN}. Run \`npm run dist:mac\` first.`); process.exit(1); }
execFileSync(path.join(HERE, 'make-clip.sh'), { stdio: 'inherit' });
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
const PROFILE = path.join(OUT, 'packaged-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
execFileSync(electronBin, ['--input-type=module', '-e', `import {openDb} from './db.js'; const d = openDb(${JSON.stringify(DB)});
  const a = d.createAthlete({name:'Test Pitcher', throws:'R', level:'College'});
  d.createSession({athleteId:a.id, videoPath:${JSON.stringify(VIDEO)}, title:'test_hevc.mov', fps:60, recordedOn:'2026-10-27'}); d.close();`],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: APP });

const app = await electron.launch({ executablePath: BIN, env: { ...process.env, BULLPEN_DB: DB, BULLPEN_USER_DATA: PROFILE } });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  // A fresh profile is a first launch: the welcome opens, showing the packaged version; close it.
  await page.waitForSelector('#sheetHost .welcome');
  assert.match(await page.$eval('#sheetHost .wver', e => e.textContent), /Version 0\.2\.\d+/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#sheetHost form'));
  await page.click('.sb-athlete[data-id]');
  await page.click('.sb-session[data-id]');
  await page.waitForFunction(() => document.querySelector('#drop')?.hidden && document.querySelector('#scrub').max > 1, null, { timeout: 15000 });
  await page.waitForSelector('#bigScore', { state: 'visible' });
  // The first frame is drawn into the full-frame canvas (the clip's green field, dimmed outside the crop box).
  await page.waitForFunction(() => { const c = document.querySelector('#cvFull'), [r, g] = c.getContext('2d').getImageData(c.width / 2, c.height / 4, 1, 1).data; return g > r + 8; }, null, { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/packaged.png` });
  assert.deepEqual(errors, []);
} finally {
  await app.close();
}
console.log('PACKAGED PASS');
