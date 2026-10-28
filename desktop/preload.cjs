// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bullpen', {
  platform: process.platform,
  db: (method, ...args) => ipcRenderer.invoke('db', method, ...args),
  chooseVideo: () => ipcRenderer.invoke('choose-video'),
  allowVideo: file => ipcRenderer.invoke('allow-video', file),
  pathForFile: file => webUtils.getPathForFile(file),
  revealDb: () => ipcRenderer.invoke('reveal-db'),
});
