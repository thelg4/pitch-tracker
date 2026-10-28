// Session view: tag one bullpen video. The viewer (viewer.js) draws the full frame and the catcher crop;
// this controller owns the tagging state, the pointer and key handling, the title-bar tool control and HUD,
// and the panels below the viewer. The title-bar slots belong to the shell, so they are the only nodes
// queried outside `root`.
import { TYPES, TCOL, TNAME, clamp, fmt, scored, summary, grade, tone, GRADE_TXT, insights } from '../scoring.js';
import { scatter, legend, heat, rollingTrend, typeTable } from '../charts.js';
import { setTitle, setToolbar } from '../shell.js';
import { countTo, replayClass, reducedMotion } from '../motion.js';
import { toolState } from '../ui-logic.js';
import { $, $$, db, fmtDate, handLabel, toast, confirmTap, mediaUrl, basename } from '../util.js';
import { createViewer } from './viewer.js';
import { renderTimeline, renderList } from './timeline.js';

const TOOLS = [['zone', 'Zone', 'Z'], ['target', 'Target', 'G'], ['manual', 'Manual', 'M'], ['catch', 'Catch', '']];

export async function sessionView(root, id){
  const data = await db('getSession', id);
  if(!root.isConnected) return;
  if(!data){ root.innerHTML = '<div class="empty">That session no longer exists. <a href="#/">Back to athletes</a></div>'; return; }
  let {session: S, athlete: A, pitches} = data;
  const settings = () => ({hand: A.throws, view: S.cameraView, hitR: S.hitRadius});
  let list = [];
  let draft = newDraft(), mode = S.zone ? 'target' : 'zone', source = 'glove', curType = 'FB';
  let selectedId = null, editField = null, confirmDel = false, filter = 'ALL', hasVideo = false;
  let dragZone = null, dragCrop = null, pan = null, raf = 0, popT = 0, pillPlaced = false;
  function newDraft(){ return {glove:null, manual:null, loc:null}; }
  const q = sel => $(sel, root), qq = sel => $$(sel, root);

  root.classList.add('session');
  root.innerHTML = `
    <section class="sv">
      <div class="stages" id="stages">
        <div class="pane full" id="paneFull" style="aspect-ratio:9/16" title="Drag the box over the catcher · scroll to resize it"><canvas id="cvFull"></canvas><span class="tag">Full frame</span></div>
        <div class="pane crop" id="paneCrop"><canvas id="cvCrop"></canvas><i class="pop" id="pop" hidden></i><div class="hud" id="hud" role="status"></div><span class="tag">Catcher view</span></div>
        <div class="drop" id="drop" hidden><strong id="dropTitle"></strong><span id="dropTxt"></span><button class="btn primary" id="pick">Choose Video</button></div>
        <video id="vid" class="vid" muted playsinline preload="auto" crossorigin="anonymous"></video>
      </div>
      <div class="transport">
        <div class="tp-btns">
          <button class="tp" id="back10" title="Back 10 frames (Shift + ←)" aria-label="Back 10 frames">−10</button>
          <button class="tp" id="back1" title="Back 1 frame (←)" aria-label="Back 1 frame">◀︎ 1</button>
          <button class="tp play" id="play" title="Play / pause (Space)" aria-label="Play">▶︎</button>
          <button class="tp" id="fwd1" title="Forward 1 frame (→)" aria-label="Forward 1 frame">1 ▶︎</button>
          <button class="tp" id="fwd10" title="Forward 10 frames (Shift + →)" aria-label="Forward 10 frames">+10</button>
          <select id="rate" class="btn sm" aria-label="Playback speed"><option value="1">1×</option><option value="0.5">0.5×</option><option value="0.25" selected>0.25×</option><option value="0.1">0.1×</option></select>
        </div>
        <input type="range" id="scrub" min="0" max="1" step="0.001" value="0" aria-label="Video position">
        <span class="time" id="time">0:00.00</span>
      </div>
      <div class="tl">
        <div class="tlh"><div class="seg" id="viewToggle" role="group" aria-label="Pitch view"><button type="button" data-v="timeline">Timeline</button><button type="button" data-v="list">List</button></div><span class="hint" id="tlHint"></span></div>
        <div id="timeline"></div>
        <div class="tbl" id="log" hidden></div>
      </div>
    </section>

    <div class="below">
      <div class="hintbar">
        <div class="row hint">
          <span><span class="kbd">Space</span> play</span><span><span class="kbd">←</span><span class="kbd">→</span> frame step</span>
          <span><span class="kbd">C</span> frame catcher</span><span><span class="kbd">⌫</span> undo mark</span>
          <span>Scroll to zoom · <span class="kbd">Shift</span>+drag to pan</span>
        </div>
        <div class="row">
          <button class="btn sm" id="frameCatcher" title="Center the catcher view on the zone (C)">Frame Catcher</button>
          <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="showAll" checked> Show all pitches</label>
          <button class="btn sm" id="relink" title="Point this session at the video file again if it moved">Relink Video</button>
        </div>
      </div>

      <section class="bench">
        <div class="panel" id="tagger">
          <div class="panel-h"><h2>Tag pitch <span class="num" id="nextN">#1</span></h2><span class="hint" id="clipName"></span></div>
          <div class="field"><span class="lbl">Pitch type</span><div class="chips" id="types"></div></div>
          <div id="manualBox" class="field" hidden><span class="lbl">Quick manual target (or click the catcher view)</span><div class="zonepick" id="zonepick"></div></div>
          <div class="row">
            <button class="btn sm" id="undoMark">Undo mark</button>
            <button class="btn sm" id="redrawZone">Redraw zone</button>
          </div>
          <div class="edit" id="editBox" hidden></div>
          <p class="hint" style="margin:0">Catcher set up in the wrong spot? Mark the glove, then switch to <b>Manual</b> and click where the ball was supposed to go. The manual target is what gets scored; the glove spot is kept so you can see how far off the setup was.</p>
          <div class="setup">
            <label class="field"><span class="lbl">Date</span><input type="date" id="date"></label>
            <label class="field"><span class="lbl">Camera</span><select id="view"><option value="pitcher">Behind pitcher</option><option value="catcher">Behind catcher</option></select></label>
            <label class="field"><span class="lbl">Hit radius (in)</span><input id="hitR" type="number" min="2" max="12" step="0.5"></label>
            <label class="field"><span class="lbl">Video fps</span><select id="fps"><option>30</option><option>60</option><option>120</option><option>240</option></select></label>
          </div>
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
        <div class="panel-h"><h2>Export</h2>
          <div class="row"><button class="btn sm" id="copyCsv">Copy CSV</button><button class="btn sm danger" id="delSession">Delete session</button></div></div>
        <textarea class="csv" id="csvBox" hidden readonly aria-label="CSV export"></textarea>
      </section>
    </div>`;

  // The tool control lives in the title bar (a shell slot). The pill slides under the active segment.
  setToolbar({center: `<div class="tools" id="tools" role="group" aria-label="Tool"><i class="tool-pill" aria-hidden="true"></i>${
    TOOLS.map(([t, label, key]) => `<button type="button" data-tool="${t}" aria-pressed="false"${key ? ` title="${label} (${key})"` : ''}>${label}${key ? `<span class="k">${key}</span>` : ''}</button>`).join('')}</div>`});
  const tools = document.getElementById('tools');
  const renderTitle = () => setTitle(`${fmtDate(S.recordedOn)} Bullpen`, `${A.name} · ${handLabel(A.throws)} · ${S.fps} fps`);
  renderTitle();

  const vid = q('#vid'), cvFull = q('#cvFull'), cvCrop = q('#cvCrop'), stages = q('#stages');
  const viewer = createViewer({fullCanvas: cvFull, cropCanvas: cvCrop, video: vid,
    getSession: () => S, getList: () => list, getDraft: () => ({...draft, type: curType}), getSelectedId: () => selectedId,
    getDragZone: () => dragZone, getHasVideo: () => hasVideo, getShowAll: () => q('#showAll').checked,
    onCropSave: crop => patchSession({crop})});
  const drawStages = () => viewer.draw(), setCrop = (c, persist) => viewer.setCrop(c, persist), frameCatcher = () => viewer.frameCatcher();

  /* ---------- saving ---------- */
  async function patchSession(patch){ S = await db('updateSession', S.id, patch); }
  function refresh(){ list = scored(pitches, settings()); renderAll(); }

  /* ---------- video ---------- */
  function showDrop(title, txt){ q('#drop').hidden = false; q('#dropTitle').textContent = title; q('#dropTxt').textContent = txt; }
  function loadVideo(){
    hasVideo = false;
    if(!S.videoPath){ showDrop('Choose the bullpen video', 'Film from behind the pitcher with the catcher in view. Drop the file here or choose it.'); return; }
    q('#drop').hidden = true; vid.src = mediaUrl(S.videoPath); vid.playbackRate = +q('#rate').value;
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
    q('#paneFull').style.aspectRatio = `${vid.videoWidth}/${vid.videoHeight}`;
    q('#scrub').max = vid.duration;
    viewer.ensureCrop();
    viewer.resize(); refresh();
  });
  vid.addEventListener('error', () => {
    hasVideo = false;
    showDrop("Can't open this video", `${basename(S.videoPath)} was moved, deleted, or isn't a format this app can play. Choose it again.`);
    renderTagger();
  });
  vid.addEventListener('seeked', () => { syncTime(); drawStages(); });
  vid.addEventListener('play', () => { setPlayIcon(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  vid.addEventListener('pause', () => { setPlayIcon(false); syncTime(); drawStages(); });
  function setPlayIcon(playing){ const b = q('#play'); b.textContent = playing ? '❚❚' : '▶︎'; b.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
  function tick(){ syncTime(); drawStages(); if(!vid.paused && !vid.ended) raf = requestAnimationFrame(tick); }

  const frameOf = t => Math.floor(t*S.fps + 1e-6);
  function syncTime(){ const t = vid.currentTime; tl?.setPlayhead(t); q('#scrub').value = t; q('#time').textContent = `${Math.floor(t/60)}:${(t%60).toFixed(2).padStart(5,'0')} · f${frameOf(t)}`; }
  // Seek to the middle of the target frame so rounding never lands on its neighbor.
  function step(n){
    if(!hasVideo) return; vid.pause();
    const last = Math.max(0, Math.floor(vid.duration*S.fps) - 1);
    vid.currentTime = (clamp(frameOf(vid.currentTime) + n, 0, last) + 0.5) / S.fps;
  }
  q('#play').onclick = () => hasVideo && (vid.paused ? vid.play() : vid.pause());
  q('#back10').onclick = () => step(-10); q('#back1').onclick = () => step(-1); q('#fwd1').onclick = () => step(1); q('#fwd10').onclick = () => step(10);
  q('#scrub').oninput = e => { if(hasVideo){ vid.pause(); vid.currentTime = +e.target.value; } };
  q('#rate').onchange = e => vid.playbackRate = +e.target.value;
  q('#pick').onclick = q('#relink').onclick = async () => useVideo(await window.bullpen.chooseVideo());
  ['dragenter','dragover'].forEach(ev => stages.addEventListener(ev, e => { e.preventDefault(); stages.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => stages.addEventListener(ev, e => { e.preventDefault(); stages.classList.remove('drag'); }));
  stages.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if(f) useVideo(window.bullpen.pathForFile(f)); });

  const ro = new ResizeObserver(() => viewer.resize()); ro.observe(q('#paneFull')); ro.observe(q('#paneCrop'));

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
    refresh(); popAt(p);
    const m = list.find(x => x.id === p.id).m;
    toast(`#${p.n} ${p.type}: ${m.hit?'hit':'miss'} · ${fmt(m.d)}" · ${m.score} pts`);
  }
  // The ball marker is drawn on the canvas, which can't animate one mark, so a DOM disc pops over it.
  function popAt(p){
    if(reducedMotion()) return;
    const el = q('#pop'), {x, y, s} = viewer.toCropPx(p.loc), d = 2*1.45*(p.zone.w/17)*s;
    Object.assign(el.style, {left: `${x - d/2}px`, top: `${y - d/2}px`, width: `${d}px`, height: `${d}px`, background: TCOL[p.type] || '#fff'});
    el.hidden = false; replayClass(el, 'go');
    clearTimeout(popT); popT = setTimeout(() => { el.hidden = true; el.classList.remove('go'); }, 520);
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
  q('#types').innerHTML = TYPES.map(([k,n]) => `<button class="chip" data-t="${k}"><i style="background:${TCOL[k]}"></i>${k} <span class="hint">${n}</span></button>`).join('');
  q('#types').onclick = async e => {
    const b = e.target.closest('[data-t]'); if(!b) return;
    const sel = pitches.find(p => p.id === selectedId);
    if(sel){ const saved = await db('updatePitch', sel.id, {...sel, type: b.dataset.t}); pitches = pitches.map(p => p.id === saved.id ? saved : p); refresh(); }
    else { curType = b.dataset.t; renderAll(); }
  };
  function redrawZone(){ if(!hasVideo){ toast('Load the video to draw a zone.'); return; } selectedId = null; editField = null; mode = 'zone'; renderAll(); }
  // Zone, Target and Manual act like Z, G and M. Catch is reached by placing a target, so clicking it does nothing.
  const TOOL_ACTION = {zone: redrawZone, target: () => setSource('glove'), manual: () => setSource('manual')};
  tools.onclick = e => { const b = e.target.closest('[data-tool]'); if(b && !b.disabled) TOOL_ACTION[b.dataset.tool]?.(); };
  q('#undoMark').onclick = undoMark;
  q('#redrawZone').onclick = redrawZone;
  q('#frameCatcher').onclick = frameCatcher;
  q('#showAll').onchange = drawStages;
  {
    const rows = ['Up','Mid','Down'], cols = ['Glove','Mid','Arm'];
    let h = '<span></span>' + cols.map(c => `<span class="cl">${c}</span>`).join('');
    rows.forEach((r,ri) => { h += `<span class="cl">${r}</span>` + cols.map((c,ci) => `<button data-c="${ci}" data-r="${ri}" aria-label="${r} ${c} side"></button>`).join(''); });
    q('#zonepick').innerHTML = h;
    q('#zonepick').onclick = e => { const b = e.target.closest('button'); b && manualPreset(+b.dataset.c, +b.dataset.r); };
  }

  function renderTagger(){
    const sel = list.find(p => p.id === selectedId);
    q('#nextN').textContent = sel ? `#${sel.n}` : `#${pitches.length + 1}`;
    q('#clipName').textContent = S.videoPath ? basename(S.videoPath) : 'No video';
    const typeNow = sel ? sel.type : curType;
    qq('#types [data-t]').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === typeNow));
    q('#manualBox').hidden = source !== 'manual';
    const ts = toolState({mode, hasZone: !!S.zone, hasVideo, draft, selected: sel ? {n: sel.n} : null, editField});
    q('#hud').textContent = ts.hud;
    renderTools(ts);
    q('#undoMark').textContent = sel ? 'Done editing' : 'Undo mark';
    renderEdit(sel);
  }
  function renderTools({active, catchEnabled}){
    let on = null;
    tools.querySelectorAll('[data-tool]').forEach(b => {
      const t = b.dataset.tool, pressed = t === active;
      b.setAttribute('aria-pressed', pressed); if(pressed) on = b;
      if(t === 'catch') b.disabled = !catchEnabled;
    });
    const pill = tools.querySelector('.tool-pill');
    pill.classList.toggle('off', !on);
    if(!on) return;
    // The first placement jumps into position; later ones slide with the spring (CSS skips it for reduced motion).
    if(!pillPlaced){ pill.classList.add('still'); void pill.offsetWidth; }
    pill.style.left = on.offsetLeft + 'px'; pill.style.width = on.offsetWidth + 'px';
    if(!pillPlaced){ void pill.offsetWidth; pill.classList.remove('still'); pillPlaced = true; }
  }
  function renderEdit(p){
    const box = q('#editBox'); box.hidden = !p; if(!p) return;
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
      q('#bigScore').textContent = '–'; q('#bigScore').style.color = ''; q('#gradePill').className = 'pill neutral'; q('#gradePill').textContent = 'No pitches yet';
      q('#gradeTxt').textContent = 'Tag a pitch to get a score.'; ['#sHit','#sMiss','#sZone','#sN'].forEach(i => q(i).textContent = '–');
      q('#insights').innerHTML = '<li>Trends show up here after a few tagged pitches.</li>'; return;
    }
    const sc = Math.round(s.score), gr = grade(s.score);
    countTo(q('#bigScore'), sc); q('#bigScore').style.color = `var(--${tone(sc)})`;
    q('#gradePill').className = 'pill ' + tone(sc); q('#gradePill').textContent = `${gr} grade`; q('#gradeTxt').textContent = GRADE_TXT[gr];
    q('#sHit').textContent = Math.round(s.hit*100) + '%'; q('#sMiss').textContent = fmt(s.d) + '"';
    q('#sZone').textContent = Math.round(s.zone*100) + '%'; q('#sN').textContent = s.n;
    q('#insights').innerHTML = insights(list).map(([t,c]) => `<li class="${c}"><span>${t}</span></li>`).join('');
  }
  function renderTrends(){
    const types = [...new Set(list.map(p => p.type))];
    if(filter !== 'ALL' && !types.includes(filter)) filter = 'ALL';
    q('#filter').innerHTML = `<option value="ALL">All pitches</option>` + types.map(t => `<option value="${t}" ${t===filter?'selected':''}>${TNAME[t]}</option>`).join('');
    const l = filter === 'ALL' ? list : list.filter(p => p.type === filter);
    q('#scatter').innerHTML = scatter(l, S.hitRadius, selectedId); q('#legend').innerHTML = l.length ? legend(l) : '';
    q('#heat').innerHTML = heat(l); q('#trend').innerHTML = rollingTrend(l); q('#typeTbl').innerHTML = typeTable(list);
  }
  q('#filter').onchange = e => { filter = e.target.value; renderTrends(); };
  /* ---------- timeline and list ---------- */
  let tl = null, view = 'timeline';
  try{ if(localStorage.getItem('bullpen.view') === 'list') view = 'list'; }catch{}
  function setView(v){
    view = v;
    try{ localStorage.setItem('bullpen.view', v); }catch{}
    q('#timeline').hidden = v !== 'timeline'; q('#log').hidden = v !== 'list';
    qq('#viewToggle [data-v]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
  }
  q('#viewToggle').onclick = e => { const b = e.target.closest('[data-v]'); if(b) setView(b.dataset.v); };
  // Clicking a clip or a row selects that pitch (clicking it again deselects) and seeks to its catch frame.
  function selectPitch(pid){
    selectedId = selectedId === pid ? null : pid; editField = null; confirmDel = false;
    const p = pitches.find(x => x.id === selectedId);
    if(p){ source = p.manual ? 'manual' : 'glove'; if(hasVideo) vid.currentTime = p.loc.t; }
    renderAll(); q('#tagger').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }
  function renderTL(){
    q('#tlHint').textContent = `${list.length} pitch${list.length === 1 ? '' : 'es'} · drag to scrub · click a pitch to jump`;
    tl = renderTimeline(q('#timeline'), list, vid.duration, {selectedId, onSelect: selectPitch,
      onScrub: t => { if(hasVideo){ vid.pause(); vid.currentTime = t; } }});
    tl.setPlayhead(vid.currentTime || 0);
    renderList(q('#log'), list, {selectedId, onSelect: selectPitch});
  }
  function csv(){
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const head = 'athlete,date,pitch,type,target_source,miss_in,arm_side_in,up_in,direction,in_zone,hit,score,setup_offset_in,catch_time_s';
    return [head, ...list.map(p => { const m = p.m; return [q(A.name), S.recordedOn, p.n, p.type, p.manual?'manual':'glove', fmt(m.d,2), fmt(m.arm,2), fmt(m.up,2), m.dir, m.inZone, m.hit, m.score, m.setupOff==null?'':fmt(m.setupOff,2), p.loc.t].join(','); })].join('\n');
  }
  q('#copyCsv').onclick = async () => {
    const text = csv(), box = q('#csvBox');
    try{ await navigator.clipboard.writeText(text); toast(`Copied ${list.length} pitches as CSV`); box.hidden = true; }
    catch{ box.hidden = false; box.value = text; box.focus(); box.select(); toast('Copy failed. The CSV is selected below, press ⌘C.'); }
  };
  confirmTap(q('#delSession'), 'Tap again to delete this session', async () => { await db('deleteSession', S.id); location.hash = '#/athlete/' + A.id; });

  /* ---------- settings ---------- */
  function renderSettings(){ q('#date').value = S.recordedOn; q('#view').value = S.cameraView; q('#hitR').value = S.hitRadius; q('#fps').value = S.fps; }
  q('#date').onchange = async e => { if(!e.target.value) return; await patchSession({recordedOn: e.target.value}); renderTitle(); };
  q('#view').onchange = async e => { await patchSession({cameraView: e.target.value}); refresh(); };
  q('#hitR').onchange = async e => { await patchSession({hitRadius: clamp(+e.target.value || 6, 2, 12)}); refresh(); };
  q('#fps').onchange = async e => { await patchSession({fps: +e.target.value}); syncTime(); renderTitle(); };

  function onKey(e){
    if(e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if(k === ' '){ e.preventDefault(); q('#play').click(); }
    else if(k === 'arrowleft'){ e.preventDefault(); step(e.shiftKey ? -10 : -1); }
    else if(k === 'arrowright'){ e.preventDefault(); step(e.shiftKey ? 10 : 1); }
    else if(k === 'g') setSource('glove');
    else if(k === 'm') setSource('manual');
    else if(k === 'z') redrawZone();
    else if(k === 'c') frameCatcher();
    else if(k === 'backspace'){ e.preventDefault(); undoMark(); }
    else if(k === 'escape'){ selectedId = null; editField = null; renderAll(); }
  }
  document.addEventListener('keydown', onKey);

  function renderAll(){ renderSettings(); renderTagger(); renderBoard(); renderTrends(); renderTL(); drawStages(); }
  vid.addEventListener('timeupdate', syncTime);
  setView(view);
  loadVideo(); refresh();

  function cleanup(){
    document.removeEventListener('keydown', onKey); ro.disconnect(); cancelAnimationFrame(raf); clearTimeout(popT);
    const crop = viewer.flush(); if(crop && hasVideo) db('updateSession', S.id, {crop});
    vid.pause(); vid.removeAttribute('src'); vid.load();
  }
  // Task 9 wires the rest of the session's menu actions into onMenu.
  return {cleanup, onMenu(a){ if(a === 'toggle-list') setView(view === 'list' ? 'timeline' : 'list'); }};
}
