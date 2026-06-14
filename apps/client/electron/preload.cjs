const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notoc', {
  platform: 'electron',
  saveAuthFile: (authFile) => ipcRenderer.invoke('auth-file:save', authFile),
  openAuthFile: () => ipcRenderer.invoke('auth-file:open'),
  openImageFile: () => ipcRenderer.invoke('image-file:open'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:maximize-toggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getScreenSources: () => ipcRenderer.invoke('screen:get-sources'),
  selectScreenSource: (sourceId) => ipcRenderer.invoke('screen:select-source', sourceId),
  registerPushToTalk: (code) => ipcRenderer.invoke('ptt:register', code),
  unregisterPushToTalk: () => ipcRenderer.invoke('ptt:unregister'),
  onPushToTalkDown: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ptt:down', handler);
    return () => ipcRenderer.removeListener('ptt:down', handler);
  },
  onPushToTalkUp: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ptt:up', handler);
    return () => ipcRenderer.removeListener('ptt:up', handler);
  }
});
