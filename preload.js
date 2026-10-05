'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  scan: () => ipcRenderer.invoke('scan'),
  clean: (ids, scanId) => ipcRenderer.invoke('clean', ids, scanId),
  getDisk: () => ipcRenderer.invoke('disk:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  getHistory: () => ipcRenderer.invoke('history:get'),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  openFullDiskAccess: () => ipcRenderer.invoke('open:fullDiskAccess'),
  onScanProgress: listen('scan:progress'),
  onCleanProgress: listen('clean:progress'),
  onMenu: listen('menu'),
});
