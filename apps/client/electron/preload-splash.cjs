const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashApi', {
  onUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('splash:update', handler);
    return () => ipcRenderer.removeListener('splash:update', handler);
  },
  close: () => ipcRenderer.send('splash:close')
});
