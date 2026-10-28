// The session inspector's two tabs. Each render function fills an element the session controller owns
// (a pane inside the shell's #inspector). The first call builds the tab; later calls update it in place,
// so the score can count from its old value and focused inputs stay put. Handlers are assigned as
// properties on every call, so re-rendering never stacks listeners and the newest callbacks always win.
import { TYPES, TCOL, TNAME, fmt, summary, grade, tone, GRADE_TXT, insights } from '../scoring.js';
import { scatter, legend, heat, rollingTrend, typeTable } from '../charts.js';
import { countTo, settleCount } from '../motion.js';

const ZONE_ROWS = ['Up', 'Mid', 'Down'], ZONE_COLS = ['Glove', 'Mid', 'Arm'];
const TREND_SIZE = {w: 250, h: 150};   // the rolling trend's viewBox in the narrow inspector
const $ = (el, sel) => el.querySelector(sel);
const side = (v, pos, neg) => `${v >= 0 ? pos : neg} ${fmt(Math.abs(v))}"`;
const kv = (k, v, attrs = '') => `<div class="kv"><span>${k}</span><span${attrs}>${v}</span></div>`;

/* ---------- Pitch tab ---------- */

export function renderPitchTab(el, {list, selected, draft, curType, source, hasVideo, onType, onPreset, onAction}){
  if(!el.firstChild){
    const pick = '<span></span>' + ZONE_COLS.map(c => `<span class="cl">${c}</span>`).join('') +
      ZONE_ROWS.map((r, ri) => `<span class="cl">${r}</span>` +
        ZONE_COLS.map((c, ci) => `<button type="button" data-c="${ci}" data-r="${ri}" aria-label="${r} ${c} side"></button>`).join('')).join('');
    el.innerHTML = `
      <section class="isec"><div class="lab">Command · session</div>
        <div class="iscore"><div class="bigscore" id="bigScore">–</div><div class="igrade"><span id="gradeVal"></span><span id="gradeTxt"></span></div></div></section>
      <section class="isec"><div class="lab" id="typeLab"></div>
        <div class="ptypes" id="types" role="group" aria-label="Pitch type">${TYPES.map(([k, n]) =>
          `<button type="button" data-t="${k}" title="${n}" aria-pressed="false"><i style="background:${TCOL[k]}"></i>${k}</button>`).join('')}</div>
        <div class="hint" id="draftHint"></div></section>
      <section class="isec" id="manualSec" hidden><div class="lab">Manual target</div>
        <div class="zonepick" id="zonepick">${pick}</div>
        <p class="hint">Pick a third, or click the catcher view. The manual target is scored; the glove spot is kept to show how far off the setup was.</p></section>
      <section class="isec" id="pitchSec"></section>
      <section class="isec" id="editSec" hidden></section>
      <section class="isec"><div class="lab">Insight</div><div class="insight" id="insight1"></div></section>`;
  }

  // Score
  const s = summary(list), score = $(el, '#bigScore');
  if(s.n){
    const sc = Math.round(s.score), gr = grade(s.score);
    countTo(score, sc); score.style.color = `var(--${tone(sc)})`;
    $(el, '#gradeVal').textContent = `${gr} grade`; $(el, '#gradeTxt').textContent = GRADE_TXT[gr];
  }else{
    settleCount(score, '–'); score.style.color = '';
    $(el, '#gradeVal').textContent = 'No pitches yet'; $(el, '#gradeTxt').textContent = '';
  }

  // Type grid
  const typeNow = selected ? selected.type : curType;
  $(el, '#typeLab').textContent = `Pitch #${selected ? selected.n : list.length + 1} type`;
  el.querySelectorAll('#types [data-t]').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === typeNow));
  $(el, '#types').onclick = e => { const b = e.target.closest('[data-t]'); if(b) onType(b.dataset.t); };
  const placed = !selected && (draft.glove || draft.manual);
  $(el, '#draftHint').textContent = placed ? `${draft.manual ? 'Manual target' : 'Glove'} marked. Click where the ball is caught.` : '';
  $(el, '#draftHint').hidden = !placed;

  // Zone-third picker, only while Manual is the target type
  $(el, '#manualSec').hidden = source !== 'manual';
  $(el, '#zonepick').onclick = e => { const b = e.target.closest('button'); if(b) onPreset(+b.dataset.c, +b.dataset.r); };

  // Selected or last pitch
  const p = selected || list.at(-1), sec = $(el, '#pitchSec');
  if(p){
    const m = p.m;
    sec.innerHTML = `<div class="lab">${selected ? `Pitch #${p.n} · ${TNAME[p.type]}` : 'Last pitch'}</div>` +
      kv('Miss', `${fmt(m.d)}"`) + kv('Arm / glove', side(m.arm, 'A', 'G')) + kv('Up / down', side(m.up, 'U', 'D')) +
      kv('Target', p.manual ? 'Manual' : 'Glove') + kv('Score', m.score, ` style="color:var(--${tone(m.score)})"`);
  }else sec.innerHTML = '<div class="lab">Last pitch</div><div class="hint">Mark the glove, then the catch, to tag a pitch.</div>';

  // Edit actions for a selected pitch
  const edit = $(el, '#editSec'); edit.hidden = !selected;
  if(selected){
    const dis = hasVideo ? '' : ' disabled';
    edit.innerHTML = `<div class="lab">Edit</div>
      <div class="iacts">
        <button type="button" class="btn sm" data-a="jumpT"${dis}>Go to Target Frame</button>
        <button type="button" class="btn sm" data-a="jumpL"${dis}>Go to Catch Frame</button>
        <button type="button" class="btn sm" data-a="glove"${dis}>Re-mark Glove</button>
        <button type="button" class="btn sm" data-a="manual">${selected.manual ? 'Re-mark Manual' : 'Set Manual Target'}</button>
        <button type="button" class="btn sm" data-a="loc"${dis}>Re-mark Location</button>
        ${selected.manual && selected.glove ? '<button type="button" class="btn sm" data-a="clearM">Use Glove Instead</button>' : ''}
      </div>
      ${selected.m.setupOff != null ? `<div class="hint">Catcher set up ${fmt(selected.m.setupOff)}" from the intended target.</div>` : ''}
      <div class="iacts two"><button type="button" class="btn sm" data-a="done">Done</button><button type="button" class="btn sm danger" data-a="del">Delete…</button></div>`;
    edit.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if(a) onAction(a); };
  }

  // The headline finding. insights() returns trusted markup built from numbers and fixed names.
  const [first] = insights(list);
  $(el, '#insight1').innerHTML = first ? first[0] : '';
}

/* ---------- Session tab ---------- */

export function renderSessionTab(el, {session: S, list, filter, onSetting, onFilter}){
  if(!el.firstChild){
    el.innerHTML = `
      <section class="isec"><div class="lab">Session</div>
        <div class="iform">
          <label><span>Date</span><input type="date" id="date"></label>
          <label><span>Camera</span><select id="view"><option value="pitcher">Behind pitcher</option><option value="catcher">Behind catcher</option></select></label>
          <label><span>Hit radius (in)</span><input id="hitR" type="number" min="2" max="12" step="0.5"></label>
          <label><span>Video fps</span><select id="fps"><option>30</option><option>60</option><option>120</option><option>240</option></select></label>
        </div></section>
      <section class="isec"><div class="lab">Stats</div>
        ${kv('Hit rate', '–', ' id="sHit"')}${kv('Avg miss', '–', ' id="sMiss"')}${kv('In zone', '–', ' id="sZone"')}
        ${kv('Pitches', '–', ' id="sN"')}${kv('Zone scale', '–', ' id="zonePpi"')}</section>
      <section class="isec"><div class="lab">What the misses say</div><ul class="insights" id="insights"></ul></section>
      <section class="isec">
        <div class="lab-row"><span class="lab">Charts</span><select id="filter" class="btn sm" aria-label="Pitch type"></select></div>
        <div class="ichart"><span class="lbl">Miss pattern</span><div class="iscatter" id="scatter"></div><div class="legend" id="legend"></div></div>
        <div class="ichart"><span class="lbl">Hit rate by target</span><div id="heat"></div></div>
        <div class="ichart"><span class="lbl">Score (5-pitch rolling)</span><div id="trend"></div></div>
        <div class="ichart"><span class="lbl">By pitch type</span><div class="tbl itbl" id="typeTbl"></div></div>
      </section>`;
  }

  // Settings
  $(el, '#date').value = S.recordedOn || ''; $(el, '#view').value = S.cameraView;
  $(el, '#hitR').value = S.hitRadius; $(el, '#fps').value = S.fps;
  $(el, '#date').onchange = e => onSetting({recordedOn: e.target.value});
  $(el, '#view').onchange = e => onSetting({cameraView: e.target.value});
  $(el, '#hitR').onchange = e => onSetting({hitRadius: e.target.value});
  $(el, '#fps').onchange = e => onSetting({fps: e.target.value});

  // Stats
  const s = summary(list);
  $(el, '#sHit').textContent = s.n ? Math.round(s.hit * 100) + '%' : '–';
  $(el, '#sMiss').textContent = s.n ? fmt(s.d) + '"' : '–';
  $(el, '#sZone').textContent = s.n ? Math.round(s.zone * 100) + '%' : '–';
  $(el, '#sN').textContent = s.n || '–';
  $(el, '#zonePpi').textContent = S.zone ? fmt(S.zone.w / 17) + ' px/in' : 'Not set';
  $(el, '#insights').innerHTML = s.n ? insights(list).map(([t, c]) => `<li class="${c}"><span>${t}</span></li>`).join('')
    : '<li>Findings show up here after a few tagged pitches.</li>';

  // Charts, filtered by pitch type (the type table always covers every pitch)
  const types = [...new Set(list.map(p => p.type))];
  $(el, '#filter').innerHTML = '<option value="ALL">All pitches</option>' +
    types.map(t => `<option value="${t}"${t === filter ? ' selected' : ''}>${TNAME[t]}</option>`).join('');
  $(el, '#filter').onchange = e => onFilter(e.target.value);
  const l = filter === 'ALL' ? list : list.filter(p => p.type === filter);
  $(el, '#scatter').innerHTML = scatter(l, S.hitRadius, null);
  $(el, '#legend').innerHTML = l.length ? legend(l) : '';
  $(el, '#heat').innerHTML = heat(l);
  $(el, '#trend').innerHTML = rollingTrend(l, TREND_SIZE);
  $(el, '#typeTbl').innerHTML = typeTable(list) || '<div class="hint">Tag pitches to compare types.</div>';
}
