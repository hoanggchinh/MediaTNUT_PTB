const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    processImage: (data) => ipcRenderer.invoke('process-image', data),
    uploadAndGenQR: (imagePath) => ipcRenderer.invoke('upload-and-qr', imagePath),
    getAssets: () => ipcRenderer.invoke('get-assets'),
    printImage: (imagePath) => ipcRenderer.invoke('print-image', imagePath)
});