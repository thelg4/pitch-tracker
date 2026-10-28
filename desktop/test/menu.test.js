import test from 'node:test';
import assert from 'node:assert/strict';
import { menuTemplate } from '../menu-template.js';

function collect(items, out = []){
  for(const it of items){ if(it.submenu) collect(it.submenu, out); out.push(it); }
  return out;
}
const ACTIONS = ['new-athlete', 'new-session', 'relink-video', 'show-db', 'export-csv', 'undo-mark', 'delete-pitch',
  'toggle-sidebar', 'toggle-inspector', 'toggle-list', 'inspector-pitch', 'inspector-session',
  'show-all', 'frame-catcher', 'redraw-zone', 'delete-session', 'help-score'];

test('every clickable item sends exactly its action', () => {
  const sent = [];
  const clickable = collect(menuTemplate(a => sent.push(a))).filter(i => i.click);
  assert.equal(clickable.length, ACTIONS.length);
  const got = clickable.map(i => { sent.length = 0; i.click(); assert.equal(sent.length, 1); return sent[0]; });
  assert.deepEqual([...got].sort(), [...ACTIONS].sort());
});

function byAction(action){
  const sent = [];
  return collect(menuTemplate(x => sent.push(x))).find(i => { if(!i.click) return false; sent.length = 0; i.click(); return sent[0] === action; });
}

test('key accelerators', () => {
  assert.equal(byAction('toggle-sidebar').accelerator, 'Alt+CmdOrCtrl+S');
  assert.equal(byAction('export-csv').accelerator, 'CmdOrCtrl+E');
  assert.equal(byAction('new-session').accelerator, 'CmdOrCtrl+Shift+N');
  assert.equal(byAction('inspector-session').accelerator, 'CmdOrCtrl+2');
  assert.equal(byAction('undo-mark').accelerator, undefined);
  assert.equal(byAction('show-all').type, 'checkbox');
  assert.equal(byAction('show-all').checked, true);
});

test('no bare single-key accelerators', () => {
  for(const i of collect(menuTemplate(() => {}))) if(i.accelerator) assert.match(i.accelerator, /(Cmd|Ctrl|Alt|Shift)/);
});

test('spec labels are pinned', () => {
  const labels = collect(menuTemplate(() => {})).map(i => i.label);
  for(const l of ['Show Database File', 'Export CSV', 'Timeline/List', 'Delete Session…', 'How the Score Works']) assert.ok(labels.includes(l), l);
});
