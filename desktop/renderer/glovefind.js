// Proposing a pitch's target with the trained mitt detector. Pure functions (no DOM), so they run in tests too.
// The target is where the catcher shows the glove before the pitch: he holds it open and still on the spot he
// wants, then closes it and lets it ride (often down to his knee) through the delivery, and only moves it to the
// ball at the catch. So the target is the last long, still hold of the mitt before the catch.
// findShow() walks back from the catch, a sample at a time, running the model on a full-resolution square around
// the strike zone. Nearest the catch the mitt is moving or resting briefly; the first hold that lasts MIN_HOLD_S
// going back is the show. It stops as soon as the hold is long enough, so it reads only the frames it needs.

export const STEP_S = 0.2;        // time between samples
export const START_S = 0.5;       // the first sample is this long before the catch (the ball is in flight)
export const MAX_BACK_S = 6;      // give up this far before the catch
export const MIN_HOLD_S = 0.6;    // a hold at least this long is a show (a pause at the knee in the delivery is shorter)
export const ENOUGH_S = 1.0;      // a hold this long needs no more samples
export const CROP_ZONES = 6.5;    // the model's crop is this many zone widths on a side (the catcher and his reach)
export const MIN_SCORE = 0.15;    // weakest box counted as a mitt (v1 scores a shown glove about 0.25 to 0.5)
const REACH_ZONES = 2.5;          // a mitt farther than this from the zone's centre (in zone widths) is someone else's
const HOLD_ZONES = 0.2;           // a hold stays within this of its median (about 3.4")
const MAX_MISS = 1;               // samples in a row a hold may lose the mitt (or see it elsewhere) and carry on

// The square the model looks at, in frame pixels: centred on the zone and kept inside the frame.
export function modelCrop(zone, frameW, frameH){
  const s = Math.min(CROP_ZONES*zone.w, frameW, frameH);
  const cx = zone.x + zone.w/2, cy = zone.y + zone.h/2;
  return {x: Math.min(Math.max(cx - s/2, 0), frameW - s), y: Math.min(Math.max(cy - s/2, 0), frameH - s), s};
}

const median = vs => { const s = [...vs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m])/2; };

// The strongest box near the zone, in frame pixels, from boxes as the detector returns them (fractions of `crop`).
export function bestMitt(boxes, crop, zone){
  const zx = zone.x + zone.w/2, zy = zone.y + zone.h/2;
  return boxes.map(b => ({x: crop.x + b.x*crop.s, y: crop.y + b.y*crop.s, score: b.score}))
    .filter(b => b.score >= MIN_SCORE && Math.hypot(b.x - zx, b.y - zy) <= REACH_ZONES*zone.w)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

// The shown glove before the catch at `catchT`: {x, y, t, score} in frame pixels, or null if the catcher never held
// it still long enough. `detectAt(t)` returns the detector's boxes for the frame at video time t. The proposal is
// the hold's median; its time is the hold's last sample, the moment before the glove closes.
export async function findShow(catchT, zone, crop, detectAt){
  let run = [], miss = 0;                   // the hold being followed, newest sample first
  const span = () => run.length ? run[0].t - run[run.length-1].t : 0;
  const long = () => span() >= MIN_HOLD_S - 1e-9;
  const hold = () => ({x: median(run.map(p => p.x)), y: median(run.map(p => p.y)), t: run[0].t, score: median(run.map(p => p.score))});
  const first = Math.max(0, catchT - MAX_BACK_S);
  for(let k = 0; ; k++){
    const t = +(catchT - START_S - k*STEP_S).toFixed(3);
    if(t < first) break;
    const b = bestMitt(await detectAt(t), crop, zone), p = b && {t, ...b};
    if(run.length){
      const mx = median(run.map(q => q.x)), my = median(run.map(q => q.y));
      if(p && Math.hypot(p.x - mx, p.y - my) <= HOLD_ZONES*zone.w){ run.push(p); miss = 0; }
      else if(++miss > MAX_MISS){
        if(long()) return hold();
        run = p ? [p] : []; miss = 0;
      }
    }else if(p) run = [p];
    if(span() >= ENOUGH_S - 1e-9) return hold();
  }
  return long() ? hold() : null;
}
