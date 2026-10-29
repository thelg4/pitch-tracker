// Athlete page: dark cards for command over time, the score, written findings, miss pattern and sessions.
// The title bar (name, subtitle) is set by app.js; this view fills the toolbar and the page body.
// The inspector is hidden for this page by #app[data-page] in shell.css, so nothing here toggles panels.
import { scored, summary, insights, grade, tone, fmt, GRADE_TXT } from './scoring.js';
import { scatter, legend, heat, sessionTrend, typeTable } from './charts.js';
import { setToolbar } from './shell.js';
import { openSheet } from './sheets.js';
import { countTo, settleCount } from './motion.js';
import { nextSelection } from './ui-logic.js';
import { $, db, esc, fmtDate, toast, basename } from './util.js';

const settingsFor = (athlete, s) => ({hand: athlete.throws, view: s.cameraView, hitR: s.hitRadius});

export async function athleteView(root, id, ctx){
  const a = await db('getAthlete', id);
  if(!root.isConnected) return;
  if(!a){ root.innerHTML = '<div class="empty">That athlete no longer exists. <a href="#/">Back to athletes</a></div>'; return; }
  // Sessions arrive newest first; each gets its own scored list because camera view and hit radius are per session.
  const sessions = a.sessions.map(s => ({...s, list: scored(s.pitches, settingsFor(a, s))}));
  let range = sessions.length > 5 ? '5' : 'all';
  let dead = false, first = true;
  const q = sel => $(sel, root);

  root.classList.add('athlete');
  root.innerHTML = `
    <div class="dash">
      <section class="card trend">
        <div class="lab">Command over time</div>
        <div id="sessTrend"></div>
        <div class="kpis">
          <div><div class="lab">Trend</div><div class="kv" id="kTrend">–</div></div>
          <div><div class="lab">Hit rate</div><div class="kv" id="sHit">–</div></div>
          <div><div class="lab">Avg miss</div><div class="kv" id="sMiss">–</div></div>
        </div>
      </section>
      <section class="card">
        <div class="lab">Command</div>
        <div class="scorebox"><div class="bigscore" id="bigScore">–</div><div class="grade"><span id="gradePill" class="pill neutral">–</span><span class="hint" id="gradeTxt">Tag pitches in a session to get a score.</span></div></div>
        <div class="mini"><span><b id="sZone">–</b> in zone</span><span><b id="sN">–</b> pitches</span></div>
      </section>
      <section class="card">
        <div class="lab">What the misses say</div>
        <ul class="insights" id="insights"></ul>
      </section>
      <section class="card wide">
        <div class="lab">Miss pattern</div>
        <div class="trends">
          <div class="field"><div id="scatter"></div><div class="legend" id="legend"></div></div>
          <div class="field"><span class="lbl">Hit rate by target location</span><div id="heat"></div><span class="hint">Targets grouped by zone third, seen from the mound.</span></div>
        </div>
      </section>
      <section class="card wide">
        <div class="lab">Pitch types</div>
        <div class="tbl" id="typeTbl"></div>
      </section>
      <section class="card wide">
        <div class="lab">Sessions</div>
        <div class="tbl" id="sessions"></div>
      </section>
    </div>`;

  setToolbar({right: `
    <div class="seg" id="rangeSeg" role="group" aria-label="Sessions included">
      <button type="button" data-r="5">Last 5</button><button type="button" data-r="all">All</button></div>
    <button type="button" class="btn" id="edit">Edit</button>
    <button type="button" class="btn danger" id="del">Delete</button>
    <button type="button" class="btn primary" id="newSession">＋ New Session</button>`});
  const bar = sel => $(sel, document.getElementById('tbRight'));

  q('#sessions').innerHTML = sessions.length ? `<table><thead><tr><th>Date</th><th>Video</th><th class="num">Pitches</th><th class="num">Score</th><th class="num">Grade</th><th class="num">Hit %</th><th class="num">Avg miss</th></tr></thead><tbody>` +
    sessions.map(s => { const sm = summary(s.list);
      return `<tr class="click" data-id="${s.id}" tabindex="0"><td>${fmtDate(s.recordedOn)}</td><td>${esc(s.title || (s.videoPath ? basename(s.videoPath) : '—'))}</td><td class="num mono">${sm.n}</td>
        <td class="num">${sm.n ? `<span class="pill ${tone(sm.score)}">${Math.round(sm.score)}</span>` : '–'}</td><td class="num mono">${sm.n ? grade(sm.score) : '–'}</td>
        <td class="num mono">${sm.n ? Math.round(sm.hit*100)+'%' : '–'}</td><td class="num mono">${sm.n ? fmt(sm.d)+'"' : '–'}</td></tr>`; }).join('') + '</tbody></table>'
    : '<div class="empty">No sessions yet. Start one with <b>New Session</b> and choose the video.</div>';
  const openSession = e => { const tr = e.target.closest('tr[data-id]'); if(tr) location.hash = '#/session/' + tr.dataset.id; };
  q('#sessions').onclick = openSession;
  q('#sessions').onkeydown = e => { if(e.key === 'Enter') openSession(e); };

  function renderRange(){
    for(const b of $$bar()) b.setAttribute('aria-pressed', b.dataset.r === range);
    const inRange = range === 'all' ? sessions : sessions.slice(0, +range);
    const list = inRange.slice().reverse().flatMap(s => s.list), sm = summary(list), hitR = sessions[0]?.hitRadius ?? 6;

    const withData = inRange.filter(s => s.list.length).reverse(); // oldest first
    q('#sessTrend').innerHTML = withData.length ? sessionTrend(withData) : '<div class="empty">Tag pitches in a session to start the trend.</div>';
    const kTrend = q('#kTrend');
    if(withData.length > 1){
      const d = Math.round(summary(withData.at(-1).list).score) - Math.round(summary(withData[0].list).score);
      kTrend.textContent = (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d);
      kTrend.style.color = d > 0 ? 'var(--green)' : d < 0 ? 'var(--red)' : '';
    }else{ kTrend.textContent = '–'; kTrend.style.color = ''; }

    const score = q('#bigScore');
    if(sm.n){
      const sc = Math.round(sm.score), gr = grade(sm.score);
      if(first) settleCount(score, '0');
      countTo(score, sc); score.style.color = `var(--${tone(sc)})`;
      q('#gradePill').className = 'pill ' + tone(sc); q('#gradePill').textContent = `${gr} grade`; q('#gradeTxt').textContent = GRADE_TXT[gr];
      q('#sHit').textContent = Math.round(sm.hit*100) + '%'; q('#sMiss').textContent = fmt(sm.d) + '"';
      q('#sZone').textContent = Math.round(sm.zone*100) + '%'; q('#sN').textContent = sm.n;
    }else{
      settleCount(score, '–'); score.style.color = '';
      q('#gradePill').className = 'pill neutral'; q('#gradePill').textContent = '–'; q('#gradeTxt').textContent = 'Tag pitches in a session to get a score.';
      for(const i of ['#sHit', '#sMiss', '#sZone', '#sN']) q(i).textContent = '–';
    }
    first = false;
    q('#insights').innerHTML = insights(list).map(([t,c]) => `<li class="${c}"><span>${t}</span></li>`).join('');
    q('#scatter').innerHTML = scatter(list, hitR, null); q('#legend').innerHTML = list.length ? legend(list) : '';
    q('#heat').innerHTML = heat(list);
    q('#typeTbl').innerHTML = typeTable(list) || '<div class="empty">Pitch types appear once pitches are tagged.</div>';
  }
  function $$bar(){ return [...document.querySelectorAll('#tbRight [data-r]')]; }
  for(const b of $$bar()) b.onclick = () => { range = b.dataset.r; renderRange(); };
  renderRange();

  bar('#edit').onclick = async () => {
    const f = await openSheet({title: 'Edit Athlete', confirmLabel: 'Save', body: `
      <label class="field"><span class="lbl">Name</span><input type="text" name="name" required pattern=".*\\S.*" value="${esc(a.name)}" autofocus></label>
      <div class="field"><span class="lbl">Throws</span>
        <div class="seg" role="radiogroup" aria-label="Throws">
          <label><input type="radio" name="throws" value="R" ${a.throws === 'L' ? '' : 'checked'}><span>RHP</span></label>
          <label><input type="radio" name="throws" value="L" ${a.throws === 'L' ? 'checked' : ''}><span>LHP</span></label></div></div>
      <label class="field"><span class="lbl">Level</span><input type="text" name="level" value="${esc(a.level)}"></label>
      <label class="field"><span class="lbl">Notes</span><textarea name="notes" rows="3">${esc(a.notes)}</textarea></label>`});
    if(!f || dead) return;
    await db('updateAthlete', id, {name: f.get('name').trim(), throws: f.get('throws'), level: f.get('level').trim(), notes: f.get('notes').trim()});
    toast('Saved'); ctx.reload();
  };
  bar('#del').onclick = async () => {
    const f = await openSheet({title: `Delete ${a.name}?`, confirmLabel: 'Delete Athlete', destructive: true,
      body: `<p>This permanently deletes ${esc(a.name)} and all of their sessions and tagged pitches.</p>`});
    if(!f || dead) return;
    await db('deleteAthlete', id);
    const next = nextSelection(ctx.library.map(x => x.id), id);
    ctx.go(next ? '#/athlete/' + next : '#/');
  };
  bar('#newSession').onclick = () => ctx.newSession(id);

  return {cleanup: () => { dead = true; settleCount(q('#bigScore')); }, onMenu: a => { if(a !== 'new-session') return false; ctx.newSession(id); return true; }};
}
