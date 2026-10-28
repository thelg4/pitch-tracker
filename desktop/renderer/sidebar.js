// Source list of athletes. The selected athlete expands to show its sessions with their scores.
import { scored, summary } from './scoring.js';
import { initials, avatarColor } from './ui-logic.js';
import { esc, fmtDate } from './util.js';

const DARK_TEXT = new Set(['#30d158', '#64d2ff', '#ffd60a']); // light avatar fills read better with black initials

function sessionScore(athlete, s){
  const sm = summary(scored(s.pitches, {hand: athlete.throws, view: s.cameraView, hitR: s.hitRadius}));
  return sm.n ? Math.round(sm.score) : '–';
}

export function renderSidebar(el, library, {athleteId, sessionId}, {onAthlete, onSession, onNewAthlete}){
  const rows = library.map(a => {
    const open = a.id === athleteId, color = avatarColor(a.name);
    const cls = open ? (sessionId ? 'sel' : 'act') : '';
    const sessions = !open ? '' : a.sessions.length
      ? a.sessions.map(s => `<button type="button" class="sb-row sb-session ${s.id === sessionId ? 'act' : ''}" data-id="${s.id}">
          <span>${fmtDate(s.recordedOn, false)}</span><span class="sc">${sessionScore(a, s)}</span></button>`).join('')
      : '<div class="sb-none">No sessions yet</div>';
    return `<button type="button" class="sb-row sb-athlete ${cls}" data-id="${a.id}" aria-expanded="${open}" title="${esc(a.name)}">
        <span class="sb-disc" aria-hidden="true">▶</span>
        <span class="av ${DARK_TEXT.has(color) ? 'dark' : ''}" style="background:${color}">${esc(initials(a.name))}</span>
        <span class="sb-name">${esc(a.name)}</span></button>${sessions}`;
  }).join('');

  el.innerHTML = `<nav class="sb" aria-label="Athletes">
    <div class="sb-head">Athletes</div>
    <div class="sb-list">${rows}</div>
    <button type="button" class="sb-row sb-new" id="sbNew">＋ New Athlete</button></nav>`;

  el.querySelector('.sb-list').onclick = e => {
    const row = e.target.closest('.sb-athlete, .sb-session'); if(!row) return;
    (row.classList.contains('sb-athlete') ? onAthlete : onSession)(+row.dataset.id);
  };
  el.querySelector('#sbNew').onclick = onNewAthlete;
}
