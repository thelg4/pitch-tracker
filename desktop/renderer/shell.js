// The window shell around the pages: title bar text and tools, panel visibility and the inspector body.
import { esc } from './util.js';

const app = () => document.getElementById('app');
const KEY = name => 'bullpen.panel.' + name;
let animT = 0;

export function setTitle(title, subtitle = ''){
  document.getElementById('tbTitle').innerHTML = `<div class="t">${esc(title)}</div>${subtitle ? `<div class="s">${esc(subtitle)}</div>` : ''}`;
  document.title = title ? `${title} – Bullpen Command` : 'Bullpen Command';
}

export function setToolbar({center = '', right = ''} = {}){
  document.getElementById('tbCenter').innerHTML = center;
  document.getElementById('tbRight').innerHTML = right;
}

export function setInspector(html){
  document.querySelector('#inspector .inner').innerHTML = html;
}

// Show or hide a side panel; the width springs open or closed in CSS. The choice is remembered.
// The inspector also hides on pages other than a session (see #app[data-page]) without changing this choice.
export function togglePanel(name, open){
  const el = app(), isOpen = el.dataset[name] !== 'closed';
  open ??= !isOpen;
  el.classList.add('panel-anim');
  clearTimeout(animT); animT = setTimeout(() => el.classList.remove('panel-anim'), 300);
  el.dataset[name] = open ? 'open' : 'closed';
  document.getElementById(name === 'sidebar' ? 'tglSidebar' : 'tglInspector').setAttribute('aria-pressed', open);
  try{ localStorage.setItem(KEY(name), open ? 'open' : 'closed'); }catch{}
}

// Restore the saved panel choices without animating them in.
export function restorePanels(){
  const el = app();
  for(const name of ['sidebar', 'inspector']){
    let v = null; try{ v = localStorage.getItem(KEY(name)); }catch{}
    el.dataset[name] = v === 'closed' ? 'closed' : 'open';
    document.getElementById(name === 'sidebar' ? 'tglSidebar' : 'tglInspector').setAttribute('aria-pressed', v !== 'closed');
  }
}

export const setPage = page => { app().dataset.page = page; };
