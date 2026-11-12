// KAYAN BOQ — Windows desktop shell. Data lives in one SQLite file under %APPDATA%\KAYAN BOQ\
// with atomic writes and rotating backups. The UI is the same web app, served from app://kayan.
const { app, BrowserWindow, ipcMain, protocol, net, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const dataDir = () => path.join(app.getPath('userData'), 'data');
const dataFile = () => path.join(dataDir(), 'kayan.db');
const dekelFile = () => path.join(dataDir(), 'dekel.db');
const backupDir = () => path.join(dataDir(), 'backups');
const MAX_BACKUPS = 20;
const BACKUP_EVERY_MS = 10 * 60 * 1000;
let lastBackup = 0;

function atomicWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function rotateBackup(force = false) {
  if (!fs.existsSync(dataFile())) return;
  if (!force && Date.now() - lastBackup < BACKUP_EVERY_MS) return;
  lastBackup = Date.now();
  fs.mkdirSync(backupDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.copyFileSync(dataFile(), path.join(backupDir(), `kayan-${stamp}.db`));
  const all = fs.readdirSync(backupDir()).filter((f) => f.endsWith('.db')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) fs.rmSync(path.join(backupDir(), f));
}
const read = (f) => (fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null);

ipcMain.handle('data:load', () => read(dataFile()));
ipcMain.handle('data:save', (_e, bytes) => { rotateBackup(); atomicWrite(dataFile(), Buffer.from(bytes)); return true; });
ipcMain.handle('dekel:load', () => read(dekelFile()));
ipcMain.handle('dekel:save', (_e, bytes) => { atomicWrite(dekelFile(), Buffer.from(bytes)); return true; });
ipcMain.handle('data:path', () => dataFile());
ipcMain.handle('print:pdf', async (e, name) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const safe = String(name || 'document.pdf').replace(/[\\/:*?"<>|]/g, '_');
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safe), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (canceled || !filePath) return false;
  const pdf = await e.sender.printToPDF({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(filePath, pdf);
  shell.openPath(filePath);
  return true;
});

// CBS (הלמ"ס) index download. The response format is parsed defensively because it could not be
// verified while building; any failure falls back to manual entry in the UI.
ipcMain.handle('cbs:fetch', async (_e, code) => {
  if (!/^\d{3,8}$/.test(String(code))) throw new Error('קוד מדד לא תקין');
  const url = `https://api.cbs.gov.il/index/data/price?id=${code}&format=json&download=false&last=60&lang=he`;
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`הלמ"ס החזיר ${res.status}`);
  const json = await res.json();
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const y = o.year ?? o.Year, m = o.month ?? o.Month;
    const v = o.currBase?.value ?? o.value ?? o.Value;
    if (y && m && v != null && !isNaN(+v)) out.push({ month: `${y}-${String(m).padStart(2, '0')}`, value: String(v) });
    else Object.values(o).forEach(walk);
  };
  walk(json);
  return out;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640, show: false, title: 'KAYAN BOQ',
    backgroundColor: '#f5f4f0', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://kayan/')) e.preventDefault(); });
  win.loadURL('app://kayan/index.html');
  return win;
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'קובץ', submenu: [{ label: 'פתיחת תיקיית הנתונים', click: () => shell.openPath(dataDir()) }, { type: 'separator' }, { role: 'quit', label: 'יציאה' }] },
    { label: 'תצוגה', submenu: [{ role: 'reload', label: 'רענון' }, { role: 'zoomIn', label: 'הגדלה' }, { role: 'zoomOut', label: 'הקטנה' }, { role: 'resetZoom', label: 'גודל רגיל' }, { role: 'togglefullscreen', label: 'מסך מלא' }, { role: 'toggleDevTools', label: 'כלי מפתחים' }] },
  ]));
  rotateBackup(true);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
