// Session viewer: the geometry and drawing for the two canvases. The full frame shows the whole video with
// the movable crop box; the catcher crop is the zoomed view where marks are placed. Both draw from one hidden
// <video>, so they always show the same frame. All marks and the crop are stored in frame pixels.
import { TCOL, clamp } from '../scoring.js';
import { toast } from '../util.js';

// The getters read the controller's current state, so the viewer never holds a stale copy of it.
// `onCropSave(crop)` persists the crop after a settled change.
export function createViewer({fullCanvas: cvFull, cropCanvas: cvCrop, video: vid, getSession, getList, getDraft, getSelectedId,
                              getDragZone, getHasVideo, getShowAll, onCropSave}){
  let crop = getSession().crop;            // {cx, cy, w} in frame pixels; height follows the crop pane's shape
  let cropSaveT = 0;
  const fw = () => vid.videoWidth || getSession().frameW || 1920, fh = () => vid.videoHeight || getSession().frameH || 1080;

  /* ---------- geometry ---------- */
  const cssSize = cv => cv.getBoundingClientRect();
  const cropAspect = () => { const r = cssSize(cvCrop); return r.width/r.height || 16/9; };
  const cropRect = () => { const h = crop.w/cropAspect(); return {x: crop.cx - crop.w/2, y: crop.cy - h/2, w: crop.w, h}; };
  function fullFit(){ const r = cssSize(cvFull), s = Math.min(r.width/fw(), r.height/fh()); return {s, ox: (r.width - fw()*s)/2, oy: (r.height - fh()*s)/2}; }
  function cropFit(){ const r = cssSize(cvCrop), s = r.width/crop.w; return {s, ox: r.width/2 - crop.cx*s, oy: r.height/2 - crop.cy*s}; }
  const toFrame = (e, cv, f) => { const r = cssSize(cv); return {x: (e.clientX - r.left - f.ox)/f.s, y: (e.clientY - r.top - f.oy)/f.s}; };
  function catcherCrop(){ const z = getSession().zone; return {cx: z.x + z.w/2, cy: z.y + z.h/2, w: Math.max(z.w*5, z.h*2.4*cropAspect())}; }
  function setCrop(c, persist = true){
    crop = {cx: clamp(c.cx, 0, fw()), cy: clamp(c.cy, 0, fh()), w: clamp(c.w, fw()/25, fw())};
    draw();
    if(persist){ clearTimeout(cropSaveT); cropSaveT = setTimeout(() => onCropSave(crop), 400); }
  }
  function frameCatcher(){ if(!getSession().zone){ toast('Draw the strike zone first, then the catcher view can center on it.'); return; } setCrop(catcherCrop()); }
  // The first crop once the video's size is known: on the zone if there is one, else a third of the frame.
  function ensureCrop(){ if(!crop) crop = getSession().zone ? catcherCrop() : {cx: fw()/2, cy: fh()/2, w: fw()/3}; }

  function resize(){
    for(const cv of [cvFull, cvCrop]){ const r = cssSize(cv), dpr = devicePixelRatio || 1; cv.width = r.width*dpr; cv.height = r.height*dpr; }
    draw();
  }

  /* ---------- drawing ---------- */
  function draw(){ if(!crop) return; drawFull(); drawCrop(); }
  function drawFull(){
    const c = cvFull.getContext('2d'), dpr = devicePixelRatio || 1, f = fullFit(), W = fw()*f.s, H = fh()*f.s;
    c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0, 0, cvFull.width, cvFull.height);
    if(getHasVideo()) c.drawImage(vid, f.ox, f.oy, W, H);
    const cr = cropRect(), x = f.ox + cr.x*f.s, y = f.oy + cr.y*f.s, w = cr.w*f.s, h = cr.h*f.s;
    c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.rect(f.ox, f.oy, W, H); c.rect(x, y, w, h); c.fill('evenodd');
    if(getShowAll()) getList().forEach(p => { c.fillStyle = TCOL[p.type]; c.beginPath(); c.arc(f.ox + p.loc.x*f.s, f.oy + p.loc.y*f.s, 2.5, 0, 7); c.fill(); });
    c.strokeStyle = '#FFD24A'; c.lineWidth = 2; c.strokeRect(x, y, w, h);
  }
  function drawCrop(){
    const c = cvCrop.getContext('2d'), dpr = devicePixelRatio || 1, r = cssSize(cvCrop), f = cropFit(), cr = cropRect();
    c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0, 0, cvCrop.width, cvCrop.height);
    if(getHasVideo()) c.drawImage(vid, cr.x, cr.y, cr.w, cr.h, 0, 0, r.width, r.height);
    c.translate(f.ox, f.oy); c.scale(f.s, f.s); const lw = 1/f.s;
    const z = getDragZone() || getSession().zone;
    if(z){
      c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2*lw; c.setLineDash([6*lw,4*lw]); c.strokeRect(z.x,z.y,z.w,z.h); c.setLineDash([]);
      c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = lw; c.beginPath();
      for(let i=1;i<3;i++){ c.moveTo(z.x+z.w*i/3,z.y); c.lineTo(z.x+z.w*i/3,z.y+z.h); c.moveTo(z.x,z.y+z.h*i/3); c.lineTo(z.x+z.w,z.y+z.h*i/3); }
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,.75)'; c.font = `${12*lw}px ui-monospace, monospace`; c.fillText('17" plate width', z.x, z.y-6*lw);
    }
    const list = getList(), selectedId = getSelectedId(), sel = list.find(p => p.id === selectedId);
    if(getShowAll()) list.forEach(p => { if(p !== sel) drawPitch(c, p, lw, .35); });
    if(sel) drawPitch(c, sel, lw, 1); else drawPitch(c, getDraft(), lw, 1);
  }
  function drawPitch(c, p, lw, alpha){
    const col = TCOL[p.type] || '#fff', ppi = (p.zone || getSession().zone || {w:170}).w/17, ballR = 1.45*ppi;
    c.globalAlpha = alpha;
    const t = p.manual || p.glove;
    if(p.glove){ // catcher's glove: ring
      c.strokeStyle = p.manual ? 'rgba(255,255,255,.7)' : '#fff'; c.lineWidth = 2.5*lw; c.setLineDash(p.manual ? [4*lw,3*lw] : []);
      c.beginPath(); c.arc(p.glove.x, p.glove.y, ballR*2.2, 0, 7); c.stroke(); c.setLineDash([]);
    }
    if(p.manual){ // manual target: crosshair
      c.strokeStyle = '#FFD24A'; c.lineWidth = 2.5*lw; const r = ballR*2;
      c.beginPath(); c.moveTo(p.manual.x-r,p.manual.y); c.lineTo(p.manual.x+r,p.manual.y); c.moveTo(p.manual.x,p.manual.y-r); c.lineTo(p.manual.x,p.manual.y+r); c.stroke();
      c.beginPath(); c.arc(p.manual.x, p.manual.y, r*.6, 0, 7); c.stroke();
    }
    if(p.loc){
      if(t){ c.strokeStyle = col; c.lineWidth = 2*lw; c.beginPath(); c.moveTo(t.x,t.y); c.lineTo(p.loc.x,p.loc.y); c.stroke(); }
      c.fillStyle = col; c.strokeStyle = '#fff'; c.lineWidth = 1.5*lw; c.beginPath(); c.arc(p.loc.x, p.loc.y, ballR, 0, 7); c.fill(); c.stroke();
    }
    c.globalAlpha = 1;
  }

  return {
    draw, resize, setCrop, frameCatcher, ensureCrop,
    toFrameCrop: e => toFrame(e, cvCrop, cropFit()),
    toFrameFull: e => toFrame(e, cvFull, fullFit()),
    cropRect, cropScale: () => cropFit().s,
    // A frame point in CSS pixels on the catcher canvas, with the scale, for overlays placed on it.
    toCropPx(pt){ const f = cropFit(); return {x: f.ox + pt.x*f.s, y: f.oy + pt.y*f.s, s: f.s}; },
    // Stop a pending crop save and return the crop, for a final save on unmount.
    flush(){ clearTimeout(cropSaveT); return crop; },
    get crop(){ return crop; },
    set crop(c){ crop = c; },
  };
}
