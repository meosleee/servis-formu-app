const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function dosyaYolu() {
  return path.join(app.getPath('userData'), 'earsiv-kimlik.json');
}

function kaydet({ kullaniciAdi, sifre, ortam, telefon }) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Bu cihazda güvenli depolama (Keychain/DPAPI) kullanılamıyor.');
  }
  const veri = {
    kullaniciAdi,
    sifreliSifre: safeStorage.encryptString(sifre).toString('base64'),
    ortam: ortam === 'PROD' ? 'PROD' : 'TEST',
    telefon: telefon || '',
  };
  fs.writeFileSync(dosyaYolu(), JSON.stringify(veri), { mode: 0o600 });
}

function oku() {
  try {
    const veri = JSON.parse(fs.readFileSync(dosyaYolu(), 'utf8'));
    const sifre = safeStorage.decryptString(Buffer.from(veri.sifreliSifre, 'base64'));
    return {
      kullaniciAdi: veri.kullaniciAdi,
      sifre,
      ortam: veri.ortam || 'TEST',
      telefon: veri.telefon || '',
    };
  } catch {
    return null;
  }
}

function sil() {
  try { fs.unlinkSync(dosyaYolu()); } catch {}
}

function ozet() {
  try {
    const veri = JSON.parse(fs.readFileSync(dosyaYolu(), 'utf8'));
    return {
      tanimliMi: true,
      kullaniciAdi: veri.kullaniciAdi,
      ortam: veri.ortam || 'TEST',
      telefon: veri.telefon || '',
    };
  } catch {
    return { tanimliMi: false, kullaniciAdi: '', ortam: 'TEST', telefon: '' };
  }
}

module.exports = { kaydet, oku, sil, ozet };
