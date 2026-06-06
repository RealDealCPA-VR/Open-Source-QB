// Electron main process for BookKeeper AI (desktop).
//
// Architecture: the React/Next.js UI and the accounting engine (PGlite local DB) run inside a
// Next.js server. In production we launch the Next standalone server as a child process on a free
// local port and point a BrowserWindow at it; in dev we attach to `next dev` on :3000.
//
// The active company file is a local data directory; we set BKA_DATA_DIR before starting the
// server so lib/db persists there. This keeps all financial data on the user's machine (offline).

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const net = require('node:net');

const isDev = !app.isPackaged;
let mainWindow = null;
let serverProcess = null;

// --- single instance lock ---
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function companiesRoot() {
  return path.join(app.getPath('userData'), 'companies');
}

function activeCompanyDir() {
  // For now a single "default" company file; the onboarding wizard / company switcher will manage many.
  const dir = path.join(companiesRoot(), 'default');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startNextServer() {
  if (isDev) return 'http://localhost:3000';

  const port = await findFreePort();
  const serverEntry = path.join(process.resourcesPath, 'app', 'server.js'); // .next/standalone/server.js
  serverProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      BKA_DATA_DIR: activeCompanyDir(),
      BKA_MIGRATIONS_DIR: path.join(process.resourcesPath, 'app', 'drizzle'),
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'inherit',
  });

  // wait until the port is accepting connections
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(port);
  return url;
}

function waitForServer(port, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error('Next server did not start in time'));
        else setTimeout(tryConnect, 250);
      });
    };
    tryConnect();
  });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Company…', click: () => mainWindow?.webContents.send('menu', 'new-company') },
        { label: 'Open Company…', click: () => mainWindow?.webContents.send('menu', 'open-company') },
        { type: 'separator' },
        { label: 'Import Bank File…', click: () => mainWindow?.webContents.send('menu', 'import') },
        { label: 'Backup Company…', click: () => mainWindow?.webContents.send('menu', 'backup') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    {
      label: 'Reports',
      submenu: [
        { label: 'Profit & Loss', click: () => navigate('/reports/profit-loss') },
        { label: 'Balance Sheet', click: () => navigate('/reports/balance-sheet') },
        { label: 'Trial Balance', click: () => navigate('/reports/trial-balance') },
        { label: 'General Ledger', click: () => navigate('/reports/general-ledger') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'BookKeeper AI on the web', click: () => shell.openExternal('https://github.com/') },
        { label: 'About', click: () => dialog.showMessageBox(mainWindow, { message: 'BookKeeper AI', detail: 'Open-source desktop accounting with AI error correction.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function navigate(route) {
  mainWindow?.webContents.send('navigate', route);
}

async function createWindow() {
  const url = await startNextServer();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'BookKeeper AI',
    backgroundColor: '#0b1f3a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await mainWindow.loadURL(url);
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  buildMenu();
  runDueRecurring(url);
}

// Generate any due recurring/memorized transactions on launch (best-effort).
function runDueRecurring(url) {
  try {
    fetch(`${url}/api/recurring/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  } catch {
    // global fetch unavailable / server not ready — ignore.
  }
}

// --- IPC for native dialogs the renderer needs ---
ipcMain.handle('dialog:openFile', async (_e, filters) => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: filters || [] });
  if (res.canceled || !res.filePaths[0]) return null;
  const filePath = res.filePaths[0];
  return { filePath, content: fs.readFileSync(filePath, 'utf8') };
});

ipcMain.handle('dialog:saveFile', async (_e, { defaultName, content }) => {
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, content);
  return res.filePath;
});

ipcMain.handle('app:dataDir', () => activeCompanyDir());

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function checkForUpdates() {
  if (isDev) return;
  try {
    // electron-updater reads the publish config baked in at build time. No-ops if none is set.
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('menu', 'update-ready');
    });
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch {
    // electron-updater not available / no feed configured — ignore.
  }
}

app.whenReady().then(async () => {
  await createWindow();
  checkForUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
