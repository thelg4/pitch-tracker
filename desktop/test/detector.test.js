import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toInput, decode, createDetector } from '../detector.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);
const logit = p => Math.log(p/(1 - p));

test('toInput makes planar RGB, scaled and normalized', () => {
  const rgba = new Uint8Array([255, 0, 51, 255,  0, 255, 102, 255,  0, 0, 0, 255,  255, 255, 255, 0]); // 2 × 2
  const x = toInput(rgba, 2, [0.5, 0.5, 0.5], [0.5, 0.25, 0.5]);
  assert.equal(x.length, 12);
  assert.deepEqual([...x.slice(0, 4)], [1, -1, -1, 1]);       // red plane
  assert.deepEqual([...x.slice(4, 8)], [-2, 2, -2, 2]);       // green plane, with its own std
  near(x[8], (51/255 - 0.5)/0.5); near(x[9], (102/255 - 0.5)/0.5);
});

test('decode keeps real classes above the threshold, best first, and ignores the placeholder class', () => {
  const dets = new Float32Array([0.5, 0.5, 0.1, 0.1,  0.2, 0.3, 0.05, 0.04,  0.9, 0.9, 0.1, 0.1]);
  // Query 2 is sure of class 0 (Roboflow's placeholder superclass) only, so it is not a detection.
  const logits = new Float32Array([logit(.01), logit(.4),  logit(.01), logit(.8),  logit(.99), logit(.05)]);
  const out = decode(dets, logits, 2, ['_', 'mitt']);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(b => b.label), ['mitt', 'mitt']);
  near(out[0].score, .8); near(out[0].x, 0.2); near(out[0].w, 0.05);
  near(out[1].score, .4);
  assert.equal(decode(dets, logits, 2, ['_', 'mitt'], 0.5).length, 1);
});

test('without a model file the detector says it is unavailable', () => {
  assert.deepEqual(createDetector('/nope/mitt.onnx').info(), {available: false});
});

const MODEL = fileURLToPath(new URL('../models/mitt.onnx', import.meta.url));
test('the installed model runs on a crop at its input size', {skip: !fs.existsSync(MODEL) && 'no model in desktop/models'}, async () => {
  const d = createDetector(MODEL), {available, input, labels} = d.info();
  assert.ok(available); assert.deepEqual(labels, ['mitt']);
  const boxes = await d.detect(new Uint8Array(input*input*4).fill(128), input);
  assert.ok(Array.isArray(boxes) && boxes.every(b => b.score >= 0.15 && b.label === 'mitt'));
  await assert.rejects(d.detect(new Uint8Array(64*64*4), 64), /takes 512px/);
});
