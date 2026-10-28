// Hash router and the roster/athlete views. Routes: #/  ·  #/athlete/:id  ·  #/session/:id
import { scored, summary, insights, grade, tone, fmt, GRADE_TXT } from './scoring.js';
import { scatter, legend, heat, sessionTrend, typeTable } from './charts.js';
import { sessionView } from './session.js';
import { $, db, esc, fmtDate, handLabel, toast, confirmTap, crumbs, basename } from './util.js';

document.body.dataset.platform = window.bullpen.platform;

const settingsFor = (athlete, s) => ({hand: athlete.throws, view: s.cameraView, hitR: s.hitRadius});

let cleanup = null;
async function route(){
  cleanup?.(); cleanup = null;
  const [, view, id] = location.hash.match(/^#\/(\w+)\/(\d+)/) || [];
  const root = $('#view'); root.innerHTML = ''; crumbs('');
  try{
    if(view === 'athlete') cleanup = await athleteView(root, +id);
    else if(view === 'session') cleanup = await sessionView(root, +id);
    else cleanup = await homeView(root);
  }catch(e){
    console.error(e);
    root.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)} <a href="#/">Back to athletes</a></div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();

/* ---------- roster ---------- */
async function homeView(root){
  const athletes = await db('listAthletes');
  root.innerHTML = `
    <header class="top">
      <div><h1>Athletes</h1><div class="sub">Pick a pitcher to see their command over time, or add someone new.</div></div>
      <button class="btn sm" id="revealDb" title="Back this file up to keep your data safe">Show database file</button>
    </header>
    <section class="panel">
      <h2>Add athlete</h2>
      <form class="addform" id="add">
        <label class="field"><span class="lbl">Name</span><input type="text" name="name" required placeholder="First Last"></label>
        <div class="field"><span class="lbl">Throws</span><div class="seg" id="throws"><button type="button" data-v="R" aria-pressed="true">RHP</button><button type="button" data-v="L">LHP</button></div></div>
        <label class="field"><span class="lbl">Level (optional)</span><input type="text" name="level" placeholder="HS, College, Pro…"></label>
        <button class="btn primary" type="submit">Add athlete</button>
      </form>
    </section>
    <section class="roster" id="roster"></section>`;

  $('#roster').innerHTML = athletes.length ? athletes.map(a => {
    const s = a.latest, list = s ? scored(s.pitches, settingsFor(a, s)) : [], sm = summary(list);
    return `<a class="card" href="#/athlete/${a.id}">
      <div><div class="name">${esc(a.name)}</div><span class="hint">${handLabel(a.throws)}${a.level ? ' · '+esc(a.level) : ''}</span></div>
      <div class="meta">
        <div class="hint">${a.sessionCount} session${a.sessionCount===1?'':'s'}${a.lastSession ? '<br>Last: '+fmtDate(a.lastSession) : ''}</div>
        ${sm.n ? `<div style="text-align:right"><div class="score" style="color:var(--${tone(sm.score)})">${Math.round(sm.score)}</div><span class="lbl">Last session</span></div>` : '<span class="pill neutral">No pitches yet</span>'}
      </div></a>`;
  }).join('') : '<div class="empty" style="grid-column:1/-1">No athletes yet. Add your first pitcher above.</div>';

  let throws = 'R';
  $('#throws').onclick = e => { const b = e.target.closest('button'); if(!b) return; throws = b.dataset.v;
    [...$('#throws').children].forEach(x => x.setAttribute('aria-pressed', x === b)); };
  $('#add').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const a = await db('createAthlete', {name: f.get('name'), throws, level: f.get('level').trim()});
    location.hash = '#/athlete/' + a.id;
  };
  $('#revealDb').onclick = () => window.bullpen.revealDb();
}

