const { createFaturaClient } = require('fatura');
const log = require('electron-log');
const kimlikDeposu = require('./kimlikDeposu');

// formId -> { client, token, ortam, taslak, found, telefon, operationId, zamanAsimi }
const oturumlar = new Map();

// GİB'in "aynı anda birden fazla giriş" kilidi, düzgün logout yapılmayan oturumlarda
// hesabı saatlerce kilitleyebiliyor (bkz. github.com/f/fatura/issues/18). Bu yüzden
// her oturum ya başarıyla biter ya da bir noktada mutlaka logout ile kapatılır.
const OTURUM_ZAMAN_ASIMI_MS = 15 * 60 * 1000;

function iki(n) { return String(n).padStart(2, '0'); }
function tarihSaatUret() {
  const s = new Date();
  return {
    tarih: `${iki(s.getDate())}/${iki(s.getMonth() + 1)}/${s.getFullYear()}`,
    saat: `${iki(s.getHours())}:${iki(s.getMinutes())}:${iki(s.getSeconds())}`,
  };
}

async function findInvoiceTekrarDenemeli(client, token, taslak, deneme = 5, bekleMs = 1500) {
  for (let i = 0; i < deneme; i++) {
    const found = await client.findInvoice(token, taslak);
    if (found) return found;
    await new Promise((r) => setTimeout(r, bekleMs));
  }
  throw new Error('Taslak GİB sisteminde henüz görünmüyor. Birkaç saniye sonra "Devam et" ile tekrar dene.');
}

function eslestirAlici(ham) {
  if (!ham || typeof ham !== 'object' || !ham.unvan) return null;
  // Alan adları GİB TEST ortamında canlı doğrulandı (2026-08-02): getRecipientDataByTaxIDOrTRID
  // sadece unvan/adi/soyadi/vergiDairesi döndürüyor, adres bilgisi YOK — o yüzden adres hep
  // formdaki yerel lokasyon kaydından geliyor (bkz. faturaVerisiOlustur çağrısı).
  return {
    unvan: ham.unvan,
    vergiDairesi: ham.vergiDairesi,
  };
}

function faturaVerisiOlustur({ vkn, unvanYerel, adresYerel, kalemler, kdvOrani, alici }) {
  const { tarih, saat } = tarihSaatUret();
  const items = kalemler.map((k) => {
    const fiyat = k.adet * k.birim_fiyat;
    return {
      name: k.aciklama,
      quantity: k.adet,
      unitPrice: k.birim_fiyat,
      price: fiyat,
      VATRate: kdvOrani,
      VATAmount: (fiyat * kdvOrani) / 100,
    };
  });
  const grandTotal = items.reduce((s, i) => s + i.price, 0);
  const totalVAT = (grandTotal * kdvOrani) / 100;
  return {
    date: tarih,
    time: saat,
    taxIDOrTRID: vkn,
    title: (alici && alici.unvan) || unvanYerel,
    fullAddress: (alici && alici.adres) || adresYerel || '',
    taxOffice: (alici && alici.vergiDairesi) || '',
    items,
    grandTotal,
    totalVAT,
    grandTotalInclVAT: grandTotal + totalVAT,
    paymentTotal: grandTotal + totalVAT,
  };
}

function zamanAsimiKur(formId) {
  const o = oturumlar.get(formId);
  if (!o) return;
  if (o.zamanAsimi) clearTimeout(o.zamanAsimi);
  o.zamanAsimi = setTimeout(() => {
    log.warn(`[earsiv] Oturum zaman aşımına uğradı (${OTURUM_ZAMAN_ASIMI_MS / 60000} dk), form ${formId}, güvenli çıkış yapılıyor.`);
    oturumuKapat(formId);
  }, OTURUM_ZAMAN_ASIMI_MS);
}

async function oturumuKapat(formId) {
  const o = oturumlar.get(formId);
  if (!o) return;
  if (o.zamanAsimi) clearTimeout(o.zamanAsimi);
  oturumlar.delete(formId);
  try {
    await o.client.logout(o.token);
  } catch (e) {
    log.warn('[earsiv] Güvenli çıkış başarısız (görmezden geliniyor):', e.message);
  }
}

