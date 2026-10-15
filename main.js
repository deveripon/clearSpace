'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { run, disksInfo, tilde, expandHome } = require('./engine/util');
const { scan, rootProblem } = require('./engine/scan');
const { clean } = require('./engine/clean');
const { IS_WIN, HOME, LOCAL, ROAMING } = require('./engine/platform');

let win = null;
let lastScan = null;
let busy = false;
let cleaning = false;

// ---------- settings & history ----------
const userData = () => app.getPath('userData');
const settingsFile = () => path.join(userData(), 'settings.json');
const historyFile = () => path.join(userData(), 'history.json');

function defaultRoots() {
  const candidates = ['Projects', 'Developer', 'Code', 'dev', 'Sites', 'work', 'src',
    ...(IS_WIN ? [path.join('source', 'repos'), 'repos', path.join('Documents', 'GitHub')] : [])];
  const seen = new Set();
  const found = candidates.map((c) => path.join(HOME, c)).filter((p) => {
    try { const real = fs.realpathSync.native(p); if (seen.has(real)) return false; seen.add(real); return true; } catch { return false; }
  });
  return (found.length ? found : [path.join(HOME, 'Documents')]).map(tilde);
}
function readJSON(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
}
function writeJSON(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2));
}
function getSettings() {
  const s = readJSON(settingsFile(), {});
  return {
    projectRoots: Array.isArray(s.projectRoots) && s.projectRoots.length ? s.projectRoots : defaultRoots(),
    inactiveDays: Number(s.inactiveDays) > 0 ? Number(s.inactiveDays) : 14,
    scanOnLaunch: s.scanOnLaunch !== false,
  };
}

// Apps opened from Finder get a minimal PATH. Borrow the login shell's PATH so git and pnpm are found.
// Windows apps get the full user PATH already; only add the usual places git, pnpm and bun install to.
async function fixPath() {
  if (IS_WIN) {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const extra = [path.join(pf, 'Git', 'cmd'), path.join(ROAMING, 'npm'), path.join(LOCAL, 'pnpm'), path.join(HOME, '.bun', 'bin'),
      path.join(LOCAL, 'Programs', 'Git', 'cmd'), path.join(HOME, 'scoop', 'shims')];
    const parts = [...(process.env.PATH || '').split(path.delimiter), ...extra];
    process.env.PATH = [...new Set(parts.filter(Boolean))].join(path.delimiter);
    return;
  }
  const shellBin = process.env.SHELL || '/bin/zsh';
  // Read-only: prints PATH. Auto-updaters in shell configs are told not to run.
  const r = await run(shellBin, ['-ilc', 'printf "__CS_PATH__%s__CS_END__" "$PATH"'], {
    timeout: 5000,
    env: { DISABLE_AUTO_UPDATE: 'true', DISABLE_UPDATE_PROMPT: 'true', ZSH_DISABLE_COMPFIX: 'true', HOMEBREW_NO_AUTO_UPDATE: '1' },
  });
  const m = /__CS_PATH__(.*)__CS_END__/.exec(r.stdout);
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, 'Library/pnpm'), path.join(HOME, '.bun/bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const parts = [...(m ? m[1].split(':') : []), ...(process.env.PATH || '').split(':'), ...extra];
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(':');
}

// ---------- window ----------
// Windows: the app draws its own toolbar; Windows draws the minimize, maximize and close buttons over it,
// in the toolbar's colors (the same as --window and --ink in renderer/styles.css).
const winColors = () => (nativeTheme.shouldUseDarkColors
  ? { color: '#1C1F25', symbolColor: '#E9ECF1' }
  : { color: '#F6F7F9', symbolColor: '#1A2130' });
const TOOLBAR_HEIGHT = 52;

function createWindow() {
  const chrome = IS_WIN
    ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...winColors(), height: TOOLBAR_HEIGHT },
      backgroundColor: winColors().color,
      icon: path.join(__dirname, 'renderer', 'brand', 'icon.png'),
    }
    : {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
    };
  win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'Clearspace',
    ...chrome,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}
if (IS_WIN) {
  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) { win.setTitleBarOverlay({ ...winColors(), height: TOOLBAR_HEIGHT }); win.setBackgroundColor(winColors().color); }
  });
}

