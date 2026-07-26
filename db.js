const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'servisformu.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS firmalar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unvan TEXT NOT NULL,
    vkn TEXT
  );

  CREATE TABLE IF NOT EXISTS lokasyonlar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firma_id INTEGER NOT NULL,
    adres TEXT,
    telefon TEXT,
    FOREIGN KEY (firma_id) REFERENCES firmalar(id)
  );

  CREATE TABLE IF NOT EXISTS urunler (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad TEXT NOT NULL,
    birim_fiyat REAL,
    kdv_orani REAL DEFAULT 20
  );

  CREATE TABLE IF NOT EXISTS servis_formlari (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_no TEXT,
    firma_id INTEGER NOT NULL,
    lokasyon_id INTEGER NOT NULL,
    tarih TEXT,
    sikayet TEXT,
    yapilan_islem TEXT,
    kdv_orani REAL DEFAULT 20,
    FOREIGN KEY (firma_id) REFERENCES firmalar(id),
    FOREIGN KEY (lokasyon_id) REFERENCES lokasyonlar(id)
  );

  CREATE TABLE IF NOT EXISTS form_kalemleri (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER NOT NULL,
    urun_id INTEGER,
    seri_no TEXT,
    aciklama TEXT,
    adet REAL,
    birim_fiyat REAL,
    FOREIGN KEY (form_id) REFERENCES servis_formlari(id),
    FOREIGN KEY (urun_id) REFERENCES urunler(id)
  );
`);

module.exports = db;