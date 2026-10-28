// macOS-style sheets: a form that slides down from under the title bar over a dimmed backdrop.
// Esc cancels (null); Return or the confirm button resolves the form's FormData. One sheet at a time.
import { esc } from './util.js';
import { reducedMotion } from './motion.js';

let current = null; // {close(result)}

export function openSheet({title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false}){
  current?.close(null);
  const host = document.getElementById('sheetHost'), app = document.getElementById('app');
  const returnFocus = document.activeElement;
  host.classList.remove('closing', 'open');
  host.innerHTML = `<div class="sheet-backdrop"></div>
    <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
      <h2 id="sheetTitle">${esc(title)}</h2>
      <div class="sheet-body">${body}</div>
      <div class="sheet-actions">
        ${cancelLabel ? `<button type="button" class="btn" data-cancel>${esc(cancelLabel)}</button>` : ''}
        <button type="submit" class="btn ${destructive ? 'destructive' : 'primary'}">${esc(confirmLabel)}</button>
      </div>
    </form>`;
  const form = host.querySelector('form');
  app.inert = true;
  void host.offsetWidth;
  host.classList.add('open');
  (form.querySelector('[autofocus]') || form.querySelector('input,select,textarea') || form.querySelector('[type=submit]')).focus();

  return new Promise(resolve => {
    const sheet = {close};
    current = sheet;
    // Capture phase on window, so keys never reach the views' own shortcut handlers while a sheet is open.
    const onKey = e => {
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(null); }
      else{
        e.stopPropagation(); // even from inside the sheet: Space or a letter on a focused button must not reach a view
        if(e.key === 'Enter' && form.contains(e.target) && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON'){ e.preventDefault(); form.requestSubmit(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    form.addEventListener('submit', e => { e.preventDefault(); close(new FormData(form)); });
    form.querySelector('[data-cancel]')?.addEventListener('click', () => close(null));

    function close(result){
      if(current !== sheet) return;
      current = null;
      window.removeEventListener('keydown', onKey, true);
      app.inert = false;
      if(returnFocus?.isConnected) returnFocus.focus();
      resolve(result);
      // Input goes back to the window at once; the slide-out is only visual.
      host.classList.add('closing'); host.classList.remove('open');
      const done = () => { if(!current) { host.innerHTML = ''; host.classList.remove('closing'); } };
      if(reducedMotion()) done(); else setTimeout(done, 300);
    }
  });
}
