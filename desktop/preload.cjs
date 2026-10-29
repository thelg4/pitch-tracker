// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bullpen', {
  platform: process.platform,
  db: (method, ...args) => ipcRenderer.invoke('db', method, ...args),
  chooseVideo: () => ipcRenderer.invoke('choose-video'),
  allowVideo: file => ipcRenderer.invoke('allow-video', file),
  videoExists: file => ipcRenderer.invoke('video-exists', file),
  pathForFile: file => webUtils.getPathForFile(file),
  onMenu: cb => { const h = (_e, action) => cb(action); ipcRenderer.on('menu', h); return () => ipcRenderer.removeListener('menu', h); },
  revealDb: () => ipcRenderer.invoke('reveal-db'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  // Tell the menu a checkbox's state (the renderer owns it; see Show All Pitches).
  menuState: (id, checked) => ipcRenderer.send('menu-state', id, checked),
});
