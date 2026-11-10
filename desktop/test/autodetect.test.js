import test from 'node:test';
import assert from 'node:assert/strict';
import { findHolds, ballWindow, towardCatcher, targetFor, catchFor, TRACK_HZ, WINDOW_S } from '../renderer/autodetect.js';

const zone = {x: 880, y: 2150, w: 110, h: 160};
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);
// A mitt track sampled at TRACK_HZ from `at(t)` -> [x, y] or null.
const track = (t0, t1, at) => { const out = []; for(let k = Math.round(t0*TRACK_HZ); k <= Math.round(t1*TRACK_HZ); k++){ const t = k/TRACK_HZ, p = at(t); out.push(p && {t, x: p[0], y: p[1], score: 0.4}); } return out; };
// The Mundy clip's first pitch, roughly: shown at the chest 10.5 to 12.4, down to the knee, caught at 14.0.
const pitch = t => t < 10.5 ? [922, 2243] : t < 12.45 ? [895, 2220] : t < 13.0 ? null : t < 13.8 ? [907, 2298] : [946, 2255];

test('holds are the stretches where the mitt stays put long enough', () => {
  const holds = findHolds(track(9, 15, pitch), zone);
  // 9.0-10.4 before the show is a hold too (the catcher waiting); the knee rest 13.0-13.7 is too short.
  assert.deepEqual(holds.map(h => [h.t0, h.t1]), [[9, 10.4], [10.5, 12.4], [13.8, 15]]);
  near(holds[1].x, 895); near(holds[1].y, 2220);
});

test('a hold carries on through one lost frame but not two', () => {
  const one = t => Math.abs(t - 11.5) < 0.01 ? null : pitch(t);
  assert.ok(findHolds(track(10.5, 12.4, one), zone).some(h => h.t0 === 10.5 && h.t1 === 12.4));
  const two = t => t > 11.45 && t < 11.65 ? null : pitch(t);
  assert.deepEqual(findHolds(track(10.5, 12.4, two), zone).map(h => [h.t0, h.t1]), [[10.5, 11.4]]); // 11.7-12.4 is too short
});

test('a hold follows the mitt when the model flickers to another box', () => {
  // The best box jumps to something else (his hand, his mask) for two samples running; the mitt is still a candidate.
  const flicker = track(116.7, 117.6, t => [957, 2215]).map(p => p.t > 116.75 && p.t < 116.95 ? {...p, x: 1040, y: 2204, alts: [{x: 957, y: 2215, score: 0.2}]} : p);
  assert.deepEqual(findHolds(flicker, zone).map(h => [h.t0, h.t1, h.x]), [[116.7, 117.6, 957]]);
});

test('the ball window follows the show and stops at the end of the video', () => {
  assert.deepEqual(ballWindow({t1: 12.4}, 100), {t0: 12.4 + WINDOW_S[0], t1: 12.4 + WINDOW_S[1]});
  assert.equal(ballWindow({t1: 98}, 100).t1, 100);
});

test('towardCatcher keeps a pitch and drops the throw back', () => {
  const ok = towardCatcher({x: 500, y: 1100}, 55);
  const pitchChain = [{x: 200, y: 700, area: 40}, {x: 300, y: 850, area: 30}, {x: 400, y: 980, area: 20}, {x: 480, y: 1080, area: 12}];
  assert.equal(ok(pitchChain), true);
  assert.equal(ok([...pitchChain].reverse()), false);                                  // heading away and growing
  assert.equal(ok(pitchChain.map(c => ({...c, area: 60 - c.area}))), false);         // heading in but growing
  assert.equal(ok([{x: 470, y: 1060, area: 9}, {x: 480, y: 1070, area: 8}, {x: 490, y: 1085, area: 8}]), false); // barely moves
});

test('the target is the last show before the flight, if it is recent', () => {
  const holds = [{t1: 9}, {t1: 12.4}, {t1: 13.2}];
  assert.equal(targetFor(13.5, holds).t1, 13.2);
  assert.equal(targetFor(13.0, holds).t1, 12.4);
  assert.equal(targetFor(20, holds), null);
});

test('the catch is the mitt where the ball arrives, just after its last sighting', () => {
  const pts = [{t: 13.7, x: 860, y: 2180}, {t: 13.8, x: 890, y: 2210}, {t: 13.9, x: 915, y: 2232}, {t: 13.96, x: 925, y: 2240}];
  // The mitt rests at the knee as the ball is last seen, rises through its path, and has it at 14.1 (0.15 s on).
  const mitt = track(13.5, 14.5, t => t < 13.75 ? [907, 2298] : t < 13.85 ? [905, 2252] : t < 13.95 ? [913, 2255] : [944, 2259]);
  const c = catchFor(pts, mitt, zone);
  assert.equal(c.t, 14.1); near(c.x, 944); near(c.y, 2259);
  // If the model fired elsewhere at that moment, an alternative box on the path is the mitt.
  const alt = mitt.map(p => p.t === 14.1 ? {...p, x: 1050, y: 2205, alts: [{x: 944, y: 2259, score: 0.2}]} : p);
  near(catchFor(pts, alt, zone).x, 944);
  // A ball-like streak ending at a glove that was already sitting there (a show) is not a catch.
  const show = track(10.5, 12.4, () => [935, 2245]), late = pts.map(p => ({...p, t: p.t - 2.5}));
  assert.equal(catchFor(late, show, zone, findHolds(show, zone)), null);
  // With the mitt nowhere near the ball, there's no catch.
  assert.equal(catchFor(pts, track(13.5, 14.5, () => [700, 2400]), zone), null);
  // Close but not on the path still counts, as the nearest.
  assert.equal(catchFor(pts, track(13.5, 14.5, () => [930, 2320]), zone).y, 2320);
});
