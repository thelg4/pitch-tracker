// Ball tracking without a trained model. Pure functions on grey frames (no DOM), so they run in tests too.
// For one pitch the tracer hands in grey frames sampled about 60 times a second, ending at the tagged catch:
//   1. candidates(): small blobs that are brighter than the same spot in the sample before AND the sample after
//      (something light passing over a darker background), roughly round, and bright in their own right.
//      Hand-held shake is cancelled first by lining the neighbours up on the upper half of the frame.
//   2. findFlight(): the ball is the candidate that moves in a smooth, steady line for many samples, changing
//      size gradually, and that ends where and when the catch was tagged. The pitcher's body and other balls
//      in the gym make plenty of candidates, but not that.
//   3. fitPath(): a smooth curve through the flight that finishes exactly on the catch mark.
// Every size here is in working pixels: frames are scaled so their long side is at most WORK_LONG_SIDE.

export const WORK_LONG_SIDE = 1920;
export const SAMPLE_HZ = 60;
export const workScale = (w, h) => Math.min(1, WORK_LONG_SIDE / Math.max(w, h));

const DIFF = 18;          // how much brighter than its neighbours' background a candidate must be (grey levels)
const BRIGHT = 150;       // lowest mean grey level of a candidate
const MIN_AREA = 3, MAX_AREA = 1000;
const SHIFT_R = 4;        // largest shake corrected between samples, in working px

// RGBA pixels to grey, smoothed with a 5-tap binomial blur in each direction.
export function toGray(rgba, w, h){
  const g = new Uint8Array(w*h);
  for(let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j]*77 + rgba[j+1]*150 + rgba[j+2]*29) >> 8;
  return blur(g, w, h);
}
export function blur(src, w, h){
  const tmp = new Uint16Array(w*h), out = new Uint8Array(w*h);
  for(let y = 0; y < h; y++){
    const r = y*w;
    for(let x = 0; x < w; x++){
      const a = src[r + Math.max(x-2, 0)], b = src[r + Math.max(x-1, 0)], c = src[r + x], d = src[r + Math.min(x+1, w-1)], e = src[r + Math.min(x+2, w-1)];
      tmp[r + x] = a + 4*b + 6*c + 4*d + e;
    }
  }
  for(let y = 0; y < h; y++){
    const u2 = Math.max(y-2, 0)*w, u1 = Math.max(y-1, 0)*w, r = y*w, d1 = Math.min(y+1, h-1)*w, d2 = Math.min(y+2, h-1)*w;
    for(let x = 0; x < w; x++) out[r + x] = (tmp[u2+x] + 4*tmp[u1+x] + 6*tmp[r+x] + 4*tmp[d1+x] + tmp[d2+x] + 128) >> 8;
  }
  return out;
}

// The whole-pixel shift [dx, dy] for which src(x+dx, y+dy) best matches ref(x, y), measured on a sparse grid over
// the upper half of the frame (ceiling and back wall, which don't move).
export function estimateShift(ref, src, w, h, R = SHIFT_R){
  let best = [0, 0], bestCost = Infinity;
  const y0 = Math.max(R, Math.floor(h/20)), y1 = Math.floor(h/2), x0 = R, x1 = w - R;
  for(let dy = -R; dy <= R; dy++) for(let dx = -R; dx <= R; dx++){
    let cost = 0;
    for(let y = y0; y < y1; y += 4){
      const r = y*w, rs = (y+dy)*w + dx;
      for(let x = x0; x < x1; x += 4) cost += Math.abs(ref[r+x] - src[rs+x]);
      if(cost >= bestCost) break;
    }
    if(cost < bestCost || (cost === bestCost && Math.abs(dx) + Math.abs(dy) < Math.abs(best[0]) + Math.abs(best[1]))){ bestCost = cost; best = [dx, dy]; }
  }
  return best;
}

// Ball-like blobs in `cur`: [{x, y, area}]. `sp` and `sn` are the shifts that line prev and next up with cur.
export function candidates(prev, cur, next, w, h, sp = [0, 0], sn = [0, 0]){
  const m = new Uint8Array(w*h);
  const R = SHIFT_R;
  for(let y = R; y < h - R; y++){
    const r = y*w, rp = (y+sp[1])*w + sp[0], rn = (y+sn[1])*w + sn[0];
    for(let x = R; x < w - R; x++){
      const c = cur[r+x];
      if(c < BRIGHT - 40) continue; // too dark to be part of a bright blob; skips most of the frame cheaply
      if(c - prev[rp+x] > DIFF && c - next[rn+x] > DIFF) m[r+x] = 1;
    }
  }
  open3(m, w, h);
  return blobs(m, cur, w, h);
}