/* ---------- athlete ---------- */
async function athleteView(root, id){
  const a = await db('getAthlete', id);
  if(!a){ root.innerHTML = '<div class="empty">That athlete no longer exists. <a href="#/">Back to athletes</a></div>'; return; }
  crumbs(`<span>›</span><span>${esc(a.name)}</span>`);
  // Sessions arrive newest first; each gets its own scored list because camera view and hit radius are per session.
  const sessions = a.sessions.map(s => ({...s, list: scored(s.pitches, settingsFor(a, s))}));
  let range = sessions.length > 5 ? '5' : 'all';

  root.innerHTML = `
    <header class="top">
      <div><h1>${esc(a.name)}</h1><div class="sub">${handLabel(a.throws)}${a.level ? ' · '+esc(a.level) : ''} · ${sessions.length} bullpen session${sessions.length===1?'':'s'}</div></div>
      <div class="row">
        <button class="btn sm" id="edit">Edit athlete</button>
        <button class="btn primary" id="newSession">New bullpen session</button>
      </div>
    </header>
    <section class="panel" id="editBox" hidden>
      <h2>Edit athlete</h2>
      <form class="addform" id="editForm">
        <label class="field"><span class="lbl">Name</span><input type="text" name="name" required value="${esc(a.name)}"></label>
        <label class="field"><span class="lbl">Throws</span><select name="throws"><option value="R" ${a.throws==='R'?'selected':''}>RHP</option><option value="L" ${a.throws==='L'?'selected':''}>LHP</option></select></label>
        <label class="field"><span class="lbl">Level</span><input type="text" name="level" value="${esc(a.level)}"></label>
        <label class="field" style="flex:1 1 300px"><span class="lbl">Notes</span><input type="text" name="notes" value="${esc(a.notes)}"></label>
        <button class="btn primary" type="submit">Save</button>
        <button class="btn danger" type="button" id="delAthlete">Delete athlete</button>
      </form>
    </section>
    <section class="bench">
      <div class="panel">
        <div class="panel-h"><h2>Command over time</h2><span class="lbl">Score per session</span></div>
        <div id="sessTrend"></div>
      </div>
      <div class="panel">
        <div class="panel-h"><h2>Summary</h2>
          <select id="range" class="btn sm" aria-label="Sessions included"><option value="5">Last 5 sessions</option><option value="all">All sessions</option></select></div>
        <div class="big"><div class="score num" id="bigScore">–</div><div class="grade"><span id="gradePill" class="pill neutral">–</span><span class="hint" id="gradeTxt"></span></div></div>
        <div class="stats">
          <div><span class="lbl">Hit rate</span><span class="v" id="sHit">–</span></div>
          <div><span class="lbl">Avg miss</span><span class="v" id="sMiss">–</span></div>
          <div><span class="lbl">In zone</span><span class="v" id="sZone">–</span></div>
          <div><span class="lbl">Pitches</span><span class="v" id="sN">–</span></div>
        </div>
        <ul class="insights" id="insights"></ul>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><h2>Trends</h2></div>
      <div class="trends">
        <div class="field"><span class="lbl">Miss pattern around the target</span><div id="scatter"></div><div class="legend" id="legend"></div></div>
        <div class="field"><span class="lbl">Hit rate by target location</span><div id="heat"></div><span class="hint">Targets grouped by zone third, seen from the mound.</span></div>
      </div>
      <div class="tbl" id="typeTbl"></div>
    </section>
    <section class="panel">
      <div class="panel-h"><h2>Sessions</h2></div>
      <div class="tbl" id="sessions"></div>
    </section>`;

  $('#sessTrend').innerHTML = sessions.some(s => s.list.length) ? sessionTrend([...sessions].reverse())
    : '<div class="empty">Tag pitches in a session to start the trend.</div>';
  $('#sessions').innerHTML = sessions.length ? `<table><thead><tr><th>Date</th><th>Video</th><th class="num">Pitches</th><th class="num">Score</th><th class="num">Grade</th><th class="num">Hit %</th><th class="num">Avg miss</th></tr></thead><tbody>` +
    sessions.map(s => { const sm = summary(s.list);
      return `<tr class="click" data-id="${s.id}"><td>${fmtDate(s.recordedOn)}</td><td>${esc(s.title || (s.videoPath ? basename(s.videoPath) : '—'))}</td><td class="num mono">${sm.n}</td>
        <td class="num">${sm.n ? `<span class="pill ${tone(sm.score)}">${Math.round(sm.score)}</span>` : '–'}</td><td class="num mono">${sm.n ? grade(sm.score) : '–'}</td>
        <td class="num mono">${sm.n ? Math.round(sm.hit*100)+'%' : '–'}</td><td class="num mono">${sm.n ? fmt(sm.d)+'"' : '–'}</td></tr>`; }).join('') + '</tbody></table>'
    : '<div class="empty">No sessions yet. Start one with <b>New bullpen session</b> and choose the video.</div>';
  $('#sessions').onclick = e => { const tr = e.target.closest('tr[data-id]'); if(tr) location.hash = '#/session/' + tr.dataset.id; };

  function renderRange(){
    $('#range').value = range;
    const inRange = range === 'all' ? sessions : sessions.slice(0, +range);
    const list = inRange.slice().reverse().flatMap(s => s.list), sm = summary(list), hitR = sessions[0]?.hitRadius ?? 6;
    if(sm.n){
      const sc = Math.round(sm.score), gr = grade(sm.score);
      $('#bigScore').textContent = sc; $('#bigScore').style.color = `var(--${tone(sc)})`;
      $('#gradePill').className = 'pill ' + tone(sc); $('#gradePill').textContent = `${gr} grade`; $('#gradeTxt').textContent = GRADE_TXT[gr];
      $('#sHit').textContent = Math.round(sm.hit*100) + '%'; $('#sMiss').textContent = fmt(sm.d) + '"';
      $('#sZone').textContent = Math.round(sm.zone*100) + '%'; $('#sN').textContent = sm.n;
    }
    $('#insights').innerHTML = insights(list).map(([t,c]) => `<li class="${c}"><span>${t}</span></li>`).join('');
    $('#scatter').innerHTML = scatter(list, hitR, null); $('#legend').innerHTML = list.length ? legend(list) : '';
    $('#heat').innerHTML = heat(list); $('#typeTbl').innerHTML = typeTable(list);
  }
  $('#range').onchange = e => { range = e.target.value; renderRange(); };
  renderRange();

  $('#edit').onclick = () => $('#editBox').hidden = !$('#editBox').hidden;
  $('#editForm').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    await db('updateAthlete', id, {name: f.get('name').trim(), throws: f.get('throws'), level: f.get('level').trim(), notes: f.get('notes').trim()});
    toast('Saved'); route();
  };
  confirmTap($('#delAthlete'), `Tap again to delete ${a.name} and all sessions`, async () => { await db('deleteAthlete', id); location.hash = '#/'; });
  $('#newSession').onclick = async () => {
    const file = await window.bullpen.chooseVideo(); if(!file) return;
    const s = await db('createSession', {athleteId: id, videoPath: file, title: basename(file)});
    location.hash = '#/session/' + s.id;
  };
}
