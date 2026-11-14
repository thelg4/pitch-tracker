import test from 'node:test';
import assert from 'node:assert/strict';
import { blur, estimateShift, candidates, findFlight, fitPath, pathUpTo, workScale, PATH_FIT, needsTrace } from '../renderer/balltrack.js';

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

test('findFlight skips flights its accept test rules out', () => {
  const n = 30, {frames, ball} = scene(n);
  const {cands, times} = track(frames);
  const end = ball(n - 2), catchPt = {x: end.x + 3, y: end.y + 2, t: times[n - 2]};
  const seen = [];
  assert.ok(findFlight(cands, times, catchPt, {accept: ch => { seen.push(ch.length); return true; }}));
  assert.ok(seen.length > 0, 'accept was asked');
  assert.equal(findFlight(cands, times, catchPt, {accept: () => false}), null);
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
  const [te, xe, ye] = path.at(-1);
  assert.deepEqual([xe, ye], [catchPt.x, catchPt.y]);
  assert.ok(te <= catchPt.t, `path ends at ${te}, after the catch at ${catchPt.t}`);
  for(const [t, x, y] of path.slice(0, -3)){ const b = ball(t*60); assert.ok(Math.hypot(x - b.x, y - b.y) < 5, `curve at ${t.toFixed(3)}s is off the ball`); }
});

// A pitch filmed from behind the pitcher: a 3D parabola (gravity on Y) whose depth grows steadily, seen through a
// pinhole camera. On screen it slows down sharply as it nears the catcher, which a polynomial in time can't follow.
// `late` tags the catch that long after the ball arrives (a mitt sampled 10 times a second, or a click on a frame
// where the ball is plainly in the glove).
// `mark` moves the catch mark from the ball's last position by [along its heading, to the side] in px: the mitt's
// centre can sit behind where the ball went in, or off its line.
function projectedPitch({drop = 3, noise = 2, late = 0, mark = null} = {}){
  const F = 1500, world = t => ({X: 0.6 - 1.2*t, Y: -0.3 + 1.0*t + 4.9*t*t, Z: 3 + 36*t});
  const screen = t => { const w = world(t); return {t, x: 540 + F*w.X/w.Z, y: 900 + F*w.Y/w.Z}; };
  let seed = 3; const rnd = () => (seed = (seed*16807) % 2147483647)/2147483647 - 0.5;
  const ts = []; for(let k = 0; k/60 <= 17/36 + 1e-9; k++) ts.push(k/60);
  const points = ts.slice(0, -drop).map(t => { const p = screen(t); return {t, x: p.x + noise*rnd(), y: p.y + noise*rnd()}; });
  const end = screen(ts.at(-1));
  if(mark){
    const last = points.at(-1), prev = points.at(-4), L = Math.hypot(last.x - prev.x, last.y - prev.y), ux = (last.x - prev.x)/L, uy = (last.y - prev.y)/L;
    return {points, screen, arrive: end.t, catchPt: {t: end.t + late, x: last.x + mark[0]*ux - mark[1]*uy, y: last.y + mark[0]*uy + mark[1]*ux}};
  }
  return {points, screen, arrive: end.t, catchPt: {t: end.t + late, x: end.x + 3, y: end.y + 2}}; // the mitt's centre, a little off the ball
}
// How many times a path's bend changes direction (a real pitch bends one way only).
function bendFlips(path){
  let flips = 0, last = 0;
  for(let i = 2; i < path.length; i++){
    const a = Math.atan2(path[i-1][2] - path[i-2][2], path[i-1][1] - path[i-2][1]), b = Math.atan2(path[i][2] - path[i-1][2], path[i][1] - path[i-1][1]);
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    if(Math.abs(d) < 0.01) continue;
    if(last && Math.sign(d) !== last) flips++;
    last = Math.sign(d);
  }
  return flips;
}

test('fitPath follows a pitch seen in perspective, bending one way only, right to the catch', () => {
  for(const opts of [{drop: 3}, {drop: 8}, {drop: 15, noise: 4}]){
    const {points, screen, catchPt} = projectedPitch(opts);
    const path = fitPath(points, catchPt), [te, xe, ye] = path.at(-1);
    assert.deepEqual([xe, ye], [catchPt.x, catchPt.y]);
    assert.ok(Math.abs(te - catchPt.t) < 2/60, `path ends at ${te.toFixed(3)}s, catch at ${catchPt.t.toFixed(3)}s`);
    assert.equal(bendFlips(path), 0, `path bends both ways (${JSON.stringify(opts)})`);
    for(const [t, x, y] of path){ const s = screen(t); assert.ok(Math.hypot(x - s.x, y - s.y) < 9, `curve at ${t.toFixed(3)}s is ${Math.hypot(x - s.x, y - s.y).toFixed(1)} px off the ball (${JSON.stringify(opts)})`); }
  }
});

