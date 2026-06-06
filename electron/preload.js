// Secure bridge between the renderer (React UI) and Electron main.
// Exposes a minimal, audited API on window.bookkeeper — no direct Node access in the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bookkeeper', {
  /** Open a native file picker; returns { filePath, content } or null. */
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  /** Save content to a user-chosen path; returns the path or null. */
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  /** Active company data directory. */
  dataDir: () => ipcRenderer.invoke('app:dataDir'),
  /** Subscribe to main->renderer messages (menu actions, navigation). */
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, route) => cb(route)),
  isDesktop: true,
});
