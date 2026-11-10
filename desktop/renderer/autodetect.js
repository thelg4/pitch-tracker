// Finding every pitch in a session without clicks. Pure functions (no DOM), so they run in tests too; the
// analyzer (session/analyzer.js) reads the video and calls them.
// Each pitch shows up the same way:
//   1. the catcher shows the glove: the mitt holds still on his spot (the target),
//   2. he closes it and lets it ride through the delivery,
//   3. the ball flies in, heading for him and shrinking, and the mitt meets it (the catch),
//   4. he throws it back, the ball heading away and growing.
// So the analyzer tracks the mitt across the whole video (findHolds turns that track into shows), looks for the
// ball's flight in a window after each show (towardCatcher keeps pitches and drops throwbacks), and pairs each
// flight with the show before it (targetFor) and the mitt where the ball ends (catchFor).

export const TRACK_HZ = 10;          // mitt samples a second over the whole video
export const MIN_HOLD_S = 0.8;       // a show lasts at least this long
export const WINDOW_S = [0.5, 3.4];  // the ball's flight falls this long after a show ends (it ends by about 3 s)
const HOLD_ZONES = 0.2;              // a hold stays within this of its median (about 3.4")
const MAX_MISS = 1;                  // samples in a row a hold may lose the mitt and carry on
const SHOW_BEFORE_S = 3.5;           // a show more than this long before the flight is a different moment
const MEET_ZONES = 0.45;             // the mitt meets the ball's path within this (about 8")
const NEAR_ZONES = 1.0;              // ... or is at least this close to it
const CATCH_AFTER_S = 0.5;           // how long after its last sighting the ball may take to reach the mitt
const ARRIVE_S = 0.15;               // the ball usually reaches the mitt this long after it's last seen (lost against the gear)
const SPAN_S = 0.15;                 // a catch inside a hold that started and ends this far around it is no catch
const COAST_S = 0.25;                // how far the ball's path is extended past its last sighting

const median = vs => { const s = [...vs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m])/2; };
// A sample's mitt candidates: its best box and the runners-up (the model sometimes ranks his hand or mask first).
const options = p => p ? [p, ...(p.alts ?? []).map(a => ({...a, t: p.t}))] : [];

// The shows in a mitt track: `track` is [{t, x, y, score, alts?} | null] in time order (null when no mitt was
// seen; `alts` are runner-up boxes {x, y, score}). A hold follows whichever candidate stays put.
// Returns [{t0, t1, x, y, score}] for every hold of at least MIN_HOLD_S, in frame pixels.
export function findHolds(track, zone){
  const out = [], R = HOLD_ZONES*zone.w;
  let run = [], miss = 0;
  const close = () => {
    if(run.length && run[run.length-1].t - run[0].t >= MIN_HOLD_S - 1e-9)
      out.push({t0: run[0].t, t1: run[run.length-1].t, x: median(run.map(p => p.x)), y: median(run.map(p => p.y)), score: median(run.map(p => p.score))});
  };
  for(let i = 0; i < track.length; i++){
    const p = track[i];
    if(run.length){
      const mx = median(run.map(q => q.x)), my = median(run.map(q => q.y));
      const fit = options(p).filter(o => Math.hypot(o.x - mx, o.y - my) <= R).sort((a, b) => b.score - a.score)[0];
      if(fit){ run.push(fit); miss = 0; continue; }
      if(++miss <= MAX_MISS) continue;
      // The hold is over; the next one may start at the first sample that didn't fit it.
      close(); run = []; i -= miss; miss = 0;
      continue;
    }
    if(p) run = [p];
  }
  close();
  return out;
}

// Where to look for the ball after a show, in video seconds.
export const ballWindow = (hold, duration) => ({t0: hold.t1 + WINDOW_S[0], t1: Math.min(duration, hold.t1 + WINDOW_S[1])});

// An accept test for findFlight: a pitch ends much nearer the catcher than it starts and doesn't grow (the throw
// back does both the other way). `centre` is the zone's centre and `zoneW` its width, in the flight's pixels.
export function towardCatcher(centre, zoneW){
  const d = c => Math.hypot(c.x - centre.x, c.y - centre.y);
  return chain => {
    const n = Math.max(2, chain.length >> 2), area = cs => cs.reduce((s, c) => s + c.area, 0)/cs.length;
    return d(chain[0]) - d(chain[chain.length-1]) > 2*zoneW && area(chain.slice(-n)) <= area(chain.slice(0, n));
  };
}

// The show a flight starting at `t` belongs to: the last one that ends before it, not long before.
export function targetFor(t, holds){
  let best = null;
  for(const h of holds) if(h.t1 <= t && t - h.t1 <= SHOW_BEFORE_S && (!best || h.t1 > best.t1)) best = h;
  return best;
}

// The catch for a flight `pts` [{t, x, y}] (frame pixels). The ball is usually lost against the catcher's gear a
// beat before it arrives, so its path is extended along its last few points' velocity, and the catch is the mitt
// on (or near) that path at the sample nearest ARRIVE_S after the last sighting; failing that, the mitt nearest the
// path within CATCH_AFTER_S. {x, y, t, score}, or null when the mitt isn't there (then it wasn't a pitch, or the
// mitt was lost). Nor is it a catch if the mitt was sitting still right through it: a streak that ends at a shown
// glove (`holds`, from findHolds) isn't a ball arriving.
export function catchFor(pts, track, zone, holds = []){
  const e = pts[pts.length-1], a = pts[Math.max(0, pts.length-4)], dt = Math.max(e.t - a.t, 1e-3);
  const ux = (e.x - a.x)/dt*COAST_S, uy = (e.y - a.y)/dt*COAST_S, L = Math.max(ux*ux + uy*uy, 1e-6);
  const dist = m => { const k = Math.min(1, Math.max(0, ((m.x - e.x)*ux + (m.y - e.y)*uy)/L)); return Math.hypot(m.x - e.x - k*ux, m.y - e.y - k*uy); };
  const win = track.filter(m => m && m.t >= e.t - 0.05 && m.t <= e.t + CATCH_AFTER_S).flatMap(options);
  const arrive = e.t + ARRIVE_S, byPath = (p, q) => dist(p) - dist(q);
  // The samples around the arrival, nearest it first; the mitt on the path at the first of them that has one.
  const around = [...new Set(win.map(m => m.t))].filter(t => Math.abs(t - arrive) <= 0.1 + 1e-9).sort((a, b) => Math.abs(a - arrive) - Math.abs(b - arrive));
  let c = null;
  for(const t of around){ c = win.filter(m => m.t === t && dist(m) <= MEET_ZONES*zone.w).sort(byPath)[0]; if(c) break; }
  c ??= win.filter(m => dist(m) <= NEAR_ZONES*zone.w).sort(byPath)[0] ?? null;
  if(c && holds.some(h => h.t0 <= c.t - SPAN_S && h.t1 >= c.t + SPAN_S)) return null;
  return c;
}
