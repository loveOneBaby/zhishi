const { contextBridge, ipcRenderer } = require('electron');

const updateStateChannel = 'ik:update-state';

contextBridge.exposeInMainWorld('interviewKnowledgeDesktop', {
  updates: {
    getState: () => ipcRenderer.invoke('ik:update-get-state'),
    check: () => ipcRenderer.invoke('ik:update-check'),
    download: () => ipcRenderer.invoke('ik:update-download'),
    install: () => ipcRenderer.invoke('ik:update-install'),
    onState: (listener) => {
      if (typeof listener !== 'function') return () => {};
      const handler = (_event, state) => listener(state);
      ipcRenderer.on(updateStateChannel, handler);
      return () => ipcRenderer.removeListener(updateStateChannel, handler);
    },
  },
});