// On Windows the menu bar is hidden (the window has its own toolbar); the menu still provides the keyboard shortcuts,
// and replaces Electron's default one, whose Ctrl+R would reload the window instead of scanning again.
function buildMenu() {
  const template = [
    ...(IS_WIN ? [] : [{ role: 'appMenu' }]),
    {
      label: 'File',
      submenu: [
        { label: 'Scan Again', accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.send('menu', 'rescan') },
        { type: 'separator' },
        IS_WIN ? { role: 'quit', label: 'Exit' } : { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    ...(IS_WIN ? [] : [{ role: 'windowMenu' }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
const send = (ch, payload) => win && !win.isDestroyed() && win.webContents.send(ch, payload);

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, s) => {
  const cur = getSettings();
  const next = {
    projectRoots: Array.isArray(s.projectRoots)
      ? s.projectRoots.filter((x) => typeof x === 'string' && x && !rootProblem(path.resolve(expandHome(x))))
      : cur.projectRoots,
    inactiveDays: Math.min(365, Math.max(1, Number(s.inactiveDays) || cur.inactiveDays)),
    scanOnLaunch: typeof s.scanOnLaunch === 'boolean' ? s.scanOnLaunch : cur.scanOnLaunch,
  };
  writeJSON(settingsFile(), next);
  return next;
});
ipcMain.handle('history:get', () => readJSON(historyFile(), []));
ipcMain.handle('disk:get', () => disksInfo(getSettings().projectRoots));

ipcMain.handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: HOME, buttonLabel: 'Add folder' });
  if (r.canceled || !r.filePaths[0]) return null;
  let real = r.filePaths[0];
  try { real = fs.realpathSync.native(real); } catch {}
  const why = rootProblem(real);
  if (why) {
    await dialog.showMessageBox(win, { type: 'warning', message: 'Clearspace cannot scan this folder', detail: `Pick a folder that holds your projects: ${why}.` });
    return null;
  }
  return tilde(real);
});

ipcMain.handle('reveal', (_e, p) => {
  if (!lastScan) return;
  // Only reveal paths that came from the scan.
  const ok = lastScan.items.some((it) => it.paths.includes(p));
  if (ok) shell.showItemInFolder(p);
});

ipcMain.handle('open:fullDiskAccess', () => {
  if (!IS_WIN) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
});

let scanCounter = 0;
ipcMain.handle('scan', async () => {
  if (busy) return { error: 'Clearspace is already working.' };
  busy = true;
  lastScan = null;
  try {
    const result = await scan(getSettings(), (p) => send('scan:progress', p));
    result.scanId = `${Date.now()}-${++scanCounter}`;
    lastScan = result;
    return result;
  } catch (e) {
    return { error: e.message || String(e) };
  } finally {
    busy = false;
  }
});

ipcMain.handle('clean', async (_e, ids, scanId) => {
  if (busy) return { error: 'Clearspace is already working.' };
  if (!lastScan) return { error: 'Scan first.' };
  if (scanId !== lastScan.scanId) return { error: 'The list changed since you reviewed it. Scan again and review it once more.' };
  if (!Array.isArray(ids) || !ids.length) return { error: 'Nothing selected.' };
  const items = lastScan.items.filter((it) => ids.includes(it.id) && it.risk !== 'locked');
  busy = true;
  cleaning = true;
  try {
    const result = await clean(
      items,
      { trash: (p) => shell.trashItem(p), projectRoots: getSettings().projectRoots },
      (p) => send('clean:progress', p),
    );
    const history = readJSON(historyFile(), []);
    history.unshift({
      at: result.finishedAt,
      freed: result.freed,
      estimated: result.estimated,
      items: result.results.filter((r) => r.status === 'done').length,
    });
    writeJSON(historyFile(), history.slice(0, 50));
    lastScan = null; // force a fresh scan before the next clean
    return result;
  } catch (e) {
    return { error: e.message || String(e) };
  } finally {
    busy = false;
    cleaning = false;
  }
});

// ---------- lifecycle ----------
app.setName('Clearspace');
if (IS_WIN) app.setAppUserModelId('com.devripon.clearspace');
// One window only: a second scan or clean from another copy of the app must not run at the same time.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.whenReady().then(async () => {
  await fixPath();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
// Never quit or close in the middle of cleaning (a git or pnpm command could be cut off).
app.on('before-quit', (e) => {
  if (cleaning) {
    e.preventDefault();
    dialog.showMessageBox(win, { type: 'info', message: 'Clearspace is still working', detail: 'Wait until it finishes, then quit.' });
  }
});
app.on('browser-window-created', (_e, w) => {
  w.on('close', (e) => { if (cleaning) e.preventDefault(); });
});
nativeTheme.themeSource = 'system';
