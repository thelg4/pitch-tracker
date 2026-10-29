// Session view: tag one bullpen video. The viewer (viewer.js) draws the full frame and the catcher crop,
// the timeline (timeline.js) shows the pitches, and the inspector (inspector.js) holds the Pitch and Session
// tabs. This controller owns the tagging state, the pointer and key handling, the title-bar tool control and
// HUD, and the session's menu actions. The shell's slots (#tbCenter, #tbRight, #inspector) are the only
// nodes queried outside `root`.
import { PCOL } from '../colors.js';
import { TNAME, clamp, fmt, scored } from '../scoring.js';
import { setTitle, setToolbar, setInspector, togglePanel } from '../shell.js';
import { openSheet } from '../sheets.js';
import { replayClass, reducedMotion, settleCount } from '../motion.js';
import { toolState } from '../ui-logic.js';
import { $, $$, db, esc, fmtDate, handLabel, toast, mediaUrl, basename, showAllPref } from '../util.js';
import { createViewer } from './viewer.js';
import { renderTimeline, renderList } from './timeline.js';
import { renderPitchTab, renderSessionTab } from './inspector.js';

const TOOLS = [['zone', 'Zone', 'Z'], ['target', 'Target', 'G'], ['manual', 'Manual', 'M'], ['catch', 'Catch', '']];

