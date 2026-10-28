// Session view: tag one bullpen video. The viewer (viewer.js) draws the full frame and the catcher crop;
// this controller owns the tagging state, the pointer and key handling, and the panels below the viewer.
import { TYPES, TCOL, TNAME, clamp, fmt, scored, summary, grade, tone, GRADE_TXT, insights } from '../scoring.js';
import { scatter, legend, heat, rollingTrend, typeTable } from '../charts.js';
import { $, $$, db, esc, fmtDate, handLabel, toast, confirmTap, mediaUrl, basename } from '../util.js';
import { createViewer } from './viewer.js';

export async function sessionView(root, id){
  const data = await db('getSession', id);
  if(!data){ root.innerHTML = '<div class="empty">That session no longer exists. <a href="#/">Back to athletes</a></div>'; return; }
  let {session: S, athlete: A, pitches} = data;
  const settings = () => ({hand: A.throws, view: S.cameraView, hitR: S.hitRadius});
  let list = [];
  let draft = newDraft(), mode = S.zone ? 'target' : 'zone', source = 'glove', curType = 'FB';
  let selectedId = null, editField = null, confirmDel = false, filter = 'ALL', hasVideo = false;
  let dragZone = null, dragCrop = null, pan = null, raf = 0;
  function newDraft(){ return {glove:null, manual:null, loc:null}; }

  root.innerHTML = `
    <header class="top">
      <div><h1>${fmtDate(S.recordedOn)} bullpen</h1><div class="sub">${esc(A.name)} · ${handLabel(A.throws)} · <span id="clipName"></span></div></div>
      <div class="setup">
        <label class="field"><span class="lbl">Date</span><input type="date" id="date"></label>
        <label class="field"><span class="lbl">Camera</span><select id="view"><option value="pitcher">Behind pitcher</option><option value="catcher">Behind catcher</option></select></label>
        <label class="field"><span class="lbl">Hit radius (in)</span><input id="hitR" type="number" min="2" max="12" step="0.5"></label>
        <label class="field"><span class="lbl">Video fps</span><select id="fps"><option>30</option><option>60</option><option>120</option><option>240</option></select></label>
      </div>
    </header>

    <section class="panel">
      <div class="stages" id="stages">
        <div class="pane full" id="paneFull" style="aspect-ratio:9/16"><canvas id="cvFull"></canvas><span class="tag">Full frame · drag the box · scroll to resize</span></div>
        <div class="pane crop" id="paneCrop"><canvas id="cvCrop"></canvas><div class="modechip" id="modechip" hidden></div><span class="tag">Catcher view</span></div>
        <div class="drop" id="drop" hidden><strong id="dropTitle"></strong><span id="dropTxt"></span><button class="btn primary" id="pick">Choose video</button></div>
        <video id="vid" class="vid" muted playsinline preload="auto" crossorigin="anonymous"></video>
      </div>
      <div class="transport">
        <button class="btn sm" id="play" title="Play / pause (Space)">Play</button>
        <button class="btn sm" id="back10" title="Back 10 frames (Shift + ←)">−10</button>
        <button class="btn sm" id="back1" title="Back 1 frame (←)">−1</button>
        <button class="btn sm" id="fwd1" title="Forward 1 frame (→)">+1</button>
        <button class="btn sm" id="fwd10" title="Forward 10 frames (Shift + →)">+10</button>
        <input type="range" id="scrub" min="0" max="1" step="0.001" value="0" aria-label="Video position">
        <select id="rate" class="btn sm" aria-label="Playback speed"><option value="1">1×</option><option value="0.5">0.5×</option><option value="0.25" selected>0.25×</option><option value="0.1">0.1×</option></select>
        <span class="time" id="time">0:00.00</span>
      </div>
      <div class="row hint">
        <span><span class="kbd">Space</span> play</span><span><span class="kbd">←</span><span class="kbd">→</span> frame step</span>
        <span><span class="kbd">G</span> glove</span><span><span class="kbd">M</span> manual</span><span><span class="kbd">Z</span> zone</span><span><span class="kbd">C</span> frame catcher</span><span><span class="kbd">⌫</span> undo mark</span>
        <span>Scroll on the catcher view to zoom · <span class="kbd">Shift</span>+drag to pan</span>
      </div>
      <div class="row">
        <button class="btn sm" id="frameCatcher" title="Center the catcher view on the zone (C)">Frame catcher</button>
        <label style="margin-left:auto;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="showAll" checked> Show all pitches</label>
        <button class="btn sm" id="relink" title="Point this session at the video file again if it moved">Relink video</button>
      </div>
    </section>

    <section class="bench">
      <div class="panel" id="tagger">
        <div class="panel-h"><h2>Tag pitch <span class="num" id="nextN">#1</span></h2></div>
        <div class="steps">
          <div class="step" id="stZone"><b>Zone</b><span></span></div>
          <div class="step" id="stTarget"><b>Target</b><span></span></div>
          <div class="step" id="stLoc"><b>Location</b><span></span></div>
        </div>
        <div class="instr" id="instr"></div>
        <div class="field"><span class="lbl">Pitch type</span><div class="chips" id="types"></div></div>
        <div class="field"><span class="lbl">Target from</span>
          <div class="seg" id="source"><button data-v="glove">Catcher's glove</button><button data-v="manual">Manual target</button></div></div>
        <div id="manualBox" class="field" hidden><span class="lbl">Quick manual target (or click the catcher view)</span><div class="zonepick" id="zonepick"></div></div>
        <div class="row">
          <button class="btn sm" id="undoMark">Undo mark</button>
          <button class="btn sm" id="redrawZone">Redraw zone</button>
        </div>
        <div class="edit" id="editBox" hidden></div>
        <p class="hint" style="margin:0">Catcher set up in the wrong spot? Mark the glove, then switch to <b>Manual target</b> and click where the ball was supposed to go. The manual target is what gets scored; the glove spot is kept so you can see how far off the setup was.</p>
      </div>
      <div class="panel">
        <div class="panel-h"><h2>Command score</h2></div>
        <div class="big"><div class="score num" id="bigScore">–</div><div class="grade"><span id="gradePill" class="pill neutral">–</span><span class="hint" id="gradeTxt"></span></div></div>
        <div class="stats">
          <div><span class="lbl">Hit rate</span><span class="v" id="sHit">–</span></div>
          <div><span class="lbl">Avg miss</span><span class="v" id="sMiss">–</span></div>
          <div><span class="lbl">In zone</span><span class="v" id="sZone">–</span></div>
          <div><span class="lbl">Pitches</span><span class="v" id="sN">–</span></div>
        </div>
        <ul class="insights" id="insights"></ul>
        <details class="method"><summary>How the score works</summary>
          <p>Miss distance is measured in inches from the target to where the ball is caught, using the 17-inch plate width from your zone box as the ruler. A pitch within a third of the hit radius scores 100. The score falls in a straight line to 0 at three times the hit radius. With the default 6" radius, a 6" miss scores 75 and anything 18" or more scores 0. The command score is the average across all tagged pitches, and the grade puts it on the 20–80 scouting scale.</p>
        </details>
      </div>
    </section>

    <section class="panel">
      <div class="panel-h"><h2>Trends</h2>
        <div class="field" style="grid-auto-flow:column;align-items:center;gap:8px"><label class="lbl" for="filter">Pitch type</label><select id="filter" class="btn sm"></select></div></div>
      <div class="trends">
        <div class="field"><span class="lbl">Miss pattern around the target</span><div id="scatter"></div><div class="legend" id="legend"></div></div>
        <div class="field"><span class="lbl">Hit rate by target location</span><div id="heat"></div><span class="hint">Targets grouped by zone third, seen from the mound. Arm side is the side of the pitcher's throwing hand.</span></div>
        <div class="field"><span class="lbl">Score over the session (5-pitch rolling)</span><div id="trend"></div></div>
      </div>
      <div class="tbl" id="typeTbl"></div>
    </section>

    <section class="panel">
      <div class="panel-h"><h2>Pitch log</h2>
        <div class="row"><button class="btn sm" id="copyCsv">Copy CSV</button><button class="btn sm danger" id="delSession">Delete session</button></div></div>
      <div class="tbl" id="log"></div>
      <textarea class="csv" id="csvBox" hidden readonly aria-label="CSV export"></textarea>
    </section>`;

  const vid = $('#vid'), cvFull = $('#cvFull'), cvCrop = $('#cvCrop'), stages = $('#stages');
  const viewer = createViewer({fullCanvas: cvFull, cropCanvas: cvCrop, video: vid,
    getSession: () => S, getList: () => list, getDraft: () => ({...draft, type: curType}), getSelectedId: () => selectedId,
    getDragZone: () => dragZone, getHasVideo: () => hasVideo, getShowAll: () => $('#showAll').checked,
    onCropSave: crop => patchSession({crop})});
  const drawStages = () => viewer.draw(), setCrop = (c, persist) => viewer.setCrop(c, persist), frameCatcher = () => viewer.frameCatcher();

  /* ---------- saving ---------- */
  async function patchSession(patch){ S = await db('updateSession', S.id, patch); }
  function refresh(){ list = scored(pitches, settings()); renderAll(); }

  /* ---------- video ---------- */
  function showDrop(title, txt){ $('#drop').hidden = false; $('#dropTitle').textContent = title; $('#dropTxt').textContent = txt; }
  function loadVideo(){
    hasVideo = false;
    if(!S.videoPath){ showDrop('Choose the bullpen video', 'Film from behind the pitcher with the catcher in view. Drop the file here or choose it.'); return; }
    $('#drop').hidden = true; vid.src = mediaUrl(S.videoPath); vid.playbackRate = +$('#rate').value;
  }
  async function useVideo(file){
    if(!file) return;
    if(!await window.bullpen.allowVideo(file)){ toast('That file is not a video. Choose an .mp4 or .mov.'); return; }
    await patchSession({videoPath: file, title: basename(file)}); loadVideo(); renderTagger();
  }
  vid.addEventListener('loadedmetadata', async () => {
    if(S.frameW !== vid.videoWidth || S.frameH !== vid.videoHeight){
      const d = await db('rescaleSession', S.id, vid.videoWidth, vid.videoHeight);
      S = d.session; pitches = d.pitches; viewer.crop = S.crop;
    }
    hasVideo = true;
    $('#paneFull').style.aspectRatio = `${vid.videoWidth}/${vid.videoHeight}`;
    $('#scrub').max = vid.duration;
    viewer.ensureCrop();
    viewer.resize(); refresh();
  });
  vid.addEventListener('error', () => {
    hasVideo = false;
    showDrop("Can't open this video", `${basename(S.videoPath)} was moved, deleted, or isn't a format this app can play. Choose it again.`);
    renderTagger();
  });
  vid.addEventListener('seeked', () => { syncTime(); drawStages(); });
  vid.addEventListener('play', () => { $('#play').textContent = 'Pause'; cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  vid.addEventListener('pause', () => { $('#play').textContent = 'Play'; syncTime(); drawStages(); });
  function tick(){ syncTime(); drawStages(); if(!vid.paused && !vid.ended) raf = requestAnimationFrame(tick); }

  const frameOf = t => Math.floor(t*S.fps + 1e-6);
  function syncTime(){ const t = vid.currentTime; $('#scrub').value = t; $('#time').textContent = `${Math.floor(t/60)}:${(t%60).toFixed(2).padStart(5,'0')} · f${frameOf(t)}`; }
  // Seek to the middle of the target frame so rounding never lands on its neighbor.
  function step(n){
    if(!hasVideo) return; vid.pause();
    const last = Math.max(0, Math.floor(vid.duration*S.fps) - 1);
    vid.currentTime = (clamp(frameOf(vid.currentTime) + n, 0, last) + 0.5) / S.fps;
  }
  $('#play').onclick = () => hasVideo && (vid.paused ? vid.play() : vid.pause());
  $('#back10').onclick = () => step(-10); $('#back1').onclick = () => step(-1); $('#fwd1').onclick = () => step(1); $('#fwd10').onclick = () => step(10);
  $('#scrub').oninput = e => { if(hasVideo){ vid.pause(); vid.currentTime = +e.target.value; } };
  $('#rate').onchange = e => vid.playbackRate = +e.target.value;
  $('#pick').onclick = $('#relink').onclick = async () => useVideo(await window.bullpen.chooseVideo());
  ['dragenter','dragover'].forEach(ev => stages.addEventListener(ev, e => { e.preventDefault(); stages.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => stages.addEventListener(ev, e => { e.preventDefault(); stages.classList.remove('drag'); }));
  stages.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if(f) useVideo(window.bullpen.pathForFile(f)); });

  const ro = new ResizeObserver(() => viewer.resize()); ro.observe($('#paneFull')); ro.observe($('#paneCrop'));

  /* ---------- full-frame pane: move and resize the crop box ---------- */
  cvFull.addEventListener('pointerdown', e => {
    if(!hasVideo) return;
    const pt = viewer.toFrameFull(e), cr = viewer.cropRect();
    const inside = pt.x >= cr.x && pt.x <= cr.x + cr.w && pt.y >= cr.y && pt.y <= cr.y + cr.h;
    if(!inside) setCrop({...viewer.crop, cx: pt.x, cy: pt.y}, false);
    dragCrop = {dx: pt.x - viewer.crop.cx, dy: pt.y - viewer.crop.cy}; cvFull.setPointerCapture(e.pointerId);
  });
  cvFull.addEventListener('pointermove', e => {
    if(!dragCrop) return; const pt = viewer.toFrameFull(e);
    setCrop({...viewer.crop, cx: pt.x - dragCrop.dx, cy: pt.y - dragCrop.dy}, false);
  });
  cvFull.addEventListener('pointerup', () => { if(dragCrop){ dragCrop = null; setCrop(viewer.crop); } });
  cvFull.addEventListener('wheel', e => { if(!hasVideo) return; e.preventDefault(); setCrop({...viewer.crop, w: viewer.crop.w * (e.deltaY > 0 ? 1.15 : 1/1.15)}); }, {passive: false});

  /* ---------- crop pane: zoom, pan, draw the zone, mark ---------- */
  let downOnCrop = false;
  cvCrop.addEventListener('wheel', e => {
    if(!hasVideo) return; e.preventDefault();
    const pt = viewer.toFrameCrop(e), k = e.deltaY < 0 ? 1.2 : 1/1.2;
    setCrop({cx: pt.x + (viewer.crop.cx - pt.x)/k, cy: pt.y + (viewer.crop.cy - pt.y)/k, w: viewer.crop.w/k});
  }, {passive: false});
  cvCrop.addEventListener('pointerdown', e => {
    if(!hasVideo) return; downOnCrop = true; cvCrop.setPointerCapture(e.pointerId);
    if(e.shiftKey || e.button === 1){ e.preventDefault(); pan = {x: e.clientX, y: e.clientY, c: {...viewer.crop}, s: viewer.cropScale()}; return; }
    if(mode === 'zone' && !editField && !selectedId){ const p = viewer.toFrameCrop(e); dragZone = {x:p.x, y:p.y, w:0, h:0, sx:p.x, sy:p.y}; }
  });
  cvCrop.addEventListener('pointermove', e => {
    if(pan){ setCrop({...pan.c, cx: pan.c.cx - (e.clientX - pan.x)/pan.s, cy: pan.c.cy - (e.clientY - pan.y)/pan.s}, false); return; }
    if(dragZone){ const p = viewer.toFrameCrop(e);
      Object.assign(dragZone, {x: Math.min(p.x, dragZone.sx), y: Math.min(p.y, dragZone.sy), w: Math.abs(p.x - dragZone.sx), h: Math.abs(p.y - dragZone.sy)}); drawStages(); }
  });
  cvCrop.addEventListener('pointerup', async e => {
    if(!downOnCrop) return; downOnCrop = false;
    if(pan){ pan = null; setCrop(viewer.crop); return; }
    if(dragZone){
      const {x, y, w, h} = dragZone; dragZone = null;
      if(w > 12){ S.zone = {x, y, w, h}; await patchSession({zone: S.zone}); mode = source === 'manual' ? 'manual' : 'target';
        toast(`Zone set · ${fmt(w/17)} px per inch`); frameCatcher(); }
      renderAll(); return;
    }
    mark(viewer.toFrameCrop(e));
  });

  /* ---------- marking ---------- */
  async function mark(pt){
    pt.t = +vid.currentTime.toFixed(3);
    const sel = pitches.find(p => p.id === selectedId);
    if(sel && editField){
      const saved = await db('updatePitch', sel.id, {...sel, [editField]: pt});
      pitches = pitches.map(p => p.id === saved.id ? saved : p); editField = null; refresh(); return;
    }
    if(sel) return;
    if(!S.zone){ mode = 'zone'; toast('Draw the strike zone first so misses can be measured in inches.'); renderAll(); return; }
    if(mode === 'target'){ draft.glove = pt; mode = 'location'; }
    else if(mode === 'manual'){ draft.manual = pt; mode = 'location'; }
    else if(mode === 'location'){ draft.loc = pt; await commit(); return; }
    renderAll();
  }
  async function commit(){
    const p = await db('addPitch', S.id, {type: curType, glove: draft.glove, manual: draft.manual, loc: draft.loc, zone: {...S.zone}});
    pitches.push(p); draft = newDraft(); mode = source === 'manual' ? 'manual' : 'target';
    refresh();
    const m = list.find(x => x.id === p.id).m;
    toast(`#${p.n} ${p.type}: ${m.hit?'hit':'miss'} · ${fmt(m.d)}" · ${m.score} pts`);
  }
  function setSource(v){
    source = v;
    if(!selectedId && hasVideo && S.zone) mode = v === 'manual' ? (draft.manual ? 'location' : 'manual') : (draft.glove || draft.manual ? 'location' : 'target');
    if(selectedId && v === 'manual') editField = 'manual';
    renderAll();
  }
  function undoMark(){
    if(selectedId){ selectedId = null; editField = null; renderAll(); return; }
    if(draft.loc) draft.loc = null;
    else if(mode === 'location' && draft.manual && source === 'manual'){ draft.manual = null; mode = 'manual'; }
    else if(mode === 'location' && draft.glove){ draft.glove = null; draft.manual = null; mode = source === 'manual' ? 'manual' : 'target'; }
    else if(mode === 'manual' && draft.glove){ draft.glove = null; }
    renderAll();
  }
  function manualPreset(armCol, row){
    const z = (pitches.find(p => p.id === selectedId) || {}).zone || S.zone; if(!z){ toast('Draw the strike zone first.'); return; }
    const a = (A.throws === 'R' ? 1 : -1) * (S.cameraView === 'pitcher' ? 1 : -1), col = a > 0 ? armCol : 2 - armCol;
    if(selectedId) editField = 'manual'; else if(mode !== 'manual'){ source = 'manual'; mode = 'manual'; }
    mark({x: z.x + z.w*(col + .5)/3, y: z.y + z.h*(row + .5)/3});
  }

  /* ---------- tagger UI ---------- */
  $('#types').innerHTML = TYPES.map(([k,n]) => `<button class="chip" data-t="${k}"><i style="background:${TCOL[k]}"></i>${k} <span class="hint">${n}</span></button>`).join('');
  $('#types').onclick = async e => {
    const b = e.target.closest('[data-t]'); if(!b) return;
    const sel = pitches.find(p => p.id === selectedId);
    if(sel){ const saved = await db('updatePitch', sel.id, {...sel, type: b.dataset.t}); pitches = pitches.map(p => p.id === saved.id ? saved : p); refresh(); }
    else { curType = b.dataset.t; renderAll(); }
  };
  $('#source').onclick = e => { const b = e.target.closest('button'); b && setSource(b.dataset.v); };
  $('#undoMark').onclick = undoMark;
  $('#redrawZone').onclick = () => { if(!hasVideo){ toast('Load the video to draw a zone.'); return; } selectedId = null; editField = null; mode = 'zone'; renderAll(); };
  $('#frameCatcher').onclick = frameCatcher;
  $('#showAll').onchange = drawStages;
  {
    const rows = ['Up','Mid','Down'], cols = ['Glove','Mid','Arm'];
    let h = '<span></span>' + cols.map(c => `<span class="cl">${c}</span>`).join('');
    rows.forEach((r,ri) => { h += `<span class="cl">${r}</span>` + cols.map((c,ci) => `<button data-c="${ci}" data-r="${ri}" aria-label="${r} ${c} side"></button>`).join(''); });
    $('#zonepick').innerHTML = h;
    $('#zonepick').onclick = e => { const b = e.target.closest('button'); b && manualPreset(+b.dataset.c, +b.dataset.r); };
  }

  function renderTagger(){
    const sel = list.find(p => p.id === selectedId);
    $('#nextN').textContent = sel ? `#${sel.n}` : `#${pitches.length + 1}`;
    $('#clipName').textContent = S.videoPath ? basename(S.videoPath) : 'No video';
    const typeNow = sel ? sel.type : curType;
    $$('#types [data-t]').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === typeNow));
    $$('#source button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === source));
    $('#manualBox').hidden = source !== 'manual';
    const st = (sid, on, done, txt) => { const el = $(sid); el.classList.toggle('on', on); el.classList.toggle('done', done); el.querySelector('span').textContent = txt; };
    st('#stZone', mode === 'zone', !!S.zone, S.zone ? `${fmt(S.zone.w/17)} px/in` : 'Not set');
    st('#stTarget', !sel && (mode === 'target' || mode === 'manual'), !!(draft.glove || draft.manual), draft.manual ? 'Manual ✓' : draft.glove ? 'Glove ✓' : 'Waiting');
    st('#stLoc', !sel && mode === 'location', false, draft.loc ? '✓' : 'Waiting');
    let ins, chip = null;
    if(!hasVideo) ins = 'Load the video for this bullpen to start tagging.';
    else if(sel && editField){ ins = {glove:"Click the catcher's glove on the catcher view.", manual:'Click the intended target, or pick a zone third below.', loc:'Click where the ball was caught.'}[editField]; chip = 'Editing #' + sel.n; }
    else if(sel) ins = `Editing pitch #${sel.n}. Use the buttons below to re-mark it.`;
    else if(mode === 'zone'){ ins = 'Drag the yellow box on the full frame over the catcher. Then, on the catcher view, drag a box over the strike zone, edge to edge across the plate. Its width is the 17-inch ruler.'; chip = 'Draw zone'; }
    else if(mode === 'target'){ ins = 'Step to the frame where the pitcher releases the ball, then click the center of the glove.'; chip = 'Click glove target'; }
    else if(mode === 'manual'){ ins = 'Click the intended target on the catcher view, or pick a zone third below.'; chip = 'Click manual target'; }
    else { ins = 'Step forward to the catch, then click where the ball hits the glove.'; chip = 'Click catch location'; }
    $('#instr').textContent = ins;
    $('#modechip').hidden = !chip; $('#modechip').textContent = chip || '';
    $('#undoMark').textContent = sel ? 'Done editing' : 'Undo mark';
    renderEdit(sel);
  }
  function renderEdit(p){
    const box = $('#editBox'); box.hidden = !p; if(!p) return;
    const m = p.m;
    box.innerHTML = `
      <div class="panel-h"><b>Pitch #${p.n} · ${TNAME[p.type]}</b><span class="pill ${tone(m.score)}">${m.score} pts · ${fmt(m.d)}" ${m.dir.toLowerCase()}</span></div>
      <div class="row"><button class="btn sm" data-a="jumpT">Go to target frame</button><button class="btn sm" data-a="jumpL">Go to catch frame</button></div>
      <div class="row">
        <button class="btn sm" data-a="glove" ${hasVideo?'':'disabled'}>Re-mark glove</button>
        <button class="btn sm" data-a="manual">${p.manual?'Move':'Set'} manual target</button>
        ${p.manual && p.glove ? '<button class="btn sm" data-a="clearM">Use glove instead</button>' : ''}
        <button class="btn sm" data-a="loc" ${hasVideo?'':'disabled'}>Re-mark location</button>
        <button class="btn sm danger" data-a="del">${confirmDel?'Tap again to delete':'Delete'}</button>
      </div>
      ${m.setupOff != null ? `<span class="hint">Catcher set up ${fmt(m.setupOff)}" from the intended target.</span>` : ''}`;
    box.onclick = async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if(!a) return;
      const raw = pitches.find(x => x.id === p.id);
      if(a === 'jumpT' && hasVideo) vid.currentTime = (p.manual || p.glove).t;
      else if(a === 'jumpL' && hasVideo) vid.currentTime = p.loc.t;
      else if(a === 'glove' || a === 'loc') editField = a;
      else if(a === 'manual'){ editField = 'manual'; source = 'manual'; }
      else if(a === 'clearM'){ const saved = await db('updatePitch', p.id, {...raw, manual: null}); pitches = pitches.map(x => x.id === saved.id ? saved : x); }
      else if(a === 'del'){
        if(!confirmDel) confirmDel = true;
        else { pitches = await db('deletePitch', p.id); selectedId = null; confirmDel = false; }
      }
      if(a !== 'del') confirmDel = false;
      refresh();
    };
  }

  /* ---------- scoreboard, trends, log ---------- */
  function renderBoard(){
    const s = summary(list);
    if(!s.n){
      $('#bigScore').textContent = '–'; $('#bigScore').style.color = ''; $('#gradePill').className = 'pill neutral'; $('#gradePill').textContent = 'No pitches yet';
      $('#gradeTxt').textContent = 'Tag a pitch to get a score.'; ['#sHit','#sMiss','#sZone','#sN'].forEach(i => $(i).textContent = '–');
      $('#insights').innerHTML = '<li>Trends show up here after a few tagged pitches.</li>'; return;
    }
    const sc = Math.round(s.score), gr = grade(s.score);
    $('#bigScore').textContent = sc; $('#bigScore').style.color = `var(--${tone(sc)})`;
    $('#gradePill').className = 'pill ' + tone(sc); $('#gradePill').textContent = `${gr} grade`; $('#gradeTxt').textContent = GRADE_TXT[gr];
    $('#sHit').textContent = Math.round(s.hit*100) + '%'; $('#sMiss').textContent = fmt(s.d) + '"';
    $('#sZone').textContent = Math.round(s.zone*100) + '%'; $('#sN').textContent = s.n;
    $('#insights').innerHTML = insights(list).map(([t,c]) => `<li class="${c}"><span>${t}</span></li>`).join('');
  }
  function renderTrends(){
    const types = [...new Set(list.map(p => p.type))];
    if(filter !== 'ALL' && !types.includes(filter)) filter = 'ALL';
    $('#filter').innerHTML = `<option value="ALL">All pitches</option>` + types.map(t => `<option value="${t}" ${t===filter?'selected':''}>${TNAME[t]}</option>`).join('');
    const l = filter === 'ALL' ? list : list.filter(p => p.type === filter);
    $('#scatter').innerHTML = scatter(l, S.hitRadius, selectedId); $('#legend').innerHTML = l.length ? legend(l) : '';
    $('#heat').innerHTML = heat(l); $('#trend').innerHTML = rollingTrend(l); $('#typeTbl').innerHTML = typeTable(list);
  }
  $('#filter').onchange = e => { filter = e.target.value; renderTrends(); };
  function renderLog(){
    if(!list.length){ $('#log').innerHTML = '<div class="empty">No pitches tagged yet. Mark the glove, then the catch, and each pitch lands here.</div>'; return; }
    $('#log').innerHTML = `<table><thead><tr><th>#</th><th>Pitch</th><th>Target</th><th class="num">Miss</th><th class="num">Arm/Glove</th><th class="num">Up/Down</th><th>Direction</th><th>Zone</th><th class="num">Score</th></tr></thead><tbody>` +
      list.slice().reverse().map(p => { const m = p.m;
        return `<tr class="click ${p.id===selectedId?'sel':''}" data-id="${p.id}"><td class="mono">${p.n}</td><td><span class="dot" style="background:${TCOL[p.type]}"></span>${p.type}</td>
        <td>${p.manual?'<span class="pill warn">Manual</span>':'<span class="pill neutral">Glove</span>'}</td>
        <td class="num mono">${fmt(m.d)}"</td><td class="num mono">${m.arm>=0?'A':'G'} ${fmt(Math.abs(m.arm))}"</td><td class="num mono">${m.up>=0?'U':'D'} ${fmt(Math.abs(m.up))}"</td>
        <td>${m.dir}</td><td>${m.inZone?'In':'<span style="color:var(--bad)">Out</span>'}</td><td class="num"><span class="pill ${tone(m.score)}">${m.score}</span></td></tr>`; }).join('') + '</tbody></table>';
  }
  $('#log').onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if(!tr) return;
    const pid = +tr.dataset.id; selectedId = selectedId === pid ? null : pid; editField = null; confirmDel = false;
    const p = pitches.find(x => x.id === selectedId);
    if(p){ source = p.manual ? 'manual' : 'glove'; if(hasVideo) vid.currentTime = p.loc.t; }
    renderAll(); $('#tagger').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  };
  function csv(){
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const head = 'athlete,date,pitch,type,target_source,miss_in,arm_side_in,up_in,direction,in_zone,hit,score,setup_offset_in,catch_time_s';
    return [head, ...list.map(p => { const m = p.m; return [q(A.name), S.recordedOn, p.n, p.type, p.manual?'manual':'glove', fmt(m.d,2), fmt(m.arm,2), fmt(m.up,2), m.dir, m.inZone, m.hit, m.score, m.setupOff==null?'':fmt(m.setupOff,2), p.loc.t].join(','); })].join('\n');
  }
  $('#copyCsv').onclick = async () => {
    const text = csv(), box = $('#csvBox');
    try{ await navigator.clipboard.writeText(text); toast(`Copied ${list.length} pitches as CSV`); box.hidden = true; }
    catch{ box.hidden = false; box.value = text; box.focus(); box.select(); toast('Copy failed. The CSV is selected below, press ⌘C.'); }
  };
  confirmTap($('#delSession'), 'Tap again to delete this session', async () => { await db('deleteSession', S.id); location.hash = '#/athlete/' + A.id; });

  /* ---------- settings ---------- */
  function renderSettings(){ $('#date').value = S.recordedOn; $('#view').value = S.cameraView; $('#hitR').value = S.hitRadius; $('#fps').value = S.fps; }
  $('#date').onchange = async e => { if(!e.target.value) return; await patchSession({recordedOn: e.target.value}); $('h1').textContent = `${fmtDate(S.recordedOn)} bullpen`; };
  $('#view').onchange = async e => { await patchSession({cameraView: e.target.value}); refresh(); };
  $('#hitR').onchange = async e => { await patchSession({hitRadius: clamp(+e.target.value || 6, 2, 12)}); refresh(); };
  $('#fps').onchange = async e => { await patchSession({fps: +e.target.value}); syncTime(); };

  function onKey(e){
    if(e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if(k === ' '){ e.preventDefault(); $('#play').click(); }
    else if(k === 'arrowleft'){ e.preventDefault(); step(e.shiftKey ? -10 : -1); }
    else if(k === 'arrowright'){ e.preventDefault(); step(e.shiftKey ? 10 : 1); }
    else if(k === 'g') setSource('glove');
    else if(k === 'm') setSource('manual');
    else if(k === 'z') $('#redrawZone').click();
    else if(k === 'c') frameCatcher();
    else if(k === 'backspace'){ e.preventDefault(); undoMark(); }
    else if(k === 'escape'){ selectedId = null; editField = null; renderAll(); }
  }
  document.addEventListener('keydown', onKey);

  function renderAll(){ renderSettings(); renderTagger(); renderBoard(); renderTrends(); renderLog(); drawStages(); }
  loadVideo(); refresh();

  return () => {
    document.removeEventListener('keydown', onKey); ro.disconnect(); cancelAnimationFrame(raf);
    const crop = viewer.flush(); if(crop && hasVideo) db('updateSession', S.id, {crop});
    vid.pause(); vid.removeAttribute('src'); vid.load();
  };
}
