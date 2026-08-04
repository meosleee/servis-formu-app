const { createFaturaClient } = require('fatura');
const log = require('electron-log');
const kimlikDeposu = require('./kimlikDeposu');

// formId -> { client, token, ortam, taslak, found, telefon, operationId, zamanAsimi }
const oturumlar = new Map();

// GİB'in "aynı anda birden fazla giriş" kilidi, düzgün logout yapılmayan oturumlarda
// hesabı saatlerce kilitleyebiliyor (bkz. github.com/f/fatura/issues/18). Bu yüzden
// her oturum ya başarıyla biter ya da bir noktada mutlaka logout ile kapatılır.
const OTURUM_ZAMAN_ASIMI_MS = 15 * 60 * 1000;

// `fatura` paketinin `getDownloadURL()`'ü `cmd=downloadResource` kullanıyor, GİB bunu
// "Bu işlem için yetkiniz yok" ile reddediyor. Referans (`github.com/mlevent/fatura`,
// PHP) doğru komutun `EARSIV_PORTAL_BELGE_INDIR` olduğunu gösterdi — bunu elle üretiyoruz.
function indirmeUrlUret(client, token, uuid, signed) {
  return `${client.baseURL}/earsiv-services/download?token=${token}&ettn=${uuid}&belgeTip=FATURA&onayDurumu=${encodeURIComponent(signed ? 'Onaylandı' : 'Onaylanmadı')}&cmd=EARSIV_PORTAL_BELGE_INDIR`;
}

function iki(n) { return String(n).padStart(2, '0'); }
function tarihSaatUret() {
  const s = new Date();
  return {
    tarih: `${iki(s.getDate())}/${iki(s.getMonth() + 1)}/${s.getFullYear()}`,
    saat: `${iki(s.getHours())}:${iki(s.getMinutes())}:${iki(s.getSeconds())}`,
  };
}

// KÖK NEDEN (2026-08-02, gerçek GİB portalı DevTools'tan yakalanan trafikle doğrulandı):
// GİB'in kendi "Oluştur" isteği `faturaUuid` alanını hep BOŞ gönderiyor — GİB kendi
// ID'sini kendisi atıyor ve bu gerçek ID, oluşturma cevabında GERİ DÖNMÜYOR (sadece
// "Faturanız başarıyla oluşturulmuştur..." mesajı dönüyor). `fatura` paketi ise
// (patch'lenmeden önce de, sonra da) burada hep KENDİ ÜRETTİĞİ bir uuid gönderiyordu
// ve biz de arama yaparken o sahte uuid'i arıyorduk — GİB'de hiçbir zaman var olmayan
// bir ID'yi aradığımız için taslak asla "bulunamıyordu". `patches/fatura+0.2.1.patch`
// artık bu alanı gerçek portal gibi boş gönderiyor; burada da artık ID ile değil,
// VKN + tarih eşleşmesiyle taslağı buluyoruz (`aliciVknTckn` alanı üzerinden).
async function faturaAra(client, token, tarih, vkn, biliniyorEttn) {
  const liste = await client.getAllInvoicesByDateRange(token, { startDate: tarih, endDate: tarih });
  if (biliniyorEttn) {
    const eslesen = liste.find((inv) => inv.ettn === biliniyorEttn);
    if (eslesen) return eslesen;
  }
  const eslesenler = liste.filter((inv) => inv.aliciVknTckn === vkn);
  if (eslesenler.length > 1) {
    log.warn(`[earsiv] Aynı VKN'ye (${vkn}) bugün ${eslesenler.length} kayıt var, en yüksek belge numaralı olan seçiliyor.`);
  }
  eslesenler.sort((a, b) => (a.belgeNumarasi < b.belgeNumarasi ? 1 : -1));
  return eslesenler[0] || null;
}