test('fitPath ends the path when the ball reaches the mark, not at a catch tagged late', () => {
  for(const opts of [{late: 0.1}, {late: 0.2}, {drop: 8, late: 0.15, noise: 4}]){
    const {points, screen, arrive, catchPt} = projectedPitch(opts), tag = JSON.stringify(opts);
    const path = fitPath(points, catchPt), [te, xe, ye] = path.at(-1);
    assert.deepEqual([xe, ye], [catchPt.x, catchPt.y]);
    assert.ok(Math.abs(te - arrive) < 2/60, `path ends at ${te.toFixed(3)}s, ball arrives at ${arrive.toFixed(3)}s (${tag})`);
    assert.equal(bendFlips(path), 0, `path bends both ways (${tag})`);
    for(let i = 1; i < path.length; i++) assert.ok(Math.hypot(path[i][1] - path[i-1][1], path[i][2] - path[i-1][2]) > 0.5, `path stalls at ${path[i][0].toFixed(3)}s (${tag})`);
    for(const [t, x, y] of path){ const s = screen(t); assert.ok(Math.hypot(x - s.x, y - s.y) < 9, `curve at ${t.toFixed(3)}s is ${Math.hypot(x - s.x, y - s.y).toFixed(1)} px off the ball (${tag})`); }
  }
});

// The drawn point nearest time t.
const at = (path, t) => path.reduce((b, r) => Math.abs(r[0] - t) < Math.abs(b[0] - t) ? r : b);

test('fitPath never turns back to reach a mark behind where the ball was last seen', () => {
  for(const mark of [[-30, 0], [-35, 8]]){
    const {points, catchPt} = projectedPitch({drop: 8, mark}), path = fitPath(points, catchPt);
    assert.deepEqual(path.at(-1).slice(1), [catchPt.x, catchPt.y]);
    const dx = catchPt.x - path[0][1], dy = catchPt.y - path[0][2];
    for(let i = 1; i < path.length; i++)
      assert.ok((path[i][1] - path[i-1][1])*dx + (path[i][2] - path[i-1][2])*dy >= 0, `path steps back at ${path[i][0].toFixed(3)}s (mark ${mark})`);
  }
});

test('fitPath keeps to the ball where it was seen, even when the mark is off its line', () => {
  for(const mark of [[40, 140], [60, -25]]){
    const {points, catchPt} = projectedPitch({drop: 8, mark}), path = fitPath(points, catchPt);
    assert.deepEqual(path.at(-1).slice(1), [catchPt.x, catchPt.y]);
    for(const p of points.slice(0, -6)){ const [, x, y] = at(path, p.t); assert.ok(Math.hypot(x - p.x, y - p.y) < 4, `curve at ${p.t.toFixed(3)}s is ${Math.hypot(x - p.x, y - p.y).toFixed(1)} px off the ball (mark ${mark})`); }
  }
});

test('findFlight rejects a flight that ends away from the catch, or at another time', () => {
  const n = 30, {frames, ball} = scene(n);
  const {cands, times} = track(frames);
  const end = ball(n - 2);
  assert.equal(findFlight(cands, times, {x: end.x + 300, y: end.y, t: times[n - 2]}), null);
  assert.equal(findFlight(cands, times, {x: end.x, y: end.y, t: times[n - 2] + 1}), null);
});

test('needsTrace: untraced pitches and paths drawn by an older fit are traced again; misses are not', () => {
  assert.equal(needsTrace(null), true);
  assert.equal(needsTrace({pts: [[1, 0, 0], [1.1, 5, 5]]}), true); // saved before paths carried a fit version
  assert.equal(needsTrace({fit: PATH_FIT - 1, pts: [[1, 0, 0], [1.1, 5, 5]]}), true);
  assert.equal(needsTrace({fit: PATH_FIT, pts: [[1, 0, 0], [1.1, 5, 5]]}), false);
  assert.equal(needsTrace({pts: []}), false); // the ball wasn't found; a new fit wouldn't find it either
});

test('pathUpTo trims the path to the playhead', () => {
  const pts = [[1, 0, 0], [1.1, 10, 0], [1.2, 20, 10]];
  assert.deepEqual(pathUpTo(pts, 0.9), []);
  assert.deepEqual(pathUpTo(pts, 1.15).map(p => p.map(v => +v.toFixed(6))), [[1, 0, 0], [1.1, 10, 0], [1.15, 15, 5]]);
  assert.deepEqual(pathUpTo(pts, 2), pts);
});