export async function sessionView(root, id, ctx){
  const data = await db('getSession', id);
  if(!root.isConnected) return;
  if(!data){ root.innerHTML = '<div class="empty">That session no longer exists. <a href="#/">Back to athletes</a></div>'; return; }
  let {session: S, athlete: A, pitches} = data;
  const settings = () => ({hand: A.throws, view: S.cameraView, hitR: S.hitRadius});
  let list = [];
  let draft = newDraft(), mode = S.zone ? 'target' : 'zone', source = 'glove', curType = 'FB';
  let selectedId = null, editField = null, filter = 'ALL', hasVideo = false, showAll = showAllPref(), tab = 'pitch', dead = false;
  let dragZone = null, dragCrop = null, pan = null, raf = 0, popT = 0, pillPlaced = false, tl = null, view = 'timeline';
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
    </section>`;

  // The tool control lives in the title bar (a shell slot). The pill slides under the active segment.
  setToolbar({center: `<div class="tools" id="tools" role="group" aria-label="Tool"><i class="tool-pill" aria-hidden="true"></i>${
    TOOLS.map(([t, label, key]) => `<button type="button" data-tool="${t}" aria-pressed="false"${key ? ` title="${label} (${key})"` : ''}>${label}${key ? `<span class="k">${key}</span>` : ''}</button>`).join('')}</div>`,
    right: '<button type="button" class="ib" id="exportCsv" title="Export CSV (⌘E)" aria-label="Export CSV">⇪</button>'});
  const tools = document.getElementById('tools');

  // The inspector (a shell slot): Pitch and Session tabs, rendered by inspector.js.
  setInspector(`<div class="insp">
    <div class="itabs" id="itabs" role="tablist" aria-label="Inspector">
      <button type="button" role="tab" data-tab="pitch" aria-controls="inspPitch" title="Pitch (⌘1)">Pitch</button>
      <button type="button" role="tab" data-tab="session" aria-controls="inspSession" title="Session (⌘2)">Session</button></div>
    <div class="ipane" id="inspPitch" role="tabpanel"></div>
    <div class="ipane" id="inspSession" role="tabpanel" hidden></div></div>`);
  const insp = document.getElementById('inspector'), iq = sel => $(sel, insp);
  function setTab(t){
    tab = t;
    iq('#inspPitch').hidden = t !== 'pitch'; iq('#inspSession').hidden = t !== 'session';
    if(t === 'session') renderSessionPane(); // it is only kept current while shown
    insp.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  }
  iq('#itabs').onclick = e => { const b = e.target.closest('[data-tab]'); if(b) setTab(b.dataset.tab); };
  setTab(tab);
  const renderTitle = () => setTitle(`${fmtDate(S.recordedOn)} Bullpen`, `${A.name} · ${handLabel(A.throws)} · ${S.fps} fps`);
  renderTitle();

  const vid = q('#vid'), cvFull = q('#cvFull'), cvCrop = q('#cvCrop'), stages = q('#stages');
  const viewer = createViewer({fullCanvas: cvFull, cropCanvas: cvCrop, video: vid,
    getSession: () => S, getList: () => list, getDraft: () => ({...draft, type: curType}), getSelectedId: () => selectedId,
    getDragZone: () => dragZone, getHasVideo: () => hasVideo, getShowAll: () => showAll,
    onCropSave: crop => patchSession({crop})});
  const drawStages = () => viewer.draw(), setCrop = (c, persist) => viewer.setCrop(c, persist), frameCatcher = () => viewer.frameCatcher();

  /* ---------- saving ---------- */
  async function patchSession(patch){ S = await db('updateSession', S.id, patch); }
  function refresh(){ list = scored(pitches, settings()); renderAll(); }
  // A pitch was added, edited or deleted: rescore, redraw, and refresh the sidebar's session score.
  function pitchesChanged(){ refresh(); ctx.refreshSidebar(); }
  async function savePitch(data){
    const saved = await db('updatePitch', data.id, data); if(dead) return;
    pitches = pitches.map(p => p.id === saved.id ? saved : p); pitchesChanged();
  }

  /* ---------- video ---------- */
  function showDrop(title, txt){ q('#drop').hidden = false; q('#dropTitle').textContent = title; q('#dropTxt').textContent = txt; }
  function showMissing(){
    if(dead) return;
    hasVideo = false;
    showDrop("Can't open this video", `${basename(S.videoPath)} was moved, deleted, or isn't a format this app can play. Choose it again.`);
    renderAll();
  }
  async function loadVideo(){
    hasVideo = false;
    if(!S.videoPath){ showDrop('Choose the bullpen video', 'Film from behind the pitcher with the catcher in view. Drop the file here or choose it.'); return; }
    // Check first: a file that is gone is the common case, and requesting it would only log a 404.
    const exists = await window.bullpen.videoExists(S.videoPath); if(dead) return;
    if(!exists){ showMissing(); return; }
    q('#drop').hidden = true; vid.src = mediaUrl(S.videoPath); vid.playbackRate = +q('#rate').value;
  }
  async function useVideo(file){
    if(!file) return;
    if(!await window.bullpen.allowVideo(file)){ toast('That file is not a video. Choose an .mp4 or .mov.'); return; }
    await patchSession({videoPath: file, title: basename(file)}); if(dead) return; loadVideo(); renderAll();
  }
  vid.addEventListener('loadedmetadata', async () => {
    if(S.frameW !== vid.videoWidth || S.frameH !== vid.videoHeight){
      const d = await db('rescaleSession', S.id, vid.videoWidth, vid.videoHeight); if(dead) return;
      S = d.session; pitches = d.pitches; viewer.crop = S.crop;
    }
    hasVideo = true;
    q('#paneFull').style.aspectRatio = `${vid.videoWidth}/${vid.videoHeight}`;
    q('#scrub').max = vid.duration;
    viewer.ensureCrop();
    viewer.resize(); refresh();
  });
  vid.addEventListener('error', showMissing);
  vid.addEventListener('loadeddata', () => drawStages()); // the first frame is decoded after loadedmetadata
  vid.addEventListener('seeked', () => { syncTime(); drawStages(); });
  vid.addEventListener('play', () => { setPlayIcon(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  vid.addEventListener('pause', () => { setPlayIcon(false); syncTime(); drawStages(); });
  function setPlayIcon(playing){ const b = q('#play'); b.textContent = playing ? '❚❚' : '▶︎'; b.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
  function tick(){ syncTime(); drawStages(); if(!vid.paused && !vid.ended) raf = requestAnimationFrame(tick); }

  const frameOf = t => Math.floor(t*S.fps + 1e-6);
  // Stored times are rounded to 1 ms; seek to the middle of their frame so the decoder never shows a neighbor.
  const seekTo = t => { vid.currentTime = (frameOf(t) + 0.5) / S.fps; };
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
  const relink = async () => { const f = await window.bullpen.chooseVideo(); if(!dead) useVideo(f); };
  q('#pick').onclick = relink;
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
      if(w > 12){ S.zone = {x, y, w, h}; await patchSession({zone: S.zone}); if(dead) return; mode = source === 'manual' ? 'manual' : 'target';
        toast(`Zone set · ${fmt(w/17)} px per inch`); frameCatcher(); }
      renderAll(); return;
    }
    mark(viewer.toFrameCrop(e));
  });

  /* ---------- marking ---------- */
  async function mark(pt){
    pt.t = +vid.currentTime.toFixed(3);
    const sel = pitches.find(p => p.id === selectedId);
    if(sel && editField){ const f = editField; editField = null; await savePitch({...sel, [f]: pt}); return; }
    if(sel) return;
    if(!S.zone){ mode = 'zone'; toast('Draw the strike zone first so misses can be measured in inches.'); renderAll(); return; }
    if(mode === 'target'){ draft.glove = pt; mode = 'location'; }
    else if(mode === 'manual'){ draft.manual = pt; mode = 'location'; }
    else if(mode === 'location'){ draft.loc = pt; await commit(); return; }
    renderAll();
  }
  // The draft is taken and the next pitch started before the save is awaited, so a click that arrives while
  // it is saving starts the next pitch instead of re-committing this one. If the save fails, the draft comes
  // back waiting for the catch, unless a new mark was started meanwhile.
  async function commit(){
    const d = {type: curType, glove: draft.glove, manual: draft.manual, loc: draft.loc, zone: {...S.zone}};
    const n = pitches.length + 1, next = newDraft(), nextMode = source === 'manual' ? 'manual' : 'target';
    draft = next; mode = nextMode;
    let p;
    try{ p = await db('addPitch', S.id, d); }
    catch{
      if(dead) return;
      toast(`Couldn't save pitch #${n} — click the catch again`);
      if(draft === next && !next.glove && !next.manual && !next.loc && mode === nextMode && !selectedId){
        draft = {glove: d.glove, manual: d.manual, loc: null}; mode = 'location'; renderAll();
      }
      return;
    }
    if(dead) return;
    pitches.push(p);
    pitchesChanged(); popAt(p);
    const m = list.find(x => x.id === p.id).m;
    toast(`#${p.n} ${p.type}: ${m.hit?'hit':'miss'} · ${fmt(m.d)}" · ${m.score} pts`);
  }
  // The ball marker is drawn on the canvas, which can't animate one mark, so a DOM disc pops over it.
  function popAt(p){
    if(reducedMotion()) return;
    const el = q('#pop'), {x, y, s} = viewer.toCropPx(p.loc), d = 2*1.45*(p.zone.w/17)*s;
    Object.assign(el.style, {left: `${x - d/2}px`, top: `${y - d/2}px`, width: `${d}px`, height: `${d}px`, background: PCOL[p.type] || '#fff'});
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

  /* ---------- inspector actions ---------- */
  async function setType(t){
    const sel = pitches.find(p => p.id === selectedId);
    if(sel) await savePitch({...sel, type: t});
    else { curType = t; renderAll(); }
  }
  function redrawZone(){ if(!hasVideo){ toast('Load the video to draw a zone.'); return; } selectedId = null; editField = null; mode = 'zone'; renderAll(); }
  // Zone, Target and Manual act like Z, G and M. Catch is reached by placing a target, so clicking it does nothing.
  const TOOL_ACTION = {zone: redrawZone, target: () => setSource('glove'), manual: () => setSource('manual')};
  tools.onclick = e => { const b = e.target.closest('[data-tool]'); if(b && !b.disabled) TOOL_ACTION[b.dataset.tool]?.(); };

  async function pitchAction(a){
    const p = pitches.find(x => x.id === selectedId); if(!p) return;
    if(a === 'jumpT'){ if(hasVideo) seekTo((p.manual || p.glove).t); return; }
    if(a === 'jumpL'){ if(hasVideo) seekTo(p.loc.t); return; }
    if(a === 'clearM'){ await savePitch({...p, manual: null}); return; }
    if(a === 'del'){ deletePitch(); return; }
    if(a === 'glove' || a === 'loc') editField = a;
    else if(a === 'manual'){ editField = 'manual'; source = 'manual'; }
    else if(a === 'done'){ selectedId = null; editField = null; }
    renderAll();
  }
  async function deletePitch(){
    const p = list.find(x => x.id === selectedId);
    if(!p){ toast('Select a pitch to delete it.'); return; }
    const ok = await openSheet({title: `Delete Pitch #${p.n}?`, confirmLabel: 'Delete Pitch', destructive: true,
      body: `<p>This permanently removes pitch #${p.n} (${esc(TNAME[p.type])}, ${p.m.score} pts). Later pitches are renumbered.</p>`});
    if(!ok || dead) return;
    pitches = await db('deletePitch', p.id); if(dead) return;
    if(selectedId === p.id){ selectedId = null; editField = null; }
    pitchesChanged();
  }
  async function changeSetting(patch){
    if('recordedOn' in patch && !patch.recordedOn){ renderAll(); return; }
    if('hitRadius' in patch) patch.hitRadius = clamp(+patch.hitRadius || 6, 2, 12);
    if('fps' in patch) patch.fps = +patch.fps;
    await patchSession(patch); if(dead) return;
    renderTitle(); syncTime(); refresh(); ctx.refreshSidebar();
  }

  /* ---------- tool control and HUD ---------- */
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

  /* ---------- inspector ---------- */
  function renderInspector(sel){
    renderPitchTab(iq('#inspPitch'), {list, selected: sel, draft, curType, source, hasVideo,
      onType: setType, onPreset: manualPreset, onAction: pitchAction});
    if(tab === 'session') renderSessionPane(); // a hidden Session tab skips the chart redraws; setTab renders it on show
  }
  function renderSessionPane(){
    if(filter !== 'ALL' && !list.some(p => p.type === filter)) filter = 'ALL';
    renderSessionTab(iq('#inspSession'), {session: S, list, filter, onSetting: changeSetting,
      onFilter: t => { filter = t; renderSessionPane(); }, onDelete: () => deleteSession()});
  }

  /* ---------- timeline and list ---------- */
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
    selectedId = selectedId === pid ? null : pid; editField = null;
    const p = pitches.find(x => x.id === selectedId);
    if(p){ source = p.manual ? 'manual' : 'glove'; if(hasVideo) seekTo(p.loc.t); }
    renderAll();
  }
  function renderTL(){
    q('#tlHint').textContent = `${list.length} pitch${list.length === 1 ? '' : 'es'} · drag to scrub · click a pitch to jump`;
    tl = renderTimeline(q('#timeline'), list, vid.duration, {selectedId, onSelect: selectPitch,
      onScrub: t => { if(hasVideo){ vid.pause(); vid.currentTime = t; } }});
    tl.setPlayhead(vid.currentTime || 0);
    renderList(q('#log'), list, {selectedId, onSelect: selectPitch});
  }

  /* ---------- session actions (menu and title bar) ---------- */
  function csv(){
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const head = 'athlete,date,pitch,type,target_source,miss_in,arm_side_in,up_in,direction,in_zone,hit,score,setup_offset_in,catch_time_s';
    return [head, ...list.map(p => { const m = p.m; return [q(A.name), S.recordedOn, p.n, p.type, p.manual?'manual':'glove', fmt(m.d,2), fmt(m.arm,2), fmt(m.up,2), m.dir, m.inZone, m.hit, m.score, m.setupOff==null?'':fmt(m.setupOff,2), p.loc.t].join(','); })].join('\n');
  }
  // Copy to the clipboard; if that fails, show the CSV selected in a sheet so ⌘C copies it.
  async function exportCsv(){
    const text = csv();
    try{ await navigator.clipboard.writeText(text); toast(`Copied ${list.length} pitches as CSV`); return; }
    catch{}
    if(dead) return;
    const shown = openSheet({title: 'Copy CSV', confirmLabel: 'Done', cancelLabel: '', body: `
      <p>Copying to the clipboard failed. The CSV is selected below: press ⌘C to copy it.</p>
      <textarea class="csv" readonly rows="10" aria-label="CSV export">${esc(text)}</textarea>`});
    document.querySelector('#sheetHost textarea.csv')?.select();
    await shown;
  }
  async function deleteSession(){
    const ok = await openSheet({title: 'Delete This Session?', confirmLabel: 'Delete Session', destructive: true,
      body: `<p>This permanently deletes the ${esc(fmtDate(S.recordedOn) || 'undated')} session and its ${pitches.length} tagged pitch${pitches.length === 1 ? '' : 'es'}. The video file is not touched.</p>`});
    if(!ok || dead) return;
    await db('deleteSession', S.id);
    if(!dead) ctx.go('#/athlete/' + A.id);
  }
  document.getElementById('exportCsv').onclick = exportCsv;
  const showTab = t => { togglePanel('inspector', true); setTab(t); };
  const MENU = {
    'toggle-list': () => setView(view === 'list' ? 'timeline' : 'list'),
    'inspector-pitch': () => showTab('pitch'),
    'inspector-session': () => showTab('session'),
    'export-csv': exportCsv,
    'relink-video': relink,
    'undo-mark': undoMark,
    'delete-pitch': deletePitch,
    'show-all': () => { showAll = showAllPref(!showAll); window.bullpen.menuState('show-all', showAll); drawStages(); },
    'frame-catcher': () => frameCatcher(),
    'redraw-zone': redrawZone,
    'delete-session': deleteSession,
    'new-session': () => ctx.newSession(A.id),
  };

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

  function renderAll(){
    const sel = list.find(p => p.id === selectedId) || null;
    const ts = toolState({mode, hasZone: !!S.zone, hasVideo, draft, selected: sel ? {n: sel.n} : null, editField});
    q('#hud').textContent = ts.hud; renderTools(ts);
    renderInspector(sel); renderTL(); drawStages();
  }
  vid.addEventListener('timeupdate', syncTime);
  setView(view);
  loadVideo(); refresh();

  function cleanup(){
    dead = true;
    document.removeEventListener('keydown', onKey); ro.disconnect(); cancelAnimationFrame(raf); clearTimeout(popT);
    const score = iq('#bigScore'); if(score) settleCount(score);
    const crop = viewer.flush(); if(crop && hasVideo) db('updateSession', S.id, {crop});
    vid.pause(); vid.removeAttribute('src'); vid.load();
  }
  window.bullpen.menuState('show-all', showAll);
  return {cleanup, onMenu: a => { if(!MENU[a]) return false; MENU[a](); return true; }};
}
