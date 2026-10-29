// Boot, hash router, library state and menu dispatch. Routes: #/  ·  #/athlete/:id  ·  #/session/:id
import { athleteView } from './athlete.js';
import { sessionView } from './session/session.js';
import { renderSidebar } from './sidebar.js';
import { setTitle, setToolbar, setInspector, togglePanel, restorePanels, setPage } from './shell.js';
import { openSheet, isOpen as sheetOpen } from './sheets.js';
import { replayClass } from './motion.js';
import { welcomeAtLaunch, showWelcome } from './welcome.js';
import { $, db, esc, fmtDate, handLabel, basename, toast, showAllPref } from './util.js';

document.body.dataset.platform = window.bullpen.platform;
restorePanels();
window.bullpen.menuState('show-all', showAllPref());

const LAST = 'bullpen.lastAthlete';
const remember = id => { try{ localStorage.setItem(LAST, id); }catch{} };
const recalled = () => { try{ return +localStorage.getItem(LAST); }catch{ return 0; } };

let library = [];
let active = {};      // the mounted view: {cleanup?, onMenu?}
let shownKey = '';    // which page #center shows, so a reload of the same page doesn't crossfade
let seq = 0;          // drops a route whose data arrives after a newer navigation
let sbSel = {athleteId: null, sessionId: null}; // what the sidebar highlights

const ctx = {
  get library(){ return library; },
  reload: () => route(),
  go(hash){ if(location.hash === hash) route(); else location.hash = hash; },
  // Redraw only the sidebar from fresh data (a session's score or date changed), without remounting the view.
  async refreshSidebar(){
    const my = seq, lib = await db('listLibrary');
    if(my !== seq) return;
    library = lib; drawSidebar(sbSel.athleteId, sbSel.sessionId);
  },
  // Choose a video, create a session for the athlete with it, and open it.
  async newSession(athleteId){
    const my = seq, file = await window.bullpen.chooseVideo();
    if(!file || my !== seq) return;
    const s = await db('createSession', {athleteId, videoPath: file, title: basename(file)});
    ctx.go('#/session/' + s.id);
  },
};

// A view returns a cleanup function or {cleanup, onMenu}.
const asView = r => typeof r === 'function' ? {cleanup: r} : (r || {});

