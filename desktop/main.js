import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VIDEO_EXT = ['mov', 'mp4', 'm4v'];
let db;
const picked = new Set(); // videos chosen this run that aren't attached to a session yet

// media://video/<encoded absolute path> streams a local video with byte-range support so seeking works.
// corsEnabled lets the <video crossorigin> load it, which keeps canvas pixels readable for detection later.
protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);

function serveVideo(req){
  const file = decodeURIComponent(new URL(req.url).pathname.slice(1));
  if(!(picked.has(file) || db.hasVideo(file)) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
  const size = fs.statSync(file).size;
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if(!m) return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { ...headers, 'Content-Length': String(size) } });
  const start = m[1] ? +m[1] : Math.max(0, size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if(start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}

function createWindow(){
  const win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1000, minHeight: 700,
    title: 'Bullpen Command', backgroundColor: '#0C1420', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if(/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(here, 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  db = openDb(process.env.BULLPEN_DB || path.join(app.getPath('userData'), 'bullpen.db'));
  protocol.handle('media', serveVideo);

  // Renderer calls go through one channel; only these db methods are reachable.
  const DB_METHODS = ['listAthletes', 'listLibrary', 'createAthlete', 'updateAthlete', 'deleteAthlete', 'getAthlete',
    'createSession', 'getSession', 'updateSession', 'deleteSession', 'rescaleSession',
    'addPitch', 'updatePitch', 'deletePitch'];
  ipcMain.handle('db', (_e, method, ...args) => {
    if(!DB_METHODS.includes(method)) throw new Error(`Unknown method: ${method}`);
    return db[method](...args);
  });
  ipcMain.handle('choose-video', async e => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Choose a bullpen video', properties: ['openFile'], filters: [{ name: 'Videos', extensions: VIDEO_EXT }],
    });
    if(r.canceled || !r.filePaths[0]) return null;
    picked.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  // Drag-and-drop gives the renderer a path directly; register it the same way the dialog does.
  ipcMain.handle('allow-video', (_e, file) => {
    if(!VIDEO_EXT.includes(path.extname(file).slice(1).toLowerCase())) return false;
    picked.add(file); return true;
  });
  ipcMain.handle('reveal-db', () => shell.showItemInFolder(path.join(app.getPath('userData'), 'bullpen.db')));

  createWindow();
  app.on('activate', () => { if(BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if(process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => db?.close());