async function findInvoiceTekrarDenemeli(client, token, tarih, vkn, biliniyorEttn, deneme = 8, bekleMs = 1500) {
  for (let i = 0; i < deneme; i++) {
    const found = await faturaAra(client, token, tarih, vkn, biliniyorEttn);
    log.info(`[earsiv] Arama denemesi ${i + 1}: vkn=${vkn}, sonuç=${found ? `${found.ettn} (${found.belgeNumarasi})` : 'yok'}`);
    if (found) return found;
    await new Promise((r) => setTimeout(r, bekleMs));
  }
  throw new Error('Fatura GİB sisteminde henüz görünmüyor. Birkaç saniye sonra "Devam et" ile tekrar dene.');
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

function faturaVerisiOlustur({ vkn, unvanYerel, adresYerel, kalemler, kdvOrani, alici, not }) {
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
    note: not || '',
    // `fatura` paketinin varsayılanları (invoiceType/hangiTip) GİB'in taslak ARAMA
    // sorgusuyla (findInvoice → getAllInvoicesByDateRange, hangiTip="5000/30000")
    // uyuşmuyor — taslak GİB'e kabul ediliyor ama bu yüzden hiçbir arama onu
    // bulamıyor. github.com/xBuhari/buhari-earsiv-api'nin çalışan koduyla
    // doğrulanan doğru değerler burada elle veriliyor.
    invoiceType: 'SATIS',
    hangiTip: '5000/30000',
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

async function faturaBaslat({ formId, vkn, unvanYerel, adresYerel, kalemler, kdvOrani, not, mevcutUuid, mevcutTarih }) {
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

  // Taslak oluşturma adımı ayrı try/catch'te: burada bir hata olursa GERÇEKTEN yeni
  // bir taslak yok, normal şekilde fırlatılıp üst katmanda 'hata' olarak işlenir.
  // `mevcutTarih` varsa (daha önce oluşturma isteği GİB'e gönderilmiş ama henüz
  // bulunamamış demektir) YENİDEN OLUŞTURMUYORUZ — aksi halde her "Devam et" GİB'de
  // ayrı bir taslak daha oluştururdu.
  let tarih;
  try {
    if (mevcutTarih) {
      tarih = mevcutTarih;
    } else {
      let alici = null;
      try {
        alici = eslestirAlici(await client.getRecipientDataByTaxIDOrTRID(token, vkn));
      } catch (e) {
        log.warn('[earsiv] VKN sorgusu başarısız, yerel bilgiyle devam:', e.message);
      }
      const invoiceDetails = faturaVerisiOlustur({ vkn, unvanYerel, adresYerel, kalemler, kdvOrani, alici, not });
      const sonuc = await client.createDraftInvoice(token, invoiceDetails);
      tarih = sonuc.date;
      log.info(`[earsiv] Taslak oluşturma isteği GİB'e gönderildi (${kimlik.ortam}), tarih=${tarih}`);
      log.info('[earsiv] createDraftInvoice ham cevap: ' + JSON.stringify(sonuc));
    }
  } catch (e) {
    log.error(`[earsiv] Taslak oluşturma başarısız, form ${formId}:`, e.message);
    await client.logout(token).catch(() => {});
    throw e;
  }

  // Bulma adımı AYRI: burada hata olursa taslak GİB'de muhtemelen zaten VAR (tarih
  // GEÇERLİ), sadece henüz listede görünmüyor veya VKN eşleşmesi henüz oluşmadı.
  // Bunu genel bir throw ile kaybetmek yerine 'bulunamadi: true' ile döndürüyoruz ki
  // çağıran taraf AYNI tarihi saklayıp "Devam et" ile tekrar aratsın — yoksa her
  // denemede GİB'de yeni bir taslak daha oluşurdu.
  try {
    const found = await findInvoiceTekrarDenemeli(client, token, tarih, vkn, mevcutUuid);
    const taslak = { date: tarih, uuid: found.ettn };
    oturumlar.set(formId, { client, token, ortam: kimlik.ortam, taslak, found, telefon: kimlik.telefon });
    zamanAsimiKur(formId);
    return {
      uuid: found.ettn,
      tarih,
      ortam: kimlik.ortam,
      bulunamadi: false,
      belgeNumarasi: found.belgeNumarasi,
      aliciUnvanAdSoyad: found.aliciUnvanAdSoyad,
    };
  } catch (e) {
    log.warn(`[earsiv] Fatura henüz bulunamadı (tarih korunuyor), form ${formId}:`, e.message);
    await client.logout(token).catch(() => {});
    return { uuid: mevcutUuid || null, tarih, ortam: kimlik.ortam, bulunamadi: true };
  }
}

// GİB'in kendi portalı, imzalama SMS'i için telefon numarasını `getUserData`
// (EARSIV_PORTAL_KULLANICI_BILGILERI_GETIR) ile DEĞİL, ayrı ve özel bir komutla
// çekiyor: EARSIV_PORTAL_TELEFONNO_SORGULA → { telefon: "5551234567" } (başında 0
// yok, temiz 10 hane). Gerçek DevTools trafiğiyle doğrulandı (2026-08-02). Önceki
// kod `getUserData().phoneNumber` (`d.telNo`) kullanıyordu — muhtemelen SMS gönderme
// adımındaki "NullPointerException" hatasının sebebi buydu (yanlış/boş alan).
async function telefonNoSorgula(client, token) {
  const result = await client.runCommand(token, 'EARSIV_PORTAL_TELEFONNO_SORGULA', 'RG_BASITTASLAKLAR', {});
  return result && result.data && result.data.telefon;
}

// Ayarlar'dan elle girilen telefon "0555...", "+90 555...", boşluklu/tireli vb.
// olabilir — GİB'in beklediği temiz format (başında 0/90 olmayan 10 hane, örn.
// "5551234567") ile eşleşsin diye normalize ediyoruz.
function telefonNormalizeEt(ham) {
  if (!ham) return '';
  let d = String(ham).replace(/\D/g, '');
  if (d.startsWith('90') && d.length === 12) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  return d;
}

async function smsGonder({ formId }) {
  const o = oturumlar.get(formId);
  if (!o) throw new Error('Aktif bir taslak oturumu yok, "Devam et" ile yeniden başlat.');
  try {
    let telefon = telefonNormalizeEt(o.telefon);
    if (!telefon) {
      telefon = await telefonNoSorgula(o.client, o.token);
    }
    if (!telefon) throw new Error('GİB hesabına kayıtlı telefon numarası bulunamadı. Ayarlar\'dan elle gir.');
    log.info(`[earsiv] SMS gönderiliyor, form ${formId}, telefon uzunluğu=${telefon.length}, ettn=${o.taslak.uuid}`);
    // `fatura` paketinin `sendSignSMSCode`'u `result.oid` okuyor ama GİB OID'i
    // `result.data.oid` altında dönüyor (aynı mlevent/fatura (PHP) referansıyla
    // doğrulandı) — bu yüzden operationId hep undefined kalıyordu ve imzalama adımı
    // NullPointerException veriyordu. `runCommand`'ı doğrudan çağırıp doğru alandan okuyoruz.
    const smsSonuc = await o.client.runCommand(o.token, 'EARSIV_PORTAL_SMSSIFRE_GONDER', 'RG_SMSONAY', {
      CEPTEL: telefon, KCEPTEL: false, TIP: '',
    });
    o.operationId = smsSonuc && smsSonuc.data && smsSonuc.data.oid;
    if (!o.operationId) throw new Error('GİB SMS gönderdi ama işlem numarası (OID) alınamadı: ' + JSON.stringify(smsSonuc && smsSonuc.data));
    log.info(`[earsiv] SMS gönderildi, form ${formId}, operationId=${o.operationId}`);
    zamanAsimiKur(formId);
  } catch (e) {
    log.error(`[earsiv] SMS gönderme başarısız, form ${formId}:`, e.message);
    await oturumuKapat(formId);
    throw e;
  }
}

// KÖK NEDEN (2026-08-02): `fatura` paketinin ayrı çağırdığı `verifySignSMSCode`
// (EARSIV_PORTAL_SMSSIFRE_DOGRULA) GİB'de "Service Not Found" hatası verdi — bu komut
// GİB'de yok/tanınmıyor. Referans alınan `github.com/mlevent/fatura` (PHP) — aynı repo
// EARSIV_PORTAL_TELEFONNO_SORGULA'yı da bizim doğruladığımız şekilde kullanıyor,
// güvenilir kaynak — SMS doğrulama ile imzalamanın AYRI değil, TEK bir komutla
// birleşik yapıldığını gösterdi: komut adı `0lhozfib5410mp` (garip görünüyor ama
// gerçek, kaynak koddan doğrulandı), sayfa RG_SMSONAY. Parametreler: DATA
// (imzalanacak {belgeTuru:'FATURA', ettn} listesi), SIFRE (SMS kodu), OID
// (operationId), OPR: 1. Başarı `data.sonuc === '1'` ile anlaşılıyor. Ayrı bir
// signDraftInvoice çağrısına gerek yok.
async function smsDogrulaVeImzala({ formId, kod }) {
  const o = oturumlar.get(formId);
  if (!o) throw new Error('Aktif bir taslak oturumu yok, "Devam et" ile yeniden başlat.');
  // Yanlış kod girilirse oturumu KAPATMIYORUZ — aynı operationId ile tekrar denenebilsin.
  const sonuc = await o.client.runCommand(o.token, '0lhozfib5410mp', 'RG_SMSONAY', {
    DATA: [{ belgeTuru: 'FATURA', ettn: o.taslak.uuid }],
    SIFRE: kod,
    OID: o.operationId,
    OPR: 1,
  });
  log.info(`[earsiv] SMS doğrulama/imzalama ham cevap, form ${formId}: ${JSON.stringify(sonuc && sonuc.data)}`);
  if (!sonuc || !sonuc.data || sonuc.data.sonuc !== '1') {
    throw new Error('SMS kodu doğrulanamadı veya imzalama başarısız. Kodu kontrol edip tekrar dene.');
  }
  log.info(`[earsiv] İMZALANDI: form ${formId}, uuid ${o.taslak.uuid}, ortam ${o.ortam}`); // GERİ ALINAMAZ
  const indirmeUrl = indirmeUrlUret(o.client, o.token, o.taslak.uuid, true);
  const uuid = o.taslak.uuid;
  await oturumuKapat(formId);
  return { indirmeUrl, uuid };
}

async function iptalEt({ formId }) {
  await oturumuKapat(formId);
}

// Batuhan tarayıcıda GİB'in indirme sayfasını açmak yerine doğrudan PDF istiyor.
// GİB'in resmi belge HTML'ini (EARSIV_PORTAL_FATURA_GOSTER, `fatura` paketinde
// getInvoiceHTML) çekip görünmez bir pencerede render edip Electron'un kendi
// printToPDF'iyle PDF'e çeviriyoruz — tarayıcı hiç açılmıyor.
async function indir({ uuid, tarih, ortam }) {
  const kimlik = kimlikDeposu.oku();
  if (!kimlik) throw new Error('GİB kimlik bilgisi yok.');
  const client = createFaturaClient(ortam || kimlik.ortam);
  const token = await client.getToken(kimlik.kullaniciAdi, kimlik.sifre);
  let html;
  try {
    html = await client.getInvoiceHTML(token, uuid, { signed: true });
  } finally {
    await client.logout(token).catch(() => {});
  }

  const { BrowserWindow, shell, app } = require('electron');
  const fs = require('fs');
  const path = require('path');

  const pencere = new BrowserWindow({ show: false });
  try {
    await pencere.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // GİB'in HTML'i her faturada farklı uzunlukta (kalem sayısına göre) — sabit bir
    // küçültme oranı (0.9) bazı faturalarda yetmiyordu, 2. sayfaya taşıyordu. Bunun
    // yerine gerçek içerik yüksekliğini ölçüp A4'e HER ZAMAN tam sığacak oranı
    // otomatik hesaplıyoruz.
    const icerikYuksekligiPx = await pencere.webContents.executeJavaScript('document.body.scrollHeight');
    const KENAR_BOSLUK_INC = 0.4;
    const kullanilabilirYukseklikPx = (11.69 - 2 * KENAR_BOSLUK_INC) * 96;
    const olcek = Math.min(1, (kullanilabilirYukseklikPx / icerikYuksekligiPx) * 0.97);
    const pdfVerisi = await pencere.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      scale: olcek,
      margins: { marginType: 'custom', top: KENAR_BOSLUK_INC, bottom: KENAR_BOSLUK_INC, left: KENAR_BOSLUK_INC, right: KENAR_BOSLUK_INC },
    });
    const hedefYol = path.join(app.getPath('downloads'), `fatura-${uuid}.pdf`);
    fs.writeFileSync(hedefYol, pdfVerisi);
    await shell.openPath(hedefYol);
    return { yol: hedefYol };
  } finally {
    pencere.close();
  }
}

// Sadece görüntülemek için — dosyaya kaydetmeden, tarayıcı/PDF açmadan GİB'in resmi
// belge HTML'ini çekip döndürür. Uygulamanın kendi beyaz kağıt önizleyicisinde
// (`onizlemeOverlay`) gösterilir.
async function goruntule({ uuid, ortam, imzali }) {
  const kimlik = kimlikDeposu.oku();
  if (!kimlik) throw new Error('GİB kimlik bilgisi yok.');
  const client = createFaturaClient(ortam || kimlik.ortam);
  const token = await client.getToken(kimlik.kullaniciAdi, kimlik.sifre);
  try {
    const html = await client.getInvoiceHTML(token, uuid, { signed: !!imzali });
    return { html };
  } finally {
    await client.logout(token).catch(() => {});
  }
}

module.exports = { faturaBaslat, smsGonder, smsDogrulaVeImzala, iptalEt, indir, goruntule };
