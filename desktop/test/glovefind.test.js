import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCrop, bestMitt, findShow, CROP_ZONES, START_S, STEP_S, MAX_BACK_S } from '../renderer/glovefind.js';

const zone = {x: 880, y: 2150, w: 110, h: 160};      // a 4K portrait bullpen: zone centre (935, 2230)
const crop = modelCrop(zone, 2160, 3840);
// A box at frame point (x, y) as the detector reports it: a fraction of the crop.
const box = (x, y, score = 0.4) => ({x: (x - crop.x)/crop.s, y: (y - crop.y)/crop.s, w: 0.05, h: 0.05, score});
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

// A fake detector over a scripted pitch: `at(t)` gives the mitt's frame point (or null) at time t. Records the
// times it was asked for.
function scripted(at){
  const asked = [];
  const detectAt = async t => { asked.push(t); const p = at(t); return p ? [box(p[0], p[1], p[2])] : []; };
  return {detectAt, asked};
}
// The Mundy clip's pitch 1, roughly: shown at the chest 10.5 to 12.4, a few frames of the glove closing, resting at
// the knee through the delivery (a short still spell 13.2 to 13.5), then up to the ball at the 14.08 catch.
function pitch1(t){
  if(t < 10.5) return [922, 2243];
  if(t < 12.45) return [895 + (t*7 % 1), 2220 + (t*13 % 2)];
  if(t < 13.1) return t < 12.7 ? [905, 2157, 0.13] : null;  // closing: weak or no boxes
  if(t < 13.55) return [907, 2298];
  return [905 + (t - 13.55)*80, 2290 - (t - 13.55)*70];
}

test('the model crop is a square on the zone, kept inside the frame', () => {
  assert.deepEqual(crop, {x: 935 - CROP_ZONES*110/2, y: 2230 - CROP_ZONES*110/2, s: CROP_ZONES*110});
  const edge = modelCrop({x: 10, y: 10, w: 110, h: 160}, 1920, 1080);
  assert.equal(edge.x, 0); assert.equal(edge.y, 0);
  assert.equal(modelCrop({x: 10, y: 10, w: 400, h: 160}, 1920, 1080).s, 1080); // never larger than the frame
});

test('bestMitt takes the strongest box near the zone, ignoring weak ones and other gloves', () => {
  const far = box(935 + 3*110, 2230, .9);
  assert.equal(bestMitt([far, box(930, 2290, .1)], crop, zone), null);
  const b = bestMitt([far, box(930, 2290, .5), box(940, 2280, .3)], crop, zone);
  near(b.x, 930); near(b.y, 2290); near(b.score, .5);
});

test('the target is the shown glove, not where it rests in the delivery', async () => {
  const {detectAt, asked} = scripted(pitch1);
  const p = await findShow(14.082, zone, crop, detectAt);
  assert.ok(Math.abs(p.x - 895.5) < 1 && Math.abs(p.y - 2221) < 1.5, `${p.x}, ${p.y}`);
  assert.ok(p.t > 12 && p.t < 12.45, `shown until ${p.t}`); // the last moment before the glove closes
  near(asked[0], 14.082 - START_S, 1e-3);
  assert.ok(asked.every((t, i) => !i || Math.abs(asked[i-1] - t - STEP_S) < 1e-3), 'steps back evenly');
  assert.ok(asked.at(-1) > 11, 'stops once the hold is long enough'); // it needn't read back to the start of the show
});

test('a hold survives one lost or stray frame', async () => {
  const show = t => Math.abs(t - 11.582) < 0.05 ? null : Math.abs(t - 11.182) < 0.05 ? [990, 2150, .9] : pitch1(t);
  const p = await findShow(14.082, zone, crop, scripted(show).detectAt);
  assert.ok(Math.abs(p.x - 895.5) < 1, `${p.x}`);
});

test('no proposal when the glove never holds still long enough', async () => {
  const restless = t => [880 + (t*97 % 1)*60, 2200 + (t*53 % 1)*60];
  const {detectAt, asked} = scripted(restless);
  assert.equal(await findShow(14, zone, crop, detectAt), null);
  assert.ok(asked.at(-1) >= 14 - MAX_BACK_S - 1e-9, 'gives up after MAX_BACK_S');
  assert.equal(await findShow(14, zone, crop, scripted(() => null).detectAt), null);
});

test('a catch near the start of the video never samples before it', async () => {
  const {detectAt, asked} = scripted(() => [900, 2220]);
  const p = await findShow(1.6, zone, crop, detectAt);
  assert.ok(asked.every(t => t >= 0));
  assert.ok(p, 'the 0.6 s held before the catch is enough');
  assert.equal(await findShow(0.3, zone, crop, scripted(() => [900, 2220]).detectAt), null);
});
