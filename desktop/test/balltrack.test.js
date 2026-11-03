import test from 'node:test';
import assert from 'node:assert/strict';
import { blur, estimateShift, candidates, findFlight, fitPath, pathUpTo, workScale } from '../renderer/balltrack.js';

const W = 540, H = 960;

// A synthetic bullpen: a textured dark background, a ball that flies from near the camera to the catch while
// shrinking, a big bright "body" that moves too, and hand-held shake. Returns blurred grey frames.
function scene(n, {shake = true, distractor = true} = {}){
  let seed = 7; const rnd = () => (seed = (seed*16807) % 2147483647)/2147483647;
  const bg = new Uint8Array((W + 20)*(H + 20));
  for(let i = 0; i < bg.length; i++) bg[i] = 40 + Math.floor(rnd()*30);
  const ball = k => ({x: 420 - 6*k + 0.08*k*k, y: 300 + 9*k - 0.06*k*k, r: Math.max(2.5, 9 - 0.25*k)}); // decelerating, shrinking
  const frames = [], shifts = [];
  for(let k = 0; k < n; k++){
    const [ox, oy] = shake ? [Math.round(rnd()*4) - 2, Math.round(rnd()*4) - 2] : [0, 0];
    shifts.push([ox, oy]);
    const f = new Uint8Array(W*H);
    for(let y = 0; y < H; y++) for(let x = 0; x < W; x++) f[y*W + x] = bg[(y + 10 + oy)*(W + 20) + x + 10 + ox];
    const disk = (cx, cy, r, v) => { for(let y = Math.floor(cy - r); y <= cy + r; y++) for(let x = Math.floor(cx - r); x <= cx + r; x++)
      if(x >= 0 && y >= 0 && x < W && y < H && (x - cx)**2 + (y - cy)**2 <= r*r) f[y*W + x] = v; };
    if(distractor) for(let y = 620; y < 900; y++) for(let x = 60 + 4*k; x < 200 + 4*k; x++) f[y*W + x] = 200; // a moving body
    const b = ball(k); disk(b.x - ox, b.y - oy, b.r, 230);
    frames.push(blur(f, W, H));
  }
  // Where the ball appears in frame k: the camera's shake moves it like everything else.
  const seen = k => { const b = ball(k), [ox, oy] = shifts[Math.round(k)] ?? [0, 0]; return {...b, x: b.x - ox, y: b.y - oy}; };
  return {frames, ball: seen, shifts};
}

function track(frames){
  const cands = [], times = frames.map((_, k) => k/60);
  const s = frames.slice(0, -1).map((f, k) => estimateShift(f, frames[k+1], W, H));
  for(let k = 1; k + 1 < frames.length; k++){
    const sp = s[k-1].map(v => -v), sn = s[k];
    cands[k] = candidates(frames[k-1], frames[k], frames[k+1], W, H, sp, sn);
  }
  return {cands, times};
}

test('workScale keeps the long side at 1920 or less', () => {
  assert.equal(workScale(2160, 3840), 0.5);
  assert.equal(workScale(1080, 1920), 1);
  assert.equal(workScale(640, 480), 1);
});

test('estimateShift finds hand-held shake', () => {
  const {frames, shifts} = scene(3, {distractor: false});
  const [dx, dy] = estimateShift(frames[0], frames[1], W, H);
  assert.deepEqual([dx, dy], [shifts[0][0] - shifts[1][0], shifts[0][1] - shifts[1][1]]); // src(x + dx) matches ref(x)
});

test('candidates include the ball but not the moving body', () => {
  const {frames, ball} = scene(12);
  const {cands} = track(frames);
  for(let k = 1; k < 11; k++){
    const b = ball(k);
    // Within a few px: where the ball overlaps itself between samples, only its leading part is brighter than both.
    assert.ok(cands[k].some(c => Math.hypot(c.x - b.x, c.y - b.y) < 3), `sample ${k}: ball at ${b.x.toFixed(0)},${b.y.toFixed(0)} not in ${JSON.stringify(cands[k])}`);
    assert.ok(cands[k].every(c => !(c.y > 640 && c.y < 880)), `sample ${k}: the inside of the body is a candidate`);
  }
});

test('findFlight follows the ball to the catch and fitPath ends on the mark', () => {
  const n = 30, {frames, ball} = scene(n);
  const {cands, times} = track(frames);
  const end = ball(n - 2), catchPt = {x: end.x + 3, y: end.y + 2, t: times[n - 2]};
  const flight = findFlight(cands, times, catchPt);
  assert.ok(flight, 'flight found');
  assert.ok(flight.length >= 20, `flight has ${flight.length} points`);
  for(const p of flight){ const b = ball(p.k); assert.ok(Math.hypot(p.x - b.x, p.y - b.y) < 3, `point ${p.k} off the ball`); }
  const path = fitPath(flight.map(p => ({t: times[p.k], x: p.x, y: p.y})), catchPt);
  assert.deepEqual(path.at(-1), [catchPt.t, catchPt.x, catchPt.y]);
  for(const [t, x, y] of path.slice(0, -3)){ const b = ball(t*60); assert.ok(Math.hypot(x - b.x, y - b.y) < 5, `curve at ${t.toFixed(3)}s is off the ball`); }
});

test('findFlight rejects a flight that ends away from the catch, or at another time', () => {
  const n = 30, {frames, ball} = scene(n);
  const {cands, times} = track(frames);
  const end = ball(n - 2);
  assert.equal(findFlight(cands, times, {x: end.x + 300, y: end.y, t: times[n - 2]}), null);
  assert.equal(findFlight(cands, times, {x: end.x, y: end.y, t: times[n - 2] + 1}), null);
});

test('pathUpTo trims the path to the playhead', () => {
  const pts = [[1, 0, 0], [1.1, 10, 0], [1.2, 20, 10]];
  assert.deepEqual(pathUpTo(pts, 0.9), []);
  assert.deepEqual(pathUpTo(pts, 1.15).map(p => p.map(v => +v.toFixed(6))), [[1, 0, 0], [1.1, 10, 0], [1.15, 15, 5]]);
  assert.deepEqual(pathUpTo(pts, 2), pts);
});
