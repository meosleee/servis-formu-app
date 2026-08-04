const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('earsiv', {
  ayarlarOku: () => ipcRenderer.invoke('earsiv:ayarlarOku'),
  ayarlarKaydet: (veri) => ipcRenderer.invoke('earsiv:ayarlarKaydet', veri),
  ayarlarSil: () => ipcRenderer.invoke('earsiv:ayarlarSil'),
  faturaBaslat: (veri) => ipcRenderer.invoke('earsiv:faturaBaslat', veri),
  smsGonder: (veri) => ipcRenderer.invoke('earsiv:smsGonder', veri),
  smsDogrula: (veri) => ipcRenderer.invoke('earsiv:smsDogrula', veri),
  iptalEt: (veri) => ipcRenderer.invoke('earsiv:iptalEt', veri),
  indir: (veri) => ipcRenderer.invoke('earsiv:indir', veri),
  goruntule: (veri) => ipcRenderer.invoke('earsiv:goruntule', veri),
});
