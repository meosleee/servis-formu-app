const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const db = require('./db');

function createWindow() {
  const win = new BrowserWindow({
    width: 1150,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Firma ----
ipcMain.handle('firma-ekle', (event, unvan, vkn) => {
  return db.prepare('INSERT INTO firmalar (unvan, vkn) VALUES (?, ?)').run(unvan, vkn).lastInsertRowid;
});
ipcMain.handle('firmalari-getir', () => db.prepare('SELECT * FROM firmalar ORDER BY unvan').all());
ipcMain.handle('firma-guncelle', (event, id, unvan, vkn) => {
  db.prepare('UPDATE firmalar SET unvan = ?, vkn = ? WHERE id = ?').run(unvan, vkn, id);
});
ipcMain.handle('firma-sil', (event, id) => {
  db.prepare('DELETE FROM lokasyonlar WHERE firma_id = ?').run(id);
  db.prepare('DELETE FROM firmalar WHERE id = ?').run(id);
});

// ---- Adres ----
ipcMain.handle('lokasyon-ekle', (event, firmaId, adres, telefon) => {
  return db.prepare('INSERT INTO lokasyonlar (firma_id, adres, telefon) VALUES (?, ?, ?)').run(firmaId, adres, telefon).lastInsertRowid;
});
ipcMain.handle('lokasyonlari-getir', (event, firmaId) => {
  return db.prepare('SELECT * FROM lokasyonlar WHERE firma_id = ? ORDER BY adres').all(firmaId);
});
ipcMain.handle('lokasyon-guncelle', (event, id, adres, telefon) => {
  db.prepare('UPDATE lokasyonlar SET adres = ?, telefon = ? WHERE id = ?').run(adres, telefon, id);
});
ipcMain.handle('lokasyon-sil', (event, id) => {
  db.prepare('DELETE FROM lokasyonlar WHERE id = ?').run(id);
});

// ---- Ürün ----
ipcMain.handle('urun-ekle', (event, ad, birimFiyat, kdvOrani) => {
  return db.prepare('INSERT INTO urunler (ad, birim_fiyat, kdv_orani) VALUES (?, ?, ?)').run(ad, birimFiyat, kdvOrani).lastInsertRowid;
});
ipcMain.handle('urunleri-getir', () => db.prepare('SELECT * FROM urunler ORDER BY ad').all());
ipcMain.handle('urun-guncelle', (event, id, ad, birimFiyat, kdvOrani) => {
  db.prepare('UPDATE urunler SET ad = ?, birim_fiyat = ?, kdv_orani = ? WHERE id = ?').run(ad, birimFiyat, kdvOrani, id);
});
ipcMain.handle('urun-sil', (event, id) => {
  db.prepare('DELETE FROM urunler WHERE id = ?').run(id);
});

// ---- Servis Formu ----
ipcMain.handle('form-kaydet', (event, form) => {
  const { firmaId, lokasyonId, tarih, sikayet, yapilanIslem, kdvOrani, kalemler } = form;

  const mevcutAdet = db.prepare('SELECT COUNT(*) as adet FROM servis_formlari').get().adet;
  const yil = new Date(tarih).getFullYear();
  const formNo = `F-${yil}-${String(mevcutAdet + 1).padStart(4, '0')}`;

  const formId = db.prepare(`
    INSERT INTO servis_formlari (form_no, firma_id, lokasyon_id, tarih, sikayet, yapilan_islem, kdv_orani)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(formNo, firmaId, lokasyonId, tarih, sikayet, yapilanIslem, kdvOrani).lastInsertRowid;

  const kalemStmt = db.prepare(`
    INSERT INTO form_kalemleri (form_id, urun_id, seri_no, aciklama, adet, birim_fiyat)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const k of kalemler) {
    kalemStmt.run(formId, k.urunId || null, k.seriNo || '', k.aciklama, k.adet, k.birimFiyat);
  }

  return { formId, formNo };
});

ipcMain.handle('formlari-getir', (event, filtre) => {
  let sql = `
    SELECT sf.*, f.unvan as firma_unvan, l.adres as lokasyon_adres
    FROM servis_formlari sf
    JOIN firmalar f ON f.id = sf.firma_id
    JOIN lokasyonlar l ON l.id = sf.lokasyon_id
    WHERE 1=1
  `;
  const params = [];
  if (filtre.firmaAdi) {
    sql += ' AND f.unvan LIKE ?';
    params.push(`%${filtre.firmaAdi}%`);
  }
  if (filtre.tarihBaslangic) {
    sql += ' AND sf.tarih >= ?';
    params.push(filtre.tarihBaslangic);
  }
  if (filtre.tarihBitis) {
    sql += ' AND sf.tarih <= ?';
    params.push(filtre.tarihBitis);
  }
  sql += ' ORDER BY sf.tarih DESC';

  const formlar = db.prepare(sql).all(...params);

  return formlar.map(f => {
    const kalemler = db.prepare('SELECT * FROM form_kalemleri WHERE form_id = ?').all(f.id);
    const araToplam = kalemler.reduce((s, k) => s + (k.adet * k.birim_fiyat), 0);
    const genelToplam = araToplam + (araToplam * f.kdv_orani / 100);
    return { ...f, araToplam, genelToplam };
  });
});

ipcMain.handle('form-detay-getir', (event, formId) => {
  const form = db.prepare(`
    SELECT sf.*, f.unvan as firma_unvan, f.vkn as firma_vkn, l.adres as lokasyon_adres, l.telefon as lokasyon_telefon
    FROM servis_formlari sf
    JOIN firmalar f ON f.id = sf.firma_id
    JOIN lokasyonlar l ON l.id = sf.lokasyon_id
    WHERE sf.id = ?
  `).get(formId);
  const kalemler = db.prepare('SELECT * FROM form_kalemleri WHERE form_id = ?').all(formId);
  return { form, kalemler };
});

ipcMain.handle('form-sil', (event, id) => {
  db.prepare('DELETE FROM form_kalemleri WHERE form_id = ?').run(id);
  db.prepare('DELETE FROM servis_formlari WHERE id = ?').run(id);
});