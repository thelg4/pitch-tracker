// Analyze Session: finds every pitch in the video without clicks (the steps are in autodetect.js). It reads frames
// from its own hidden <video>, so the player the user is watching never seeks or stalls, and runs in two passes:
//   1. the mitt, TRACK_HZ times a second across the whole video, through the trained detector;
//   2. the ball, SAMPLE_HZ times a second in a window after each show, through the model-free ball tracker.
// Each frame's seek is started before the previous frame is processed, so decoding and work overlap.
// A pitch is handed to onPitch as soon as it is found, ready to save: {glove, loc, path, auto}.
import { SAMPLE_HZ, workScale, toGray, estimateShift, candidates, findFlight, fitPath } from '../balltrack.js';
import { modelCrop, mitts } from '../glovefind.js';
import { TRACK_HZ, findHolds, ballWindow, towardCatcher, targetFor, catchFor } from '../autodetect.js';

const PASS1 = 0.3;   // the share of the progress bar the mitt pass takes (it is about a third of the time)

// `zone` is the session's strike zone and `input` the detector's crop size. onProgress(fraction) reports progress;
// onPitch(pitch) is awaited, so pitches are saved in the order they are found.
export function createAnalyzer({src, zone, input, onProgress, onPitch}){
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = src;
  const ready = new Promise((resolve, reject) => {
    v.addEventListener('loadeddata', resolve, {once: true});
    v.addEventListener('error', () => reject(new Error('The analyzer could not open the video')), {once: true});
  });
  let stopped = false;
  const seek = t => new Promise(resolve => { v.addEventListener('seeked', resolve, {once: true}); v.currentTime = t; });
  const canvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv.getContext('2d', {willReadFrequently: true}); };

  // Pass 1: the mitt at every sample time, [{t, x, y, score, alts} | null] in frame pixels, with up to two
  // runner-up boxes in case the model ranked something else first.
  async function trackMitt(dur, fw, fh){
    const crop = modelCrop(zone, fw, fh), ctx = canvas(input, input);
    const n = Math.floor((dur - 0.05)*TRACK_HZ) + 1, track = new Array(n).fill(null);
    let detecting = null;
    for(let k = 0; k < n; k++){
      await seek(k/TRACK_HZ); if(stopped) return null;
      ctx.drawImage(v, crop.x, crop.y, crop.s, crop.s, 0, 0, input, input);
      const data = ctx.getImageData(0, 0, input, input).data, t = k/TRACK_HZ;
      const prev = detecting;   // the previous frame's detection ran while this frame was seeking
      detecting = window.bullpen.detect(data, input).then(boxes => { const [m, ...alts] = mitts(boxes, crop, zone); track[k] = m ? {t, ...m, alts: alts.slice(0, 2)} : null; });
      await prev;
      if(k % 25 === 0) onProgress(PASS1*k/n);
    }
    await detecting;
    return track;
  }

  // Pass 2, one window: the ball's flight toward the catcher, [{t, x, y}] in frame pixels, or null.
  async function findBall({t0, t1}, ctx, W, H, scale){
    const times = []; for(let t = t0; t <= t1 + 1e-9; t += 1/SAMPLE_HZ) times.push(+t.toFixed(4));
    if(times.length < 12) return null;
    const grey = [], shift = [], cands = [];
    let next = seek(times[0]);
    for(let k = 0; k < times.length; k++){
      await next; if(stopped) return null;
      ctx.drawImage(v, 0, 0, W, H);
      const rgba = ctx.getImageData(0, 0, W, H).data;
      next = k + 1 < times.length ? seek(times[k + 1]) : null;   // decode the next frame while this one is worked on
      grey[k] = toGray(rgba, W, H);
      if(k > 0) shift[k-1] = estimateShift(grey[k-1], grey[k], W, H);
      if(k > 1){ const j = k - 1; cands[j] = candidates(grey[j-1], grey[j], grey[k], W, H, shift[j-1].map(s => -s), shift[j]); grey[j-1] = null; }
    }
    const centre = {x: (zone.x + zone.w/2)*scale, y: (zone.y + zone.h/2)*scale};
    const flight = findFlight(cands, times, {...centre, t: times[times.length-1]},
      {minLen: Math.round(0.15*SAMPLE_HZ), nearPx: 3*zone.w*scale, earlyS: t1 - t0 + 0.1, lateS: 0.1, accept: towardCatcher(centre, zone.w*scale)});
    return flight && flight.map(c => ({t: times[c.k], x: c.x/scale, y: c.y/scale}));
  }

  async function run(){
    await ready;
    const dur = v.duration, fw = v.videoWidth, fh = v.videoHeight;
    const track = await trackMitt(dur, fw, fh); if(!track) return;
    const holds = findHolds(track, zone);
    const scale = workScale(fw, fh), W = Math.round(fw*scale), H = Math.round(fh*scale), ctx = canvas(W, H);
    let caughtAt = -Infinity;   // the last catch found: shows before it belong to that pitch
    for(let i = 0; i < holds.length; i++){
      if(stopped) return;
      onProgress(PASS1 + (1 - PASS1)*i/holds.length);
      if(holds[i].t1 < caughtAt) continue;
      const flight = await findBall(ballWindow(holds[i], dur), ctx, W, H, scale);
      if(stopped) return;
      if(!flight) continue;
      const show = targetFor(flight[0].t, holds), c = catchFor(flight, track, zone, holds);
      if(!show || !c) continue;
      caughtAt = c.t;
      const pts = fitPath(flight, {t: c.t, x: c.x, y: c.y}, 1/SAMPLE_HZ).map(([t, x, y]) => [+t.toFixed(4), +x.toFixed(1), +y.toFixed(1)]);
      await onPitch({
        glove: {x: show.x, y: show.y, t: +show.t1.toFixed(3)},
        loc: {x: c.x, y: c.y, t: +c.t.toFixed(3)},
        path: {pts},
        auto: {x: show.x, y: show.y, score: +show.score.toFixed(3), state: 'proposed', catch: {x: c.x, y: c.y, score: +c.score.toFixed(3)}},
      });
    }
    onProgress(1);
  }

  return {
    // Resolves when the analysis finishes or is stopped; rejects if the video can't be read.
    run,
    stop(){ if(stopped) return; stopped = true; v.dispatchEvent(new Event('seeked')); v.removeAttribute('src'); v.load(); },
  };
}
