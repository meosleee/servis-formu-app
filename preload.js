const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  firmaEkle: (unvan, vkn) => ipcRenderer.invoke('firma-ekle', unvan, vkn),
  firmalariGetir: () => ipcRenderer.invoke('firmalari-getir'),
  firmaGuncelle: (id, unvan, vkn) => ipcRenderer.invoke('firma-guncelle', id, unvan, vkn),
  firmaSil: (id) => ipcRenderer.invoke('firma-sil', id),

  lokasyonEkle: (firmaId, adres, telefon) => ipcRenderer.invoke('lokasyon-ekle', firmaId, adres, telefon),
  lokasyonlariGetir: (firmaId) => ipcRenderer.invoke('lokasyonlari-getir', firmaId),
  lokasyonGuncelle: (id, adres, telefon) => ipcRenderer.invoke('lokasyon-guncelle', id, adres, telefon),
  lokasyonSil: (id) => ipcRenderer.invoke('lokasyon-sil', id),

  urunEkle: (ad, birimFiyat, kdvOrani) => ipcRenderer.invoke('urun-ekle', ad, birimFiyat, kdvOrani),
  urunleriGetir: () => ipcRenderer.invoke('urunleri-getir'),
  urunGuncelle: (id, ad, birimFiyat, kdvOrani) => ipcRenderer.invoke('urun-guncelle', id, ad, birimFiyat, kdvOrani),
  urunSil: (id) => ipcRenderer.invoke('urun-sil', id),

  formKaydet: (form) => ipcRenderer.invoke('form-kaydet', form),
  formlariGetir: (filtre) => ipcRenderer.invoke('formlari-getir', filtre),
  formDetayGetir: (formId) => ipcRenderer.invoke('form-detay-getir', formId),
  formSil: (id) => ipcRenderer.invoke('form-sil', id),
});