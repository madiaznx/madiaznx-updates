const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('madiaznxHub', {
  getState: () => ipcRenderer.invoke('state:get'),
  refreshCatalog: () => ipcRenderer.invoke('catalog:refresh'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  saveInstallerPreference: (appId, preference) => ipcRenderer.invoke('installer-preferences:save', { appId, preference }),
  installApp: (appInfo, version) => ipcRenderer.invoke('apps:install', { appInfo, version }),
  uninstallApp: (appId) => ipcRenderer.invoke('apps:uninstall', { appId }),
  openApp: (appId) => ipcRenderer.invoke('apps:open', { appId }),
  downloadVersion: (appInfo, version) => ipcRenderer.invoke('apps:download-version', { appInfo, version }),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', { url }),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('apps:progress', handler);
    return () => ipcRenderer.removeListener('apps:progress', handler);
  },
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updates:status', handler);
    return () => ipcRenderer.removeListener('updates:status', handler);
  }
});
