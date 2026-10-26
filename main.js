const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const SITE = 'https://sksmpchat.netlify.app/';
const SITE_HOST = new URL(SITE).host;
// Allow the sites the app itself needs (Firebase login, YouTube player) to stay inside the window.
const INTERNAL = [SITE_HOST, 'accounts.google.com', 'sksmpmc-e4682.firebaseapp.com', 'www.youtube.com', 'www.youtube-nocookie.com'];

if (!app.requestSingleInstanceLock()) { app.quit(); }
// Let music play without a click after restore, and keep playing when the window is hidden.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } }
function saveState(win) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, max: win.isMaximized() }));
  } catch {}
}

let win;
function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1280, height: st.height || 800, x: st.x, y: st.y,
    minWidth: 380, minHeight: 600,
    backgroundColor: '#07070f',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false // keeps SKMusic playing when minimized
    }
  });
  if (st.max) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveState(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    try { if (INTERNAL.includes(new URL(url).host)) return { action: 'allow' }; } catch {}
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    try { if (INTERNAL.includes(new URL(url).host)) return; } catch {}
    e.preventDefault(); shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_e, code, _d, _u, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.loadURL(SITE);
}

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, {
      type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0,
      title: 'Update ready', message: `SKchat ${info.version} is ready.`,
      detail: 'Restart to finish updating. It will also install the next time you close the app.'
    }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', e => console.error('update error', e && e.message));
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000); // hourly
}

ipcMain.on('retry', () => win && win.loadURL(SITE));

// ---- Discord Rich Presence (shows what you're listening to in SKMusic) ----
let clientId = '';
try { clientId = require('./config.json').discordClientId || ''; } catch {}
let rpc = null, rpcReady = false;
function rpcConnect() {
  if (!clientId || rpc) return;
  let DiscordRPC; try { DiscordRPC = require('discord-rpc'); } catch { return; }
  rpc = new DiscordRPC.Client({ transport: 'ipc' });
  rpc.on('ready', () => { rpcReady = true; });
  rpc.on('disconnected', () => { rpcReady = false; rpc = null; });
  rpc.login({ clientId }).catch(() => { rpc = null; rpcReady = false; });
}
ipcMain.on('presence', (_e, p) => {
  if (!clientId) return;
  if (!rpc) rpcConnect();
  if (!rpcReady) { setTimeout(() => { if (rpcReady && p && p.playing) sendPresence(p); }, 2500); return; }
  sendPresence(p);
});
function sendPresence(p) {
  if (!rpc || !rpcReady) return;
  if (!p || !p.playing) { rpc.clearActivity().catch(() => {}); return; }
  const act = { details: String(p.title || '').slice(0, 120), state: ('by ' + (p.artist || 'Unknown')).slice(0, 120), largeImageKey: p.thumb || 'skmusic', largeImageText: 'SKMusic', instance: false };
  if (p.dur > 0) { const start = Date.now() - (p.pos || 0) * 1000; act.startTimestamp = new Date(start); act.endTimestamp = new Date(start + p.dur * 1000); }
  rpc.setActivity(act).catch(() => {});
}
setInterval(() => { if (clientId && !rpc) rpcConnect(); }, 30000);

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  setupUpdates();
});
app.on('window-all-closed', () => app.quit());
