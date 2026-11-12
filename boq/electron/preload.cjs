const { contextBridge, ipcRenderer } = require('electron');

let dataPath = '';
ipcRenderer.invoke('data:path').then((p) => { dataPath = p; });

contextBridge.exposeInMainWorld('kayanNative', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (bytes) => ipcRenderer.invoke('data:save', bytes),
  loadDekel: () => ipcRenderer.invoke('dekel:load'),
  saveDekel: (bytes) => ipcRenderer.invoke('dekel:save', bytes),
  dataPath: () => dataPath,
  printToPdf: (name) => ipcRenderer.invoke('print:pdf', name),
  fetchCbs: (code) => ipcRenderer.invoke('cbs:fetch', code),
});
