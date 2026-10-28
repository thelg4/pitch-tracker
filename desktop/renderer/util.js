export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const db = (method, ...args) => window.bullpen.db(method, ...args);
export const mediaUrl = file => 'media://video/' + encodeURIComponent(file);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmtDate = (d, year = true) => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric', ...(year && {year:'numeric'})}) : '';
export const handLabel = t => t === 'L' ? 'LHP' : 'RHP';
export const basename = p => p.split(/[\\/]/).pop();

// Show All Pitches: kept across sessions and launches; the View menu's checkbox follows it.
const SHOW_ALL = 'bullpen.showAll';
export function showAllPref(v){
  try{
    if(v !== undefined) localStorage.setItem(SHOW_ALL, v ? '1' : '0');
    return localStorage.getItem(SHOW_ALL) !== '0';
  }catch{ return v ?? true; }
}

let toastT;
export function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400);
}
