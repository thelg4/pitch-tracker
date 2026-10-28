export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const db = (method, ...args) => window.bullpen.db(method, ...args);
export const mediaUrl = file => 'media://video/' + encodeURIComponent(file);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmtDate = (d, year = true) => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, {month:'short', day:'numeric', ...(year && {year:'numeric'})}) : '';
export const handLabel = t => t === 'L' ? 'LHP' : 'RHP';
export const basename = p => p.split(/[\\/]/).pop();

let toastT;
export function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2400);
}

// Two-tap confirm for destructive buttons: first tap relabels, second within 3 s runs `fn`.
export function confirmTap(btn, label, fn){
  const orig = btn.textContent;
  btn.addEventListener('click', () => {
    if(btn.dataset.armed){ delete btn.dataset.armed; btn.textContent = orig; fn(); return; }
    btn.dataset.armed = '1'; btn.textContent = label;
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = orig; }, 3000);
  });
}