async function route(){
  const my = ++seq;
  const lib = await db('listLibrary');
  if(my !== seq) return;
  library = lib;
  active.cleanup?.(); active = {};

  let [, view, id] = location.hash.match(/^#\/(athlete|session)\/(\d+)$/) || [];
  id = +id;
  if(!view && library.length){
    view = 'athlete'; id = (library.find(a => a.id === recalled()) || library[0]).id;
    history.replaceState(null, '', '#/athlete/' + id);
  }
  const athlete = view === 'athlete' ? library.find(a => a.id === id)
    : view === 'session' ? library.find(a => a.sessions.some(s => s.id === id)) : null;
  const session = view === 'session' ? athlete?.sessions.find(s => s.id === id) : null;
  if(athlete) remember(athlete.id);

  drawSidebar(athlete?.id ?? null, session?.id ?? null);
  setPage(view || 'empty');
  setToolbar(); setInspector('');
  if(session) setTitle(`${fmtDate(session.recordedOn)} Bullpen`, `${athlete.name} · ${handLabel(athlete.throws)} · ${session.fps} fps`);
  else if(athlete) setTitle(athlete.name, [handLabel(athlete.throws), athlete.level, `${athlete.sessions.length} session${athlete.sessions.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '));
  else setTitle(view ? 'Not found' : 'Bullpen Command');

  const center = $('#center'), page = document.createElement('div'), key = location.hash || '#/';
  page.className = view ? 'page wrap' : 'page';
  center.replaceChildren(page); center.scrollTop = 0;
  if(key !== shownKey) replayClass(page, 'enter');
  shownKey = key;

  try{
    const mounted = asView(view === 'athlete' ? await athleteView(page, id, ctx)
      : view === 'session' ? await sessionView(page, id, ctx)
      : emptyView(page));
    if(my !== seq){ mounted.cleanup?.(); return; }
    active = mounted;
  }catch(e){
    console.error(e);
    page.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)} <a href="#/">Back to athletes</a></div>`;
  }
}

function drawSidebar(athleteId, sessionId){
  sbSel = {athleteId, sessionId};
  renderSidebar($('#sidebar .inner'), library, {athleteId, sessionId}, {
    onAthlete: id => ctx.go('#/athlete/' + id),
    onSession: id => ctx.go('#/session/' + id),
    onNewAthlete: newAthlete,
  });
}

function emptyView(page){
  page.innerHTML = `<div class="empty-state">
    <h1>Add your first pitcher</h1>
    <p>Each athlete keeps their bullpen sessions, so you can see their command change over time.</p>
    <button type="button" class="btn primary" id="emptyNew">＋ New Athlete</button></div>`;
  $('#emptyNew', page).onclick = newAthlete;
}

async function newAthlete(){
  const f = await openSheet({title: 'New Athlete', confirmLabel: 'Add Athlete', body: `
    <label class="field"><span class="lbl">Name</span><input type="text" name="name" required pattern=".*\\S.*" placeholder="First Last" autofocus></label>
    <div class="field"><span class="lbl">Throws</span>
      <div class="seg" role="radiogroup" aria-label="Throws">
        <label><input type="radio" name="throws" value="R" checked><span>RHP</span></label>
        <label><input type="radio" name="throws" value="L"><span>LHP</span></label></div></div>
    <label class="field"><span class="lbl">Level (optional)</span><input type="text" name="level" placeholder="HS, College, Pro…"></label>`});
  if(!f) return;
  const a = await db('createAthlete', {name: f.get('name').trim(), throws: f.get('throws'), level: f.get('level').trim()});
  ctx.go('#/athlete/' + a.id);
}

const SCORE_HELP = `<p>Miss distance is measured in inches from the target to where the ball is caught, using the 17-inch plate width from your zone box as the ruler. A pitch within a third of the hit radius scores 100. The score falls in a straight line to 0 at three times the hit radius. With the default 6" radius, a 6" miss scores 75 and anything 18" or more scores 0. The command score is the average across all tagged pitches, and the grade puts it on the 20–80 scouting scale.</p>`;

const isSession = () => $('#app').dataset.page === 'session';
const menu = {
  'new-athlete': newAthlete,
  'welcome': () => showWelcome(welcomeOpts()),
  'help-score': () => openSheet({title: 'How the Score Works', body: SCORE_HELP, confirmLabel: 'Done', cancelLabel: ''}),
  'toggle-sidebar': () => togglePanel('sidebar'),
  'toggle-inspector': () => { if(isSession()) togglePanel('inspector'); },
  'show-db': () => window.bullpen.revealDb(),
};
// What a menu action needs when the page can't do it, so the item never silently does nothing.
const NEEDS = {'new-session': 'Select an athlete first'};
// Menu actions wait while a sheet is open (the sheet owns input until it closes).
window.bullpen.onMenu(action => {
  if(sheetOpen()){
    if(action === 'show-all') window.bullpen.menuState('show-all', showAllPref()); // undo the native checkbox flip
    return;
  }
  if(menu[action]){ menu[action](); return; }
  if(active.onMenu?.(action)) return;
  if(action === 'show-all') window.bullpen.menuState('show-all', showAllPref());
  toast(NEEDS[action] || 'Open a session first');
});
$('#tglSidebar').onclick = () => togglePanel('sidebar');
$('#tglInspector').onclick = () => togglePanel('inspector');

window.addEventListener('hashchange', route);
const welcomeOpts = () => ({hasAthletes: library.length > 0, newAthlete});
// body[data-launched] marks the first route and the welcome check as done.
route().then(() => welcomeAtLaunch(welcomeOpts())).catch(e => console.error(e)).finally(() => { document.body.dataset.launched = ''; });
