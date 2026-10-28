import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metrics, scored, summary, grade, insights, heatCells } from '../renderer/scoring.js';

// 170 px zone → 10 px per inch. Target in the middle of the zone.
const zone = {x: 0, y: 0, w: 170, h: 230};
const target = {x: 85, y: 115, t: 1};
const pitch = (dx, dy, extra = {}) => ({id: 1, n: 1, type: 'FB', glove: target, manual: null, loc: {x: 85 + dx*10, y: 115 - dy*10, t: 2}, zone, ...extra});
const RHP = {hand: 'R', view: 'pitcher', hitR: 6};

test('a 6" miss scores 75 with the default radius, as the README documents', () => {
  const m = metrics(pitch(6, 0), RHP);
  assert.equal(m.d, 6); assert.equal(m.score, 75); assert.equal(m.hit, true);
});

test('score is 100 inside a third of the radius and 0 at three times it', () => {
  assert.equal(metrics(pitch(2, 0), RHP).score, 100);
  assert.equal(metrics(pitch(18, 0), RHP).score, 0);
  assert.equal(metrics(pitch(30, 0), RHP).score, 0);
});

test('arm side flips with handedness and camera view', () => {
  assert.equal(metrics(pitch(6, 0), RHP).arm, 6);
  assert.equal(metrics(pitch(6, 0), {...RHP, hand: 'L'}).arm, -6);
  assert.equal(metrics(pitch(6, 0), {...RHP, view: 'catcher'}).arm, -6);
});

test('up is positive above the target and direction labels follow', () => {
  const m = metrics(pitch(0, 10), RHP);
  assert.equal(m.up, 10); assert.equal(m.dir, 'Up');
  assert.equal(metrics(pitch(-8, -8), RHP).dir, 'Down & glove side');
  assert.equal(metrics(pitch(1, 1), RHP).dir, 'On target');
});

test('a manual target is scored instead of the glove and the setup offset is reported', () => {
  const m = metrics(pitch(0, 0, {manual: {x: 85 + 50, y: 115, t: 1}}), RHP);
  assert.equal(m.d, 5); assert.equal(m.setupOff, 5);
});

test('summary, grade and insights over a session', () => {
  const list = scored([0, 3, 6, 9, 12].map((d, i) => ({...pitch(d, 0), id: i + 1, n: i + 1})), RHP);
  const s = summary(list);
  assert.equal(s.n, 5); assert.equal(s.d, 6); assert.equal(s.hit, 0.6);
  assert.equal(grade(100), 80); assert.equal(grade(0), 20); assert.equal(grade(75), 65);
  assert.ok(insights(list)[0][0].includes('arm side'));
});

test('heat cells bucket targets into zone thirds from the pitcher view', () => {
  const p = pitch(0, 0, {glove: {x: 10, y: 10, t: 0}}); // top-left third = glove side for a RHP seen from behind
  const cells = heatCells([metrics(p, RHP)]);
  assert.equal(cells.find(c => c.n).label, 'up glove side');
});