// Morphological opening with a 3×3 square: removes specks and one-pixel lines, keeps solid blobs' shape.
function open3(m, w, h){
  const e = new Uint8Array(w*h);
  for(let y = 1; y < h-1; y++){
    const r = y*w;
    for(let x = 1; x < w-1; x++){
      const i = r + x;
      if(m[i] && m[i-1] && m[i+1] && m[i-w] && m[i+w] && m[i-w-1] && m[i-w+1] && m[i+w-1] && m[i+w+1]) e[i] = 1;
    }
  }
  m.fill(0);
  for(let y = 1; y < h-1; y++){
    const r = y*w;
    for(let x = 1; x < w-1; x++){
      if(!e[r+x]) continue;
      for(let k = -w; k <= w; k += w){ m[r+x+k-1] = 1; m[r+x+k] = 1; m[r+x+k+1] = 1; }
    }
  }
}

// Connected blobs of the mask that look like a ball: small, roughly round (filling most of their box) and bright.
function blobs(m, grey, w, h){
  const out = [], stack = [];
  for(let s = 0; s < m.length; s++){
    if(!m[s]) continue;
    let area = 0, sx = 0, sy = 0, lum = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    m[s] = 0; stack.push(s);
    while(stack.length){
      const i = stack.pop(), x = i % w, y = (i - x)/w;
      area++; sx += x; sy += y; lum += grey[i];
      if(x < minX) minX = x; if(x > maxX) maxX = x; if(y < minY) minY = y; if(y > maxY) maxY = y;
      if(x > 0 && m[i-1]){ m[i-1] = 0; stack.push(i-1); }
      if(x < w-1 && m[i+1]){ m[i+1] = 0; stack.push(i+1); }
      if(y > 0 && m[i-w]){ m[i-w] = 0; stack.push(i-w); }
      if(y < h-1 && m[i+w]){ m[i+w] = 0; stack.push(i+w); }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if(area >= MIN_AREA && area <= MAX_AREA && area >= 0.45*bw*bh && Math.max(bw, bh) <= 3*Math.min(bw, bh) + 4 && lum/area >= BRIGHT)
      out.push({x: sx/area, y: sy/area, area});
  }
  return out;
}

/* ---------- linking ---------- */

const MIN_STEP = 3, MAX_STEP = 100, BASE_R = 4;

// Grow a chain of {k, x, y, area} forward (dir 1) or backward (dir -1) by predicting from its velocity over the
// last three steps (one step alone is too jittery with hand-held shake), bridging one missed sample. The next
// blob must be near the prediction and close in size.
function extend(cands, chain, dir){
  for(;;){
    const a = chain[chain.length-1], b = chain[Math.max(0, chain.length-4)];
    const vx = (a.x - b.x)/(a.k - b.k), vy = (a.y - b.y)/(a.k - b.k), speed = Math.hypot(vx, vy);
    let next = null;
    for(const gap of [1, 2]){
      const k = a.k + dir*gap, list = cands[k];
      if(!list?.length) continue;
      const px = a.x + vx*(k - a.k), py = a.y + vy*(k - a.k), r = BASE_R + 0.35*speed*gap;
      let best = Infinity;
      for(const c of list){
        const ratio = c.area/a.area; if(ratio < 0.4 || ratio > 2.5) continue;
        const d = Math.hypot(c.x - px, c.y - py);
        if(d <= r && d < best){ best = d; next = {k, x: c.x, y: c.y, area: c.area}; }
      }
      if(next) break;
    }
    if(!next) return chain;
    chain.push(next);
  }
}

// Mean cosine between consecutive steps: 1 for a perfectly steady direction.
function straightness(chain){
  let sum = 0, n = 0;
  for(let i = 2; i < chain.length; i++){
    const ax = chain[i-1].x - chain[i-2].x, ay = chain[i-1].y - chain[i-2].y, bx = chain[i].x - chain[i-1].x, by = chain[i].y - chain[i-1].y;
    sum += (ax*bx + ay*by)/(Math.hypot(ax, ay)*Math.hypot(bx, by) + 1e-6); n++;
  }
  return n ? sum/n : 0;
}

// The ball's flight in a window of samples. `cands[k]` are sample k's candidates and `times[k]` its time;
// `catchPt` is the tagged catch {x, y, t} in working px. Returns [{k, x, y, area}] or null.
// The flight must last a while (minLen samples), keep a steady direction, and end within `nearPx` of the catch
// mark no earlier than `earlyS` seconds before it (the ball can vanish against the catcher's gear).
// `accept(chain)` can rule out flights of the wrong kind, such as the throw back to the pitcher.
export function findFlight(cands, times, catchPt, {minLen = 8, nearPx = 120, earlyS = 0.3, lateS = 0.1, accept = null} = {}){
  let best = null;
  for(let k = 0; k + 1 < cands.length; k++){
    const c0 = cands[k], c1 = cands[k+1];
    if(!c0?.length || !c1?.length) continue;
    for(const p of c0) for(const q of c1){
      const step = Math.hypot(q.x - p.x, q.y - p.y);
      if(step < MIN_STEP || step > MAX_STEP) continue;
      const fwd = extend(cands, [{k, ...p}, {k: k+1, ...q}], 1);
      if(fwd.length < 4) continue;
      const back = extend(cands, [fwd[1], fwd[0]], -1);
      const chain = [...back.slice(2).reverse(), ...fwd];
      if(chain.length < minLen) continue;
      const s = straightness(chain); if(s < 0.8) continue;
      const end = chain[chain.length-1], te = times[end.k];
      if(te < catchPt.t - earlyS || te > catchPt.t + lateS) continue;
      if(Math.hypot(end.x - catchPt.x, end.y - catchPt.y) > nearPx) continue;
      if(accept && !accept(chain)) continue;
      const score = chain.length*s;
      if(!best || score > best.score) best = {score, chain};
    }
  }
  return best?.chain ?? null;
}

/* ---------- fitting ---------- */

// Weighted least-squares polynomial (degree ≤ 3) through (u, v) points; returns coefficients, lowest first.
function polyfit(us, vs, ws, deg){
  const n = deg + 1, A = Array.from({length: n}, () => new Float64Array(n + 1));
  for(let i = 0; i < us.length; i++){
    const pw = [1]; for(let d = 1; d < 2*n; d++) pw.push(pw[d-1]*us[i]);
    for(let r = 0; r < n; r++){ for(let c = 0; c < n; c++) A[r][c] += ws[i]*pw[r+c]; A[r][n] += ws[i]*pw[r]*vs[i]; }
  }
  for(let c = 0; c < n; c++){ // Gauss-Jordan with partial pivoting
    let p = c; for(let r = c+1; r < n; r++) if(Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for(let r = 0; r < n; r++) if(r !== c){ const f = A[r][c]/A[c][c]; for(let k = c; k <= n; k++) A[r][k] -= f*A[c][k]; }
  }
  return A.map((row, i) => row[n]/A[i][i]);
}
const polyval = (co, u) => co.reduce((s, c, i) => s + c*u**i, 0);

// A smooth curve (cubic in time for x and for y) through the flight's points [{t, x, y}], pulled onto the catch
// mark {t, x, y} so the drawn path ends where the pitch was tagged. Sampled at `step` seconds: [[t, x, y]…].
export function fitPath(points, catchPt, step = 1/SAMPLE_HZ){
  const t0 = points[0].t, span = Math.max(catchPt.t - t0, 1e-3);
  const all = [...points, catchPt], us = all.map(p => (p.t - t0)/span), ws = all.map((_, i) => i === points.length ? 8 : 1);
  const deg = Math.min(3, all.length - 1);
  const cx = polyfit(us, all.map(p => p.x), ws, deg), cy = polyfit(us, all.map(p => p.y), ws, deg);
  const out = [], n = Math.max(1, Math.round(span/step));
  for(let i = 0; i <= n; i++){
    const u = i/n, t = t0 + u*span;
    out.push(i === n ? [catchPt.t, catchPt.x, catchPt.y] : [t, polyval(cx, u), polyval(cy, u)]);
  }
  return out;
}

// The part of a stored path [[t, x, y]…] that has been travelled by time t (empty before release).
export function pathUpTo(pts, t){
  if(!pts?.length || t < pts[0][0]) return [];
  const out = [];
  for(let i = 0; i < pts.length; i++){
    if(pts[i][0] <= t){ out.push(pts[i]); continue; }
    const [ta, xa, ya] = pts[i-1], [tb, xb, yb] = pts[i], k = (t - ta)/(tb - ta);
    out.push([t, xa + (xb - xa)*k, ya + (yb - ya)*k]); break;
  }
  return out;
}
