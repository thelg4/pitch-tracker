import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCrop, sampleTimes, proposeTarget, RELEASE_S, SAMPLES, CROP_ZONES } from '../renderer/glovefind.js';

const zone = {x: 880, y: 2150, w: 110, h: 160};      // a 4K portrait bullpen: zone centre (935, 2230)
const crop = modelCrop(zone, 2160, 3840);
// A box at frame point (x, y) as the detector reports it: a fraction of the crop.
const box = (x, y, score) => ({x: (x - crop.x)/crop.s, y: (y - crop.y)/crop.s, w: 0.05, h: 0.05, score});

test('the model crop is a square on the zone, kept inside the frame', () => {
  assert.deepEqual(crop, {x: 935 - CROP_ZONES*110/2, y: 2230 - CROP_ZONES*110/2, s: CROP_ZONES*110});
  const edge = modelCrop({x: 10, y: 10, w: 110, h: 160}, 1920, 1080);
  assert.equal(edge.x, 0); assert.equal(edge.y, 0);
  assert.equal(modelCrop({x: 10, y: 10, w: 400, h: 160}, 1920, 1080).s, 1080); // never larger than the frame
});

test('samples spread across the release window and never start before the video', () => {
  const ts = sampleTimes(14);
  assert.equal(ts.length, SAMPLES);
  assert.ok(Math.abs(ts[0] - (14 - RELEASE_S[0])) < 1e-9 && Math.abs(ts.at(-1) - (14 - RELEASE_S[1])) < 1e-9);
  assert.ok(sampleTimes(0.2).every(t => t >= 0));
});

test('the proposal is the median mitt across samples, timed at the sample nearest it', () => {
  const samples = [[13.3, 909, 2296, .47], [13.4, 910, 2293, .43], [13.5, 914, 2295, .32], [13.6, 905, 2285, .70]]
    .map(([t, x, y, s]) => ({t, boxes: [box(x, y, s)]}));
  const p = proposeTarget(samples, crop, zone);
  assert.ok(Math.abs(p.x - 909.5) < 1e-6 && Math.abs(p.y - 2294) < 1e-6, `${p.x}, ${p.y}`);
  assert.equal(p.t, 13.4); // (910, 2293) is nearest the median
  assert.ok(Math.abs(p.score - 0.45) < 1e-6);
});

test('a frame where the model fires elsewhere is outvoted', () => {
  const samples = [{t: 1, boxes: [box(930, 2290, .6)]}, {t: 2, boxes: [box(935, 2292, .5)]},
    {t: 3, boxes: [box(990, 2150, .9)]}, {t: 4, boxes: [box(928, 2288, .4)]}];
  const p = proposeTarget(samples, crop, zone);
  assert.ok(Math.abs(p.x - 930) < 1e-6 && Math.abs(p.y - 2290) < 1e-6, `${p.x}, ${p.y}`);
});

test('weak boxes and mitts far from the zone do not count', () => {
  const far = box(935 + 3*110, 2230, .9), weak = box(930, 2290, .1);
  assert.equal(proposeTarget([{t: 1, boxes: [far, weak]}, {t: 2, boxes: [far]}, {t: 3, boxes: [weak]}], crop, zone), null);
  // The best box that does count wins, even when a stronger one is out of reach.
  const p = proposeTarget([{t: 1, boxes: [far, box(930, 2290, .5)]}, {t: 2, boxes: [box(932, 2290, .5)]}], crop, zone);
  assert.ok(Math.abs(p.x - 931) < 1e-6);
});

test('one sighting, or sightings that disagree, give no proposal', () => {
  assert.equal(proposeTarget([{t: 1, boxes: [box(930, 2290, .8)]}, {t: 2, boxes: []}], crop, zone), null);
  assert.equal(proposeTarget([{t: 1, boxes: [box(880, 2200, .8)]}, {t: 2, boxes: [box(990, 2300, .8)]}], crop, zone), null);
});
