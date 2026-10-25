const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('skDesktop', { retry: () => ipcRenderer.send('retry'), isDesktop: true });
