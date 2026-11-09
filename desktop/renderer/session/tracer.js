// Traces pitches' ball paths in the background. It reads frames from its own hidden <video>, so the player the
// user is watching never seeks or stalls. Pitches are traced one at a time in the order they are added; each
// trace reads about a second of video, sampled ~60 times a second, ending just after the tagged catch.
// It also finds targets with the mitt detector (findTarget): those jobs jump the queue, because the user is
// waiting on them to save a pitch.
import { SAMPLE_HZ, workScale, toGray, estimateShift, candidates, findFlight, fitPath } from '../balltrack.js';
import { modelCrop, findShow } from '../glovefind.js';

const LOOKBACK_S = 1.0;   // how long before the catch to look for the release (slow curveballs take ~0.7 s)

// `getFps()` reads the session's fps setting at trace time. `onTraced(pitch, path)` gets the pitch as it was
// when it was queued and its path {pts: [[t, x, y]…]} in frame pixels, with no points if the ball wasn't found.
export function createTracer({src, getFps, onTraced}){
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = src;
  const ready = new Promise((resolve, reject) => {
    v.addEventListener('loadeddata', resolve, {once: true});
    v.addEventListener('error', () => reject(new Error('The tracer could not open the video')), {once: true});
  });
  let queue = [], targets = [], current = null, running = false, dead = false, ctx = null, W = 0, H = 0, scale = 1;
  let mctx = null; // the model's input canvas, made on the first target job

  const seek = t => new Promise(resolve => { v.addEventListener('seeked', resolve, {once: true}); v.currentTime = t; });
  async function grab(frame, fps){
    await seek((frame + 0.5)/fps);
    ctx.drawImage(v, 0, 0, W, H);
    return toGray(ctx.getImageData(0, 0, W, H).data, W, H);
  }

  async function trace(p){
    const fps = getFps(), stride = Math.max(1, Math.round(fps/SAMPLE_HZ));
    const lastFrame = Math.max(0, Math.floor(v.duration*fps) - 1), catchF = Math.floor(p.loc.t*fps + 1e-6);
    const frames = [];
    for(let f = Math.max(0, catchF - Math.round(LOOKBACK_S*fps)); f <= Math.min(catchF + 2*stride, lastFrame); f += stride) frames.push(f);
    const times = frames.map(f => (f + 0.5)/fps), grey = [], shift = [], cands = [];
    for(let k = 0; k < frames.length; k++){
      await serveTargets(); // every grab seeks afresh, so a trace can pause between frames
      if(dead) return null;
      grey[k] = await grab(frames[k], fps);
      if(k > 0) shift[k-1] = estimateShift(grey[k-1], grey[k], W, H);
      if(k > 1){
        const j = k - 1; // the middle sample now has both neighbours
        cands[j] = candidates(grey[j-1], grey[j], grey[k], W, H, shift[j-1].map(s => -s), shift[j]);
        grey[j-1] = null; // keep only what the next sample needs
      }
    }
    const catchT = (catchF + 0.5)/fps;
    const near = Math.max(60, 1.5*(p.zone?.w ?? 0)*scale); // how close to the catch mark the flight must end
    const flight = findFlight(cands, times, {x: p.loc.x*scale, y: p.loc.y*scale, t: catchT},
      {minLen: Math.max(5, Math.round(0.15*fps/stride)), nearPx: near});
    if(!flight) return {pts: []};
    const pts = fitPath(flight.map(c => ({t: times[c.k], x: c.x/scale, y: c.y/scale})), {t: catchT, x: p.loc.x, y: p.loc.y}, stride/fps);
    return {pts: pts.map(([t, x, y]) => [+t.toFixed(4), +x.toFixed(1), +y.toFixed(1)])};
  }

  // The detector sees each sample time as a square around the zone at full resolution, resized to its input.
  const STOPPED = new Error('The tracer was stopped');
  async function target({loc, zone, input}){
    if(!mctx){ const cv = document.createElement('canvas'); cv.width = cv.height = input; mctx = cv.getContext('2d', {willReadFrequently: true}); }
    const crop = modelCrop(zone, v.videoWidth, v.videoHeight);
    return findShow(loc.t, zone, crop, async t => {
      if(dead) throw STOPPED;
      await seek(t);
      mctx.drawImage(v, crop.x, crop.y, crop.s, crop.s, 0, 0, input, input);
      return window.bullpen.detect(mctx.getImageData(0, 0, input, input).data, input);
    });
  }
  async function serveTargets(){
    while(targets.length && !dead){
      const job = targets.shift();
      try{ job.resolve(await target(job)); }catch(e){ if(e !== STOPPED) console.warn('Finding the target failed', e); job.resolve(null); }
    }
  }

  async function pump(){
    if(running) return;
    running = true;
    try{
      await ready;
      if(!ctx){
        scale = workScale(v.videoWidth, v.videoHeight); W = Math.round(v.videoWidth*scale); H = Math.round(v.videoHeight*scale);
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        ctx = cv.getContext('2d', {willReadFrequently: true});
      }
    }catch(e){ console.warn(e.message); queue = []; targets.forEach(j => j.resolve(null)); targets = []; running = false; return; }
    while((queue.length || targets.length) && !dead){
      await serveTargets();
      if(!queue.length || dead) break;
      current = queue.shift();
      let path = null;
      try{ path = await trace(current); }catch(e){ console.warn('Ball trace failed', e); }
      const p = current; current = null;
      if(path && !dead) try{ await onTraced(p, path); }catch(e){ console.warn('Saving a ball path failed', e); }
    }
    running = false;
  }

  return {
    add(p){ if(dead || !p.loc || queue.some(q => q.id === p.id)) return; queue.push(p); pump(); },
    // Whether a pitch is waiting or being traced now.
    pending: id => current?.id === id || queue.some(q => q.id === id),
    // The model's proposed target for a catch {x, y, t} with the strike zone, or null if it found no mitt.
    // `input` is the detector's crop size. Resolves null once the tracer is destroyed.
    findTarget(loc, zone, input){
      if(dead) return Promise.resolve(null);
      return new Promise(resolve => { targets.push({loc, zone, input, resolve}); pump(); });
    },
    destroy(){ dead = true; queue = []; targets.forEach(j => j.resolve(null)); targets = []; v.removeAttribute('src'); v.load(); },
  };
}
