// Pure Electron menu template (no electron import) so it can be unit tested.
// Single-key commands are handled by the renderer; their key lives in the label, never as an accelerator.
export function menuTemplate(send){
  const item = (label, action, accelerator) => ({ label, click: () => send(action), ...(accelerator && { accelerator }) });
  return [
    { role: 'appMenu' },
    { label: 'File', submenu: [
      item('New Athlete', 'new-athlete', 'CmdOrCtrl+N'),
      item('New Session', 'new-session', 'CmdOrCtrl+Shift+N'),
      { type: 'separator' },
      item('Relink Video…', 'relink-video'),
      item('Show Database File', 'show-db'),
      { type: 'separator' },
      item('Export CSV', 'export-csv', 'CmdOrCtrl+E'),
      { type: 'separator' },
      { role: 'close' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      item('Undo Mark  ⌫', 'undo-mark'),
      item('Delete Pitch', 'delete-pitch'),
    ] },
    { label: 'View', submenu: [
      item('Toggle Sidebar', 'toggle-sidebar', 'Alt+CmdOrCtrl+S'),
      item('Toggle Inspector', 'toggle-inspector', 'Alt+CmdOrCtrl+I'),
      item('Timeline/List', 'toggle-list', 'CmdOrCtrl+L'),
      { type: 'separator' },
      item('Inspector: Pitch', 'inspector-pitch', 'CmdOrCtrl+1'),
      item('Inspector: Session', 'inspector-session', 'CmdOrCtrl+2'),
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { label: 'Session', submenu: [
      { id: 'show-all', label: 'Show All Pitches', type: 'checkbox', checked: true, click: () => send('show-all') },
      item('Frame Catcher  C', 'frame-catcher'),
      item('Redraw Zone  Z', 'redraw-zone'),
      { type: 'separator' },
      item('Delete Session…', 'delete-session'),
    ] },
    { label: 'Help', submenu: [item('Welcome to Bullpen Command', 'welcome'), item('How the Score Works', 'help-score')] },
  ];
}