async function faturaBaslat({ formId, vkn, unvanYerel, adresYerel, kalemler, kdvOrani, mevcutUuid, mevcutTarih }) {
  // Aynı uygulama oturumu içinde tekrar tıklanırsa (örn. çift tıklama) zaten açık
  // olan oturumu yeniden kullan — GİB'e ikinci bir login isteği atıp kendi kendimizi
  // "aynı anda birden fazla giriş" hatasına düşürmeyelim.
  const mevcutOturum = oturumlar.get(formId);
  if (mevcutOturum) {
    zamanAsimiKur(formId);
    return { uuid: mevcutOturum.taslak.uuid, tarih: mevcutOturum.taslak.date, ortam: mevcutOturum.ortam };
  }

  const kimlik = kimlikDeposu.oku();
  if (!kimlik) throw new Error('GİB kullanıcı adı/şifresi tanımlı değil. Ayarlar sekmesinden gir.');

  const client = createFaturaClient(kimlik.ortam);
  let token;
  try {
    token = await client.getToken(kimlik.kullaniciAdi, kimlik.sifre);
  } catch (e) {
    log.error(`[earsiv] Giriş başarısız (${kimlik.ortam}), form ${formId}:`, e.message);
    throw e;
  }

  try {
    let taslak;
    if (mevcutUuid && mevcutTarih) {
      taslak = { date: mevcutTarih, uuid: mevcutUuid };
    } else {
      let alici = null;
      try {
        alici = eslestirAlici(await client.getRecipientDataByTaxIDOrTRID(token, vkn));
      } catch (e) {
        log.warn('[earsiv] VKN sorgusu başarısız, yerel bilgiyle devam:', e.message);
      }
      const invoiceDetails = faturaVerisiOlustur({ vkn, unvanYerel, adresYerel, kalemler, kdvOrani, alici });
      taslak = await client.createDraftInvoice(token, invoiceDetails);
      log.info(`[earsiv] Taslak oluşturuldu (${kimlik.ortam}): ${taslak.uuid}`);
    }

    const found = await findInvoiceTekrarDenemeli(client, token, taslak);
    oturumlar.set(formId, { client, token, ortam: kimlik.ortam, taslak, found, telefon: kimlik.telefon });
    zamanAsimiKur(formId);
    return { uuid: taslak.uuid, tarih: taslak.date, ortam: kimlik.ortam };
  } catch (e) {
    log.error(`[earsiv] Taslak/bulma aşaması başarısız, form ${formId}:`, e.message);
    await client.logout(token).catch(() => {});
    throw e;
  }
}

async function smsGonder({ formId }) {
  const o = oturumlar.get(formId);
  if (!o) throw new Error('Aktif bir taslak oturumu yok, "Devam et" ile yeniden başlat.');
  try {
    let telefon = o.telefon;
    if (!telefon) {
      const kullanici = await o.client.getUserData(o.token);
      telefon = kullanici.phoneNumber;
    }
    if (!telefon) throw new Error('GİB hesabına kayıtlı telefon numarası bulunamadı. Ayarlar\'dan elle gir.');
    o.operationId = await o.client.sendSignSMSCode(o.token, telefon);
    zamanAsimiKur(formId);
  } catch (e) {
    await oturumuKapat(formId);
    throw e;
  }
}

async function smsDogrulaVeImzala({ formId, kod }) {
  const o = oturumlar.get(formId);
  if (!o) throw new Error('Aktif bir taslak oturumu yok, "Devam et" ile yeniden başlat.');
  // Yanlış kod girilirse oturumu KAPATMIYORUZ — aynı operationId ile tekrar denenebilsin.
  await o.client.verifySignSMSCode(o.token, kod, o.operationId);
  await o.client.signDraftInvoice(o.token, o.found); // GERİ ALINAMAZ
  log.info(`[earsiv] İMZALANDI: form ${formId}, uuid ${o.taslak.uuid}, ortam ${o.ortam}`);
  const indirmeUrl = o.client.getDownloadURL(o.token, o.taslak.uuid, { signed: true });
  const uuid = o.taslak.uuid;
  await oturumuKapat(formId);
  return { indirmeUrl, uuid };
}

async function iptalEt({ formId }) {
  await oturumuKapat(formId);
}

async function indir({ uuid, tarih, ortam }) {
  const kimlik = kimlikDeposu.oku();
  if (!kimlik) throw new Error('GİB kimlik bilgisi yok.');
  const client = createFaturaClient(ortam || kimlik.ortam);
  const token = await client.getToken(kimlik.kullaniciAdi, kimlik.sifre);
  const url = client.getDownloadURL(token, uuid, { signed: true });
  const { shell } = require('electron');
  await shell.openExternal(url);
  // URL'in içine gömülü token'ı tarayıcı/indirme yöneticisi kullanana kadar oturumu
  // hemen kapatmıyoruz; kısa bir süre sonra best-effort çıkış yapılır.
  setTimeout(() => { client.logout(token).catch(() => {}); }, 5000);
}

module.exports = { faturaBaslat, smsGonder, smsDogrulaVeImzala, iptalEt, indir };
