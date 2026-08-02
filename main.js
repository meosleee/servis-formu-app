const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

app.disableHardwareAcceleration();

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

  log.transports.file.level = 'info';
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

app.whenReady().then(() => {
  createWindow();
  guncellemeKontroluBaslat();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
