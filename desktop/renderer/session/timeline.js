// Pitch timeline (one clip per pitch on a 34px lane with a playhead) and the pitch list (the log table).
// Both render into an element the caller owns and replace its contents; handlers are assigned as
// properties so a re-render never stacks listeners, and they go away with the element.
import { TCOL, fmt, tone } from '../scoring.js';
import { clipFor } from '../ui-logic.js';

const maxRendered = new WeakMap();   // lane element -> highest pitch id drawn so far

export function renderTimeline(el, list, duration, {selectedId, onSelect, onScrub}){
  const ok = Number.isFinite(duration) && duration > 0;
  const prev = maxRendered.get(el);
  let clips = '';
  if(ok){
    // Only clips newer than anything drawn before spring in; the first draw of a session is the baseline.
    clips = list.map(p => {
      const c = clipFor(p, duration), col = TCOL[p.type] || '#888';
      const fresh = prev !== undefined && p.id > prev;
      // A marker is centered on the catch by its CSS (fixed width, translateX(-50%), clamped inside the lane).
      const pos = c.marker ? `left:clamp(12px,${(p.loc.t / duration) * 100}%,calc(100% - 12px));` : `left:${c.left * 100}%;width:${c.width * 100}%;`;
      return `<div class="clip${fresh ? ' in' : ''}${p.id === selectedId ? ' sel' : ''}${c.marker ? ' marker' : ''}" data-id="${p.id}" role="button" tabindex="-1" title="#${p.n} ${p.type} · ${p.m.score}"
        style="${pos}background:${col}">#${p.n}<small>${p.m.score}</small></div>`;
    }).join('');
    maxRendered.set(el, Math.max(prev ?? -1, ...list.map(p => p.id)));
  }
  el.innerHTML = `<div class="lane"><div class="ruler"></div>${clips}<div class="ph"></div></div>`;
  const lane = el.firstChild, ph = lane.querySelector('.ph');
  let at = el._at || 0;
  const setPlayhead = t => { at = el._at = t; ph.style.left = ok ? `${Math.min(Math.max(t / duration, 0), 1) * 100}%` : '0'; };
  setPlayhead(at);

  const scrubTo = e => {
    const r = lane.getBoundingClientRect();
    onScrub(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * duration);
  };
  let dragging = false;
  lane.onpointerdown = e => {
    if(!ok || e.target.closest('.clip')) return;
    dragging = true; lane.setPointerCapture(e.pointerId); scrubTo(e);
  };
  lane.onpointermove = e => { if(dragging) scrubTo(e); };
  lane.onpointerup = lane.onpointercancel = () => { dragging = false; };
  lane.onclick = e => { const c = e.target.closest('.clip'); if(c) onSelect(+c.dataset.id); };
  return {setPlayhead};
}

export function renderList(el, list, {selectedId, onSelect}){
  if(!list.length){ el.innerHTML = '<div class="empty">No pitches tagged yet. Mark the glove, then the catch, and each pitch lands here.</div>'; el.onclick = null; return; }
  el.innerHTML = `<table><thead><tr><th>#</th><th>Pitch</th><th>Target</th><th class="num">Miss</th><th class="num">Arm/Glove</th><th class="num">Up/Down</th><th>Direction</th><th>Zone</th><th class="num">Score</th></tr></thead><tbody>` +
    list.slice().reverse().map(p => { const m = p.m;
      return `<tr class="click ${p.id===selectedId?'sel':''}" data-id="${p.id}"><td class="mono">${p.n}</td><td><span class="dot" style="background:${TCOL[p.type]}"></span>${p.type}</td>
      <td>${p.manual?'<span class="pill warn">Manual</span>':'<span class="pill neutral">Glove</span>'}</td>
      <td class="num mono">${fmt(m.d)}"</td><td class="num mono">${m.arm>=0?'A':'G'} ${fmt(Math.abs(m.arm))}"</td><td class="num mono">${m.up>=0?'U':'D'} ${fmt(Math.abs(m.up))}"</td>
      <td>${m.dir}</td><td>${m.inZone?'In':'<span style="color:var(--bad)">Out</span>'}</td><td class="num"><span class="pill ${tone(m.score)}">${m.score}</span></td></tr>`; }).join('') + '</tbody></table>';
  el.onclick = e => { const tr = e.target.closest('tr[data-id]'); if(tr) onSelect(+tr.dataset.id); };
}
