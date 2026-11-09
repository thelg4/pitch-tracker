// Proposing a pitch's target with the trained mitt detector. Pure functions (no DOM), so they run in tests too.
// The target is the glove at the pitcher's release (see docs/ROADMAP.md). Given the tagged catch, release
// falls roughly RELEASE_S before it, so the tracer samples a few frames across that window, runs the model on a
// full-resolution square around the strike zone, and proposeTarget() turns the boxes into one point: the
// median of each frame's best mitt, after dropping frames that disagree (the pitcher's arm can hide the mitt
// or the model can fire on something else for a frame).

export const RELEASE_S = [0.75, 0.4];  // release lies this many seconds before the catch (about 50 to 85 mph from 60 ft)
export const SAMPLES = 6;
export const CROP_ZONES = 6.5;         // the model's crop is this many zone widths on a side (the catcher and his reach)
export const MIN_SCORE = 0.25;         // weakest box counted as a mitt
const REACH_ZONES = 2.5;               // a mitt farther than this from the zone's centre (in zone widths) is someone else's
const AGREE_ZONES = 0.5;               // samples farther than this from the median are dropped (half a plate, about 8")
const MIN_AGREE = 2;

// The square the model looks at, in frame pixels: centred on the zone and kept inside the frame.
export function modelCrop(zone, frameW, frameH){
  const s = Math.min(CROP_ZONES*zone.w, frameW, frameH);
  const cx = zone.x + zone.w/2, cy = zone.y + zone.h/2;
  return {x: Math.min(Math.max(cx - s/2, 0), frameW - s), y: Math.min(Math.max(cy - s/2, 0), frameH - s), s};
}

// When to sample, in video seconds: SAMPLES times spread across the release window, never before the start.
export function sampleTimes(catchT){
  const [a, b] = RELEASE_S, out = [];
  for(let i = 0; i < SAMPLES; i++) out.push(Math.max(0, catchT - a + (a - b)*i/(SAMPLES - 1)));
  return [...new Set(out)];
}

const median = vs => { const s = [...vs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m])/2; };

// `samples` are [{t, boxes}] with boxes as the detector returns them (centre and size as fractions of `crop`).
// Returns the proposed target {x, y, t, score} in frame pixels, or null when the mitt wasn't found consistently.
// Its time is the sample whose mitt sits closest to the proposal, so "Go to Target Frame" shows it there.
export function proposeTarget(samples, crop, zone){
  const zx = zone.x + zone.w/2, zy = zone.y + zone.h/2;
  let hits = [];
  for(const {t, boxes} of samples){
    const best = boxes.map(b => ({t, x: crop.x + b.x*crop.s, y: crop.y + b.y*crop.s, score: b.score}))
      .filter(b => b.score >= MIN_SCORE && Math.hypot(b.x - zx, b.y - zy) <= REACH_ZONES*zone.w)
      .sort((a, b) => b.score - a.score)[0];
    if(best) hits.push(best);
  }
  if(hits.length < MIN_AGREE) return null;
  const mx = median(hits.map(h => h.x)), my = median(hits.map(h => h.y));
  hits = hits.filter(h => Math.hypot(h.x - mx, h.y - my) <= AGREE_ZONES*zone.w);
  if(hits.length < MIN_AGREE) return null;
  const x = median(hits.map(h => h.x)), y = median(hits.map(h => h.y));
  const at = hits.reduce((a, h) => Math.hypot(h.x - x, h.y - y) < Math.hypot(a.x - x, a.y - y) ? h : a);
  return {x, y, t: at.t, score: median(hits.map(h => h.score))};
}
