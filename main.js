const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const kimlikDeposu = require('./earsiv/kimlikDeposu');
const earsivClient = require('./earsiv/client');

app.disableHardwareAcceleration();

// electron-log dosya çıktısı: sadece güncelleme kontrolüne değil, e-Arşiv işlemlerine de
// lazım (geliştirme ortamında da), o yüzden burada paketli/paketsiz ayrımı yapılmadan kurulur.
log.transports.file.level = 'info';

function createWindow() {
  const win = new BrowserWindow({
    width: 1150,
    height: 780,
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
}

function guncellemeKontroluBaslat() {
  // Paketlenmemiş (npm start ile açılan geliştirme) ortamında güncelleme
  // sunucusu olmadığı için electron-updater hata fırlatır, o yüzden atlanır.
  if (!app.isPackaged) return;

  autoUpdater.logger = log;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  log.info('Güncelleme kontrolü başlatıldı, mevcut sürüm:', app.getVersion());

  autoUpdater.on('update-available', (bilgi) => {
    log.info('Yeni sürüm bulundu:', bilgi.version);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('Uygulama güncel, yeni sürüm yok.');
  });

  autoUpdater.on('update-downloaded', async (bilgi) => {
    log.info('Güncelleme indirildi:', bilgi.version);
    const secim = await dialog.showMessageBox({
      type: 'info',
      title: 'Güncelleme hazır',
      message: 'Petsis Servis Formu için yeni bir sürüm indirildi.',
      detail: 'Şimdi yeniden başlatıp kurulsun mu?',
      buttons: ['Şimdi kur', 'Daha sonra'],
      defaultId: 0,
      cancelId: 1,
    });
    if (secim.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (hata) => {
    log.error('Güncelleme kontrolü başarısız:', hata);
  });

  // 'error' event'i zaten log.error ile yakalıyor; checkForUpdates() promise'i de
  // ayrıca reject oluyor, .catch() olmazsa unhandled rejection uyarısı/çökme riski var.
  autoUpdater.checkForUpdates().catch(() => {});
}

function earsivIpcKur() {
  ipcMain.handle('earsiv:ayarlarOku', () => kimlikDeposu.ozet());
  ipcMain.handle('earsiv:ayarlarKaydet', (e, veri) => { kimlikDeposu.kaydet(veri); return { ok: true }; });
  ipcMain.handle('earsiv:ayarlarSil', () => { kimlikDeposu.sil(); return { ok: true }; });
  ipcMain.handle('earsiv:faturaBaslat', (e, veri) => earsivClient.faturaBaslat(veri));
  ipcMain.handle('earsiv:smsGonder', (e, veri) => earsivClient.smsGonder(veri));
  ipcMain.handle('earsiv:smsDogrula', (e, veri) => earsivClient.smsDogrulaVeImzala(veri));
  ipcMain.handle('earsiv:iptalEt', (e, veri) => earsivClient.iptalEt(veri));
  ipcMain.handle('earsiv:indir', (e, veri) => earsivClient.indir(veri));
}

app.whenReady().then(() => {
  earsivIpcKur();
  createWindow();
  guncellemeKontroluBaslat();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
