# Petsis Servis Formu — Proje Notları

Bu dosya, projeye yeni katılan (veya hafızası olmayan) bir asistanın hızlıca
devralabilmesi için yazıldı. Mimari, geçmişte çözülen sorunlar ve çalışma
tercihleri burada.

---

## 1. Kullanıcı ve çalışma tarzı

- **İsim:** Batuhan. Bana "kanka" diye hitap et, sen de öyle hitap edilmeyi tercih ediyor.
- **Dil:** Türkçe, samimi ve kısa. Uzun akademik anlatım istemiyor.
- **Meslek:** Akaryakıt istasyonu teknik servis teknisyeni (Petsis / Kıvanç Buğdaycı).
  Elektronik bilgisi güçlü, hobi düzeyinde teknik projelerle uğraşıyor.
- **Yazılım seviyesi:** Temel HTML/CSS var. Kod okuyabiliyor ama mimari kararları
  asistandan bekliyor.
- **ÖNEMLİ TERCİH:** Parça parça "şu satırı bul, şununla değiştir" tarzı düzenlemeleri
  sevmiyor. **Değişen dosyanın tamamını baştan yaz, o kopyalayıp yapıştırsın.**
- Adım adım ilerlemeyi ve her adımda ne yaptığını anlamayı seviyor.
- Not tutmaya elverişli, sade açıklamalar istiyor.

---

## 2. Proje nedir

Akaryakıt istasyonlarına gidilen servislerde elle doldurulan kağıt "Servis Raporu"
formlarını dijitalleştiren masaüstü uygulaması. Kağıtlar fiziksel arşivde yer
kapladığı için dijitale taşındı.

**Temel akış:** Firma seç → adres (lokasyon) seç → şikayet/yapılan işlem yaz →
ürün/hizmet kalemleri ekle → KDV'li toplamlar otomatik hesaplansın → beyaz kağıt
önizlemesi → yazdır. Kesilen formlar arşivde saklanır, firma adı ve tarihe göre aranır.

---

## 3. Teknoloji yığını

| Katman | Teknoloji |
|---|---|
| Uygulama | Electron (masaüstü, Mac + Windows) |
| Arayüz | Tek dosya: `index.html` (HTML + CSS + JS, framework yok) |
| Bulut veritabanı | Supabase (PostgreSQL) |
| Kimlik doğrulama | Supabase Auth — e-posta + şifre |
| Yerel depolama | `localStorage` (offline-first katman) |
| Paketleme | electron-builder → Windows: NSIS installer, Mac: dmg |
| CI / derleme | GitHub Actions (Windows exe'si burada derleniyor) |
| Otomatik güncelleme | electron-updater → GitHub Releases |

**Repo:** github.com/meosleee/servis-formu-app (**public** — 2026-08-02'de otomatik
güncelleme için public'e çevrildi. service_role/secret anahtar hiçbir zaman repoya
girmiyor, sadece RLS korumalı anon key kodda gömülü, bu yüzden public olması güvenlik
sorunu değil.)
**Supabase proje URL:** https://buncfnwagyrsgpayyqal.supabase.co

---

## 4. Dosya yapısı

```
servis-formu-app/
├── main.js                  # Electron ana süreç (pencere + oto güncelleme + e-Arşiv IPC)
├── preload.js               # window.earsiv.* köprüsü (contextBridge)
├── supabase.js              # SUPABASE_URL ve SUPABASE_KEY sabitleri
├── index.html                # TÜM uygulama: arayüz + iş mantığı + senkron
├── earsiv/                   # e-Arşiv (GİB) otomasyonu — bkz. bölüm 11
├── vendor/supabase.js         # supabase-js kütüphanesi (yerel kopya, CDN kullanılmıyor)
├── assets/logo.png            # Petsis logosu (yatay, arka planı şeffaf — servis formu antetinde)
├── assets/teklif-antet.png    # Teklif formu antetli kağıdı (dikey logo + watermark) — bkz. bölüm 13
├── package.json               # electron-builder yapılandırması + publish (GitHub Releases) burada
└── .github/workflows/build-win.yml   # Windows derleme + tag push'ta release yayınlama
```

---

## 5. Veri modeli (Supabase)

Beş tablo: `firmalar`, `lokasyonlar`, `urunler`, `servis_formlari`, `form_kalemleri`

Her tabloda ortak alanlar:
- `id uuid primary key` — **ID'yi uygulama üretir** (`crypto.randomUUID()`), veritabanı değil.
  Offline'da üretilen kayıt buluta aynı ID ile gittiği için çakışma olmuyor.
- `user_id uuid default auth.uid()` — RLS ile her kullanıcı sadece kendi verisini görür
- `updated_at timestamptz` — senkronda hangi kaydın yeni olduğunu anlamak için
- `deleted boolean` — **soft delete**. Gerçek silme yapılmıyor; offline'da silinen
  kaydın "silindi" bilgisi de buluta taşınabilsin diye.

İlişkiler: lokasyonlar → firmalar, servis_formlari → firmalar + lokasyonlar,
form_kalemleri → servis_formlari + urunler.

---

## 6. Offline-first senkron mimarisi (projenin kalbi)

Kullanıcı sahada internetsiz çalışabiliyor. Mantık:

1. **Tüm okumalar yerelden** (`localStorage`) yapılır → arayüz anında açılır, ağ beklenmez
2. **Tüm yazmalar** önce yerele, sonra `senkron_kuyrugu` adlı kuyruğa eklenir
3. Arka planda senkron: 20 saniyede bir + her yazmadan ~0.8 sn sonra tetiklenir
4. Senkron sırası FK kısıtları yüzünden önemli:
   firmalar → lokasyonlar → urunler → servis_formlari → form_kalemleri
5. Buluttan çekerken kuyrukta bekleyen kayıtlar ezilmez
6. Üst barda durum göstergesi: 🟢 senkronize / 🟡 N kayıt bekliyor / 🔴 çevrimdışı

İlgili fonksiyonlar `index.html` içinde: `yerelOku`, `yerelYaz`, `aktifler`,
`kayitUpsert`, `kayitSil`, `senkronCalistir`, `durumGuncelle`.

---

## 7. Geçmişte çözülen sorunlar (aynı duvarlara tekrar toslamamak için)

**better-sqlite3 + Windows derleme cehennemi (artık geçersiz ama ders niteliğinde):**
Proje başta yerel SQLite ile yazıldı. GitHub Actions'ta Windows derlemesi
"Could not find any Visual Studio installation" hatasıyla defalarca patladı; sebep
electron-builder 25.x'in içindeki eski node-gyp'in VS 2022'yi tanımaması.
Çözüm zinciri: node-gyp override → better-sqlite3 v13 (N-API) → `npmRebuild: false`.
Supabase'e geçilince better-sqlite3 tamamen kaldırıldı, sorun kökten bitti.

**node_modules'ün repoya girmesi:** `.gitignore` geç eklendiği için 220 MB'lık push
HTTP 408 ile patlıyordu. Orphan branch + force push ile geçmiş temizlendi.
`.gitignore` içinde `node_modules/` ve `dist/` var, öyle kalmalı.

**CDN bağımlılığı:** supabase-js önce CDN'den yükleniyordu — internetsizken uygulama
komple çöküyordu. `vendor/supabase.js` olarak yerelleştirildi.
**Dikkat:** `package.json` → `files` listesinde `"vendor/**/*"` satırı olmazsa
Windows paketine girmiyor ve "Cannot read properties of undefined (reading 'createClient')"
hatası veriyor.

**Windows'ta donma/kasma:** portable exe kullanılıyordu; her açılışta geçici klasöre
açılması ve yönetici izni sorunları yaşandı. NSIS installer'a geçildi
(`perMachine: false` → yönetici gerekmiyor). Ayrıca `app.disableHardwareAcceleration()`
eklendi, bazı Windows makinelerinde GPU kaynaklı donmaları çözüyor.

**electron-builder CI'da yayınlamaya çalışıyor:** `GH_TOKEN is not set` hatası.
Çözüm: manuel (workflow_dispatch) tetiklemede build komutuna `-- --publish never`
eklendi. Tag push ile tetiklenince artık `--publish always` kullanılıyor, bkz. bölüm 8.

**Kalem tablosunda her harfte odak kaybı:** her tuş vuruşunda tablo yeniden çiziliyordu.
Çözüm: `kalemGuncelle` artık tabloyu yeniden çizmiyor, sadece ilgili hücreyi güncelliyor.

**Aynı servis formu iki kayıt olarak Geçmiş'te görünüyordu (2026-08-04):** "Kaydet ve
yazdır" başarılı kayıttan sonra form alanlarını BİLEREK temizlemiyordu (üstüne yazıp
tekrar kaydedebilsin diye tasarlanmıştı) — ama bu, kullanıcı formun zaten kaydedildiğini
fark etmeden butona ikinci kez basınca aynı içerikle YENİ bir `id`/`form_no` üreten
ikinci bir kayıt oluşmasına yol açtı (Geçmiş'te "aynı form" biri 🟢 kesildi biri ⚪
kesilmedi olarak görünüyordu — aslında iki ayrı kayıttı). Düzeltme: `formKaydetVeYazdir`
artık başarılı kayıttan sonra HER ZAMAN formu temizliyor (`formDuzenlemeIptal()` hem
düzenleme hem yeni-kayıt modunda çağrılıyor), ayrıca `formKaydediliyor` bayrağıyla
hızlı çift tıklamaya karşı da korunuyor.

**Koyu tema + yazdırma:** uygulama koyu tema, ama önizleme ve çıktı beyaz kağıt olmalı.
`#onizlemeOverlay` içinde renkler beyaza override ediliyor, `@media print` bloğu da
her şeyi siyah-beyaza zorluyor.

**Yazdırınca arka plandaki sekme de basılıyordu (2026-08-06, Teklif Formu ile fark
edildi):** `#onizlemeOverlay` ekranda `position:fixed; inset:0` ile her şeyin ÜSTÜNÜ
kaplıyor, ama print sırasında birçok tarayıcı motoru `position:fixed`'i normal akışa
çeviriyor — bu yüzden altındaki `.content` (o an açık olan sekme, örn. Teklif Formu'nun
kendi form ekranı) hiç gizlenmediği için overlay içeriğiyle ÜST ÜSTE değil ARKA ARKAYA
aynı çıktıya basılıyordu. Servis formu kısa olduğu için muhtemelen fark edilmemişti,
Teklif Formu'nun altındaki "Geçmiş teklifler" listesi bunu görünür kıldı. Düzeltme:
`@media print` içine `.content { display: none !important; }` eklendi — yazdırma HER
ZAMAN `onizlemeAc()` + overlay üzerinden yapılıyor (`window.print()`'in üç çağrı yeri de
buna bağlı), o yüzden `.content`'i print'te tamamen gizlemek güvenli.

---

## 8. Derleme ve dağıtım

**Mac (yerel):** `npm start` ile çalıştır, `npm run dist:mac` ile dmg üret.

**Windows — normal (yayınlamadan) derleme:** yerel Mac'te derlenemez, GitHub Actions
kullanılıyor:
1. Değişiklikleri push et
2. GitHub → Actions → "Windows Build" → Run workflow (workflow_dispatch)
3. İş bitince Artifacts → `petsis-servis-formu-windows` zip'i indir → içinde Setup.exe
4. Bu yol GitHub Release YAYINLAMAZ, otomatik güncelleme bu build'i görmez.

**Windows — sürüm yayınlama (otomatik güncelleme tetikler):**
1. `package.json` içindeki `version` alanını yükselt (örn. `1.0.0` → `1.0.1`)
2. Commit at, push et
3. Tag oluştur ve push et: `git tag v1.0.1 && git push origin v1.0.1`
4. GitHub Actions bu tag'i görünce otomatik olarak `--publish always` ile derler,
   bir GitHub Release açar, Setup.exe + `latest.yml` dosyalarını buraya yükler
5. Uygulama zaten yüklü kullanıcılarda açılışta bu release'i görür, indirir,
   kullanıcıya "Şimdi kur / Daha sonra" diyaloğu gösterir (`main.js` → `guncellemeKontroluBaslat`)

Tag formatı önemli: `v` + semver (`v1.2.3`), workflow bunu regex ile arıyor.
Otomatik güncelleme sadece **paketlenmiş** (kurulmuş) uygulamada çalışır; `npm start`
ile açılan geliştirme ortamında `app.isPackaged` false olduğu için kontrol atlanır.

**Güncellemenin gerçekten çalışıp çalışmadığını nasıl anlarsın:** `main.js` her adımı
(kontrol başladı / yeni sürüm bulundu / güncel / indirildi / hata) `electron-log` ile
bir dosyaya yazıyor. Log dosyası kurulu makinede şurada — **electron-log dosya adını
`package.json` → `productName` değil, `name` alanından (`servis-formu-app`) alıyor**:
- Windows: `%USERPROFILE%\AppData\Roaming\servis-formu-app\logs\main.log`
- Mac: `~/Library/Logs/servis-formu-app/main.log`

2026-08-02'de bu şekilde yerel olarak test edildi: `npm run dist:mac` ile paketlenip
`.app` doğrudan çalıştırıldı (npm start değil), log dosyasında "Güncelleme kontrolü
başlatıldı" ve ardından beklenen "No published versions on GitHub" hatası görüldü
(henüz hiç tag/release yayınlanmadığı için normal). Bu test sırasında
`checkForUpdates()` promise'inin yakalanmadığı, unhandled rejection uyarısına yol
açtığı ortaya çıktı — `main.js`'te `.catch(() => {})` eklenerek düzeltildi.

Not: gerçek bir güncelleme testi için kurulu **eski** bir sürüm + yayınlanmış **yeni**
bir sürüm gerekir (bkz. yukarıdaki adımlar). Mac'te kurulum adımı kod imzası olmadığı
için güvenilir değildir; asıl test Windows'ta yapılmalı.

Uygulama imzasız olduğu için Windows SmartScreen uyarısı verir
("Ek bilgi" → "Yine de çalıştır" ile geçilir). Kod imzalama sertifikası ücretli,
şimdilik alınmadı.

---

## 9. Yapılacaklar / fikirler

- [x] **Otomatik güncelleme** (electron-updater + GitHub Releases). 2026-08-02'de
      eklendi — repo public'e çevrildi, `package.json`'a publish config + electron-updater
      bağımlılığı, `main.js`'e güncelleme kontrolü, workflow'a tag-push'ta publish eklendi.
      **Uçtan uca gerçek makinede doğrulandı:** v1.0.1 kuruldu, v1.0.2 yayınlandı,
      kurulu 1.0.1 açılınca güncellemeyi indirdi, "Şimdi kur" diyaloğu çıktı, kurulup
      1.0.2'ye geçti. Kullanım için bkz. bölüm 8.
- [x] **e-Arşiv entegrasyonu** (2026-08-02, **uçtan uca PROD'da doğrulandı**). Ücretli
      entegratöre gerek kalmadan `fatura` (npm, github.com/f/fatura) paketiyle GİB
      e-Arşiv Portalı Batuhan'ın kendi kullanıcı adı/şifresiyle otomatikleştiriliyor.
      Detaylar için bkz. bölüm 11. Supabase şeması güncellendi (`manuel_faturalar` +
      `manuel_fatura_kalemleri` tabloları Batuhan tarafından dashboard'da çalıştırıldı).
      **Tam akış gerçek hesapla çalışıyor:** önizle → taslak oluştur → VKN ile bul →
      SMS gönder → kod doğrula + imzala (GERİ ALINAMAZ, resmi belge) → PDF indir.
      `fatura` paketinde bulunan 5 ayrı gerçek hata (taslak bulma, telefon numarası,
      SMS doğrulama komutu, OID okuma, indirme linki) tek tek tespit edilip düzeltildi
      — hepsi bölüm 11'de belgelendi.
- [ ] Şifre sıfırlama akışı
- [ ] Google ile giriş (Google Cloud Console ayarı gerekir)
- [x] **Kesilmiş formu sonradan düzenleme** (2026-08-04). Servis formu, Geçmiş'ten
      "Düzenle" ile açılıp güncellenebiliyor — ama SADECE fatura kesilmemişse
      (`earsiv_durum !== 'imzalandi'`). Fatura zaten kesilmiş bir formda "Düzenle"
      butonu disabled, GİB'e giden resmi veriyle yerel kayıt arasında uyuşmazlık
      oluşmasın diye. Detaylar için bkz. bölüm 12.
- [ ] Aylık ciro / form sayısı özeti
- [ ] Uygulama ikonu (şu an varsayılan Electron ikonu kullanılıyor)
- [x] **Teklif Formu** (2026-08-06). Servis formundan/faturadan bağımsız, dövizli fiyat
      teklifi hazırlama — Batuhan'ın gönderdiği gerçek antetli kağıda göre tasarlandı.
      Detaylar için bkz. bölüm 13. **Supabase'de yeni tablolar gerekiyor, Batuhan'ın
      dashboard'da çalıştırması lazım** (bölüm 13'teki SQL).
- [x] **e-Arşiv fatura görüntüleme (indirmeden)** (2026-08-04). "İndir" her seferinde
      PDF üretip diske yazıyordu — sadece bakmak isteyenler için "Görüntüle" (aslında
      "Faturayı Görüntüle") butonu eklendi, GİB'in HTML içeriğini dosyaya hiç
      kaydetmeden uygulamanın kendi önizleyicisinde (`onizlemeOverlay`) gösteriyor.
- [x] **"Faturalarım" sekmesi** (2026-08-04). Servis formundan ve "Fatura Kes"ten
      kesilen/başlatılan tüm e-Arşiv faturaları artık tek bir sekmede (`faturalarim`)
      birleşik listeleniyor, arama/filtre var. Detaylar için bkz. bölüm 12.

---

## 10. Küçük ama önemli notlar

- Form numarası formatı: `F-2026-0001` (yıl + sıra). Sıra yereldeki form sayısından
  üretiliyor — çok kullanıcılı senaryoda çakışabilir, tek kullanıcı için sorun yok.
- Ürün fiyatları veritabanında **her zaman TL** tutulur. EUR/USD girilirse
  `open.er-api.com` üzerinden anlık kurla çevrilip TL olarak kaydedilir.
- Yazdırma çıktısında imza alanları boş bırakılır (elle imzalanıyor).
- Antetli kısımdaki firma bilgileri (Kıvanç Buğdaycı, adres, telefon, IBAN)
  `index.html` içinde sabit yazılı — değişirse iki yerde güncellenmeli:
  `letterheadHtml()` fonksiyonu ve servis formu sekmesindeki statik blok.
- Supabase publishable (anon) anahtarı koda gömülü olabilir, güvenliği RLS sağlıyor.
  **service_role / secret anahtar asla koda veya repoya konmaz.**

---

## 11. e-Arşiv entegrasyonu (GİB e-Arşiv Portalı otomasyonu)

Ücretli entegratöre (Paraşüt/Uyumsoft vb.) gerek kalmadan, `fatura` (npm,
github.com/f/fatura, MIT) paketiyle GİB e-Arşiv Portalı Batuhan'ın **kendi** GİB
kullanıcı adı/şifresiyle otomatikleştiriliyor. Resmi bir API değil (reverse-engineer),
ama açık kaynak ve aktif.

**Dosyalar:**
- `earsiv/kimlikDeposu.js` — GİB kullanıcı adı/şifresini Electron `safeStorage`
  (OS keychain) ile şifreleyip `app.getPath('userData')/earsiv-kimlik.json`'a yazar.
  **Bu bilgi Supabase'e hiç gitmez, tek makineye özel.**
- `earsiv/client.js` — `fatura` paketinin sarmalayıcısı, form bazlı oturum durumu
  (`Map`, formId → GİB token/taslak/SMS operationId).
- `patches/fatura+0.2.1.patch` — **`patch-package` ile kalıcı hale getirilmiş, iki
  kritik düzeltme içeriyor:**
  1. `createDraftInvoice` GİB'e ETTN alanını `faturaUuid` adıyla gönderiyordu, GİB
     bunu tanımayıp "Ettn ya eksik ya boş" hatası veriyordu (kütüphanenin kendi
     GitHub'ında bu tam sorunu düzelten ama birleştirilmemiş PR #45 var, aynı
     düzeltme `ettn: faturaUuid` olarak yamalandı).
  2. `not` (fatura notu) alanı hep otomatik "tutarın yazıyla hali" ile dolduruluyordu,
     özel bir not girme imkanı yoktu; `invoiceDetails.note` verilmişse onu kullanacak,
     verilmezse eskisi gibi otomatik dolduracak şekilde yamalandı.

  `postinstall` script'i (`package.json`) her `npm install`'da bu yamayı otomatik
  uyguluyor — **`node_modules` silinip yeniden kurulsa bile düzeltmeler kaybolmaz.**
  Paket güncellenip bu bug'lar resmi olarak düzeltilirse yama gereksiz olur, kaldırılabilir.
- `main.js` — `ipcMain.handle('earsiv:...')` kanalları (main process, Node-only —
  `fatura` renderer'da ÇALIŞAMAZ çünkü `contextIsolation: true`).
- `preload.js` — `window.earsiv.*` olarak `contextBridge` ile expose edilir (ilk kez
  gerçek içerik aldı, önceden tamamen boştu).
- `index.html` — üç yer:
  1. "Ayarlar" sekmesi: GİB kimlik girişi (kullanıcı adı/şifre/telefon, TEST/PROD
     seçimi, varsayılan TEST), ve ayrı bir "Fatura notu" alanı — kestiği HER faturaya
     otomatik eklenecek serbest metin (Batuhan burayı IBAN için kullanıyor).
     `localStorage` içinde `earsivFaturaNotu` anahtarıyla tutulur (Supabase'e gitmez,
     GİB kimlik bilgisi kadar hassas değil, senkron da gerekmiyor).
  2. "Geçmiş" sekmesi: servis formlarına bağlı "Faturayı Kes"/"Devam et"/"İndir"
     butonu + durum sütunu (`earsivDurumEtiketi`).
  3. **"Fatura Kes" sekmesi (2026-08-02 eklendi)** — servis formundan TAMAMEN bağımsız,
     kendi firma/kalem girişiyle doğrudan e-Arşiv faturası kesmek için. Neden gerekti:
     servis formundaki kalem açıklaması (iç/teknik not) ile resmi faturada görünmesi
     gereken ürün/hizmet adı farklı olabiliyor — aynı alanı iki amaç için kullanmak
     yerine tamamen ayrı bir giriş ekranı yapıldı. Kendi kalem tablosu (`faturaKalemleri`
     state'i, `faturaKalemEkle`/`faturaKalemGuncelle`/`faturaKalemTablosunuCiz` —
     servis formunun `kalemEkle` ailesiyle birebir aynı pattern) ve kendi geçmiş
     listesi (`manuelFaturaListesiYenile`) var.

  Servis formu + Fatura Kes sekmelerinin ikisi de AYNI e-Arşiv kodunu paylaşıyor —
  kopyala-yapıştır yerine `EARSIV_TABLO_AYARLARI` eşlemesi (`servis_formlari` ↔
  `form_kalemleri`/`form_id`, `manuel_faturalar` ↔ `manuel_fatura_kalemleri`/`fatura_id`)
  ve tek bir `earsivFaturaKesTikla(tablo, id)` fonksiyonu üzerinden çalışıyor.
  SMS kod girme modalı (`#earsivSmsOverlay`) de ikisi için ortak, hangi kaydı
  güncelleyeceğini `aktifFaturaTablo` global'i ile biliyor.

**Akış:** taslak oluştur → GİB'de bul (`findInvoice`, retry'lı) → SMS gönder (Batuhan'ın
hesabı mali mühürsüz, **SMS ile imzalıyor**, bu adım atlanamaz) → kullanıcı kodu girer →
doğrula + imzala (**GERİ ALINAMAZ**, gerçek resmi mali belge) → indirme linki.

**Kritik ders (kütüphanenin kendi issue geçmişinden, github.com/f/fatura/issues/18):**
GİB, düzgün `logout` yapılmayan oturumlarda hesabı **2 saate kadar** kilitleyebiliyor
("Sisteme aynı anda birden fazla giriş yapamazsınız" hatası). Bu yüzden
`earsiv/client.js`'te her oturum ya başarıyla biter ya da 15 dakikalık zaman aşımıyla
otomatik `logout` edilir (`oturumuKapat`). **Bu davranışı bozacak şekilde koda
dokunulursa (örn. logout çağrılarını kaldırmak) Batuhan'ın gerçek GİB hesabı saatlerce
kilitlenebilir — dikkat.**

**Supabase şema değişikliği — 2026-08-02'de Batuhan tarafından dashboard SQL Editor'de
ÇALIŞTIRILDI, sütunlar `servis_formlari` tablosunda mevcut:**
```sql
ALTER TABLE servis_formlari
  ADD COLUMN IF NOT EXISTS earsiv_durum text,
  ADD COLUMN IF NOT EXISTS earsiv_uuid text,
  ADD COLUMN IF NOT EXISTS earsiv_tarih text,
  ADD COLUMN IF NOT EXISTS earsiv_ortam text,
  ADD COLUMN IF NOT EXISTS earsiv_indirme_url text,
  ADD COLUMN IF NOT EXISTS earsiv_hata text;
```

**"Fatura Kes" sekmesi için yeni tablolar — HENÜZ ÇALIŞTIRILMADI, Batuhan'ın
dashboard SQL Editor'de çalıştırması gerekiyor:**
```sql
create table manuel_faturalar (
  id uuid primary key,
  user_id uuid default auth.uid(),
  firma_id uuid references firmalar(id),
  lokasyon_id uuid references lokasyonlar(id),
  tarih date,
  kdv_orani numeric,
  earsiv_durum text,
  earsiv_uuid text,
  earsiv_tarih text,
  earsiv_ortam text,
  earsiv_indirme_url text,
  earsiv_hata text,
  deleted boolean default false,
  updated_at timestamptz default now()
);

create table manuel_fatura_kalemleri (
  id uuid primary key,
  user_id uuid default auth.uid(),
  fatura_id uuid references manuel_faturalar(id),
  urun_id uuid references urunler(id),
  aciklama text,
  adet numeric,
  birim_fiyat numeric,
  deleted boolean default false,
  updated_at timestamptz default now()
);

alter table manuel_faturalar enable row level security;
alter table manuel_fatura_kalemleri enable row level security;

create policy "kullanici kendi verisi" on manuel_faturalar
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "kullanici kendi verisi" on manuel_fatura_kalemleri
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
Bu çalıştırılmadan "Fatura Kes" sekmesinde kaydedilen kayıtlar yerelde görünür ama
Supabase'e senkronize olmaz (diğer tablolarla aynı şema-serbest `kayitUpsert` davranışı).

**Test durumu (2026-08-02, uygulama üzerinden Batuhan tarafından denendi):**
- Ayarlar'a TEST + `33333301`/`1` kaydedildi, `safeStorage` dosyası doğru oluştu.
- İlk denemede paylaşılan TEST hesabı kilitliydi ("aynı anda birden fazla giriş") —
  uygulama bunu **doğru şekilde** yakaladı: çökmedi, `earsiv_durum='hata'` oldu, Geçmiş
  tablosunda 🔴 Hata + "Devam et" butonu doğru göründü, log dosyasına yazıldı. Bu,
  hata/devam-et tasarımının uçtan uca çalıştığını kanıtlıyor.
- Log dosyasının dev modda (`npm start`) hiç oluşmadığı fark edildi ve düzeltildi —
  `log.transports.file.level = 'info'` artık `main.js`'in en başında, paketli/paketsiz
  ayrımı olmadan kuruluyor (önceden sadece `guncellemeKontroluBaslat` içinde, yani
  sadece paketli üründeydi).
- Hesap sonradan boşaldığında asistan tarafında (Node script ile) devam edildi:
  `getToken`/`getUserData`/`getRecipientDataByTaxIDOrTRID` gerçek veriyle doğrulandı
  (alan adları `eslestirAlici()`'de düzeltildi: sadece `unvan`/`vergiDairesi` dönüyor,
  adres bilgisi YOK). **`createDraftInvoice` yukarıdaki patch sayesinde artık
  başarıyla çalışıyor** (önceden "Ettn ya eksik ya boş" hatası veriyordu).
- `findInvoice` paylaşılan TEST hesabında bulamadı — sebebi net: bu hesap o an dünya
  çapında onlarca başka geliştirici tarafından kullanılıyordu (listede "Zeynep Yılmaz",
  "Melik Mehmet" gibi başkalarının test faturaları görüldü), `getAllInvoicesByDateRange`
  görünüşe göre sadece en son ~5 kaydı döndürüyor ve bizimki hemen listeden düşüyor.
  **Bu, Batuhan'ın az sayıda fatura kesen gerçek hesabında sorun olmayacak bir durum**,
  paylaşılan hesabın gürültüsünden kaynaklanıyor.
- `sendSignSMSCode` bu paylaşılan demo hesabında "Bu işlem için yetkiniz yok" hatası
  verdi — muhtemelen bu genel/paylaşılan demo hesabında SMS ile imzalama yetkisi hiç
  açık değil. **SMS gönder → kod doğrula → imzala zincirinin gerçek davranışı hâlâ
  hiç canlı test edilmedi** — bunun tek gerçek testi Batuhan'ın kendi (SMS ile imzalayan)
  gerçek hesabıyla olabilir, TEST ortamının bu paylaşılan hesabı bunun için uygun değil.

**Gerçek (PROD) hesapla ilk canlı deneme (2026-08-02, aynı gün):**
Batuhan Ayarlar'da PROD'a geçip kendi gerçek GİB hesabıyla denedi.
- `createDraftInvoice` **başarıyla çalıştı** (patch doğrulandı, PROD'da da).
- `findInvoice` iki denemede de (7.5 saniyelik retry penceresi içinde) taslağı
  bulamadı — "Taslak GİB sisteminde henüz görünmüyor" hatası. Paylaşılan TEST
  hesabındaki gürültü sorunu burada geçerli değil (kendi hesabı, az kayıt); bu kez
  sebep muhtemelen **GİB PROD'un indexleme gecikmesi** — TEST'ten daha yavaş
  olabiliyor. "Devam et" ile aynı taslağı tekrar aramak tasarım gereği güvenli
  (yeni taslak oluşturmuyor), ama birkaç dakika beklemek gerekebilir.
- Bu arada Batuhan farklı formlarla denedi (aynı formda "Devam et" yerine), bu yüzden
  birkaç imzalanmamış/yarım taslak GİB hesabında kalmış olabilir — sorun değil,
  imzalanmadıkları için resmi sayılmıyorlar, GİB muhtemelen bir süre sonra kendiliğinden
  temizler; gerekirse portaldan elle silinebilir.
- **Gerçek bir bug bulundu ve düzeltildi:** `earsivFaturaKesTikla`'nın `catch` bloğu
  sadece `earsiv_durum: 'hata'` yazıyordu, `earsiv_uuid`'i HİÇ kaydetmiyordu (o alan
  sadece başarı durumunda set ediliyordu). Sonuç: `findInvoice` başarısız olduğunda
  "Devam et" aslında hiçbir zaman aynı taslağı aramıyordu — `mevcutUuid` boş olduğu
  için HER "Devam et" tıklamasında GİB'de YENİ bir taslak oluşuyordu (log'da aynı form
  için 3 farklı taslak uuid'i görüldü, düzeltilmeden önce). Düzeltme: `earsiv/client.js`
  → `faturaBaslat` artık taslak oluşturma ile bulma adımını ayrı try/catch'lere böldü;
  bulma başarısız olursa `{ bulunamadi: true, uuid, tarih, ortam }` döndürüyor (throw
  ETMİYOR), `index.html` bunu HER durumda (bulunsa da bulunmasa da) `earsiv_uuid`/
  `earsiv_tarih` olarak kaydediyor. Artık "Devam et" gerçekten aynı taslağı arıyor.
- **SMS gönder → kod doğrula → imzala zincirinin gerçek davranışı hâlâ hiç canlı
  test edilmedi** (findInvoice tamamlanmadığı için o adıma hiç gelinemedi — yukarıdaki
  düzeltmeden sonra tekrar denenecek).

**"Taslak bulunamıyor" sorununun kök nedeni araştırması (2026-08-02, aynı gün, devam):**
Batuhan ısrarla "sorun süreyle alakalı değil, başka bir şey" dedi (başka e-Arşiv
araçlarında taslak anında görünüyormuş) — bu, "biraz daha bekle" teorisini haklı
olarak reddetti. Bunun üzerine:
- `hangiTip`/`faturaTipi` uyuşmazlığı bulundu: `fatura` paketinin varsayılanları
  (`faturaTipi: "5000/30000"`, `hangiTip: "Buyuk"`) ile GİB'in taslak ARAMA
  sorgusunun kullandığı değer (`hangiTip: "5000/30000"`) uyuşmuyordu — taslak GİB'e
  kabul ediliyor ama arama onu hiç bulamıyordu. `github.com/xBuhari/buhari-earsiv-api`
  ile karşılaştırılarak doğru değerler (`invoiceType: 'SATIS', hangiTip: '5000/30000'`)
  `earsiv/client.js` → `faturaVerisiOlustur()`'da elle set edildi. Bir denemede
  çalıştığı doğrulandı ama sonraki bir denemede sorun kısmen tekrarladı — tam
  güvenilir değildi.
- Batuhan'ın Chrome DevTools ile yakaladığı gerçek GİB portal ağ trafiği incelendi.
  Portalın kendi client-side JS'i (RG_BASITFATURA formunun `SIDE.GET_EAGER_BF_DEFS`
  tanımı) şunu ortaya çıkardı: **GİB'in kendi arayüzü, oluşturulan taslağı ARAMAK
  için tarih aralığı listesi taraması KULLANMIYOR** — doğrudan ID ile sorguluyor:
  `EARSIV_PORTAL_FATURA_GETIR`, `{ettn: uuid}`. `github.com/xBuhari/buhari-earsiv-api`
  da (kaynak kodu incelendi) taslağı doğrulamak için aynı komutu, aynı şekilde
  kullanıyor. Bu, `fatura` paketinin `findInvoice`'unun kullandığı
  `getAllInvoicesByDateRange` (tarih aralığı + `hangiTip` filtresiyle liste) taramasından
  tamamen farklı bir yol — ve listeleme tarafında ayrı bir gecikme/filtre sorunu olsa
  bile ID ile doğrudan sorgu bunu etkilemiyor olabilir.
  - Ara adım: `earsiv/client.js`'e `EARSIV_PORTAL_FATURA_GETIR` (ID ile doğrudan
    doğrulama) eklendi, ama bu da taslağı hiç bulamadı ("Düzenlenmek üzere fatura
    getirilemedi. Hata kodu: 2-1109") — bu, gerçek kök nedenin izini sürmeye devam
    etmemizi sağladı (aşağıya bkz.), kendisi kalıcı çözüm olmadı.

**GERÇEK KÖK NEDEN BULUNDU VE DÜZELTİLDİ (2026-08-02, aynı gün):**
Batuhan GİB portalında GERÇEK bir "Oluştur" tıklamasını DevTools ile yakalayıp Request
Payload'ını gönderdi. Kritik fark ortaya çıktı: gerçek portal isteğinde
**`"faturaUuid":""`** — yani BOŞ gönderiliyor. GİB kendi ID'sini kendisi atıyor ve
oluşturma cevabında da bu gerçek ID hiç geri dönmüyor (sadece "Faturanız başarıyla
oluşturulmuştur..." mesajı dönüyor, `{"data": "...", "metadata": {...}}` şeklinde).

`fatura` paketi ise (patch'lenmeden önce `faturaUuid` adıyla, patch'lendikten sonra
yanlışlıkla `ettn` adıyla) her zaman **kendi ürettiği rastgele bir uuid'i DOLU
gönderiyordu**. GİB bunu görmezden geliyor (kendi ID'sini atıyor), biz de arama
yaparken GİB'de hiçbir zaman var olmamış bu sahte uuid'i arıyorduk — taslak aslında
her seferinde GERÇEKTEN oluşuyordu (ilk birkaç deneme "Düzenlenen Belgeler" sekmesinde
gerçek belge numarasıyla — `GIB2026000000024` vb. — görüldü, Batuhan bunları elle
sildi), sadece bizim aradığımız ID gerçek kayıtla hiç eşleşmiyordu.

**Düzeltme (iki parça):**
1. `patches/fatura+0.2.1.patch` güncellendi: `createDraftInvoice` artık `faturaUuid`
   alanını gerçek portal gibi hep **boş string** gönderiyor (önceki `ettn: faturaUuid`
   yanlış hem alan adı hem değer açısından yanlıştı — geri alındı).
2. `earsiv/client.js` baştan tasarlandı: taslak artık kendi ürettiğimiz bir ID ile
   değil, **VKN + tarih eşleşmesiyle** bulunuyor (`faturaAra()` → `getAllInvoicesByDateRange`
   sonucunu `aliciVknTckn === vkn` ile filtreleyip en yüksek `belgeNumarasi`'nı seçiyor).
   `EARSIV_PORTAL_FATURA_GETIR` (ID ile doğrudan doğrulama) kaldırıldı — artık gereksiz,
   zaten gerçek bir ID'miz yoktu ki onunla doğrulayalım.
   Aynı VKN'ye aynı gün birden fazla fatura kesilirse (nadir ama mümkün) yanlış kaydı
   seçme riskine karşı: `index.html`'deki SMS onay ekranına bulunan faturanın belge
   numarası + alıcı unvanı gösteriliyor (`#earsivSmsFaturaBilgi`) — Batuhan imzalamadan
   önce gözle doğrulayabilir.

**Canlı doğrulandı (2026-08-02, aynı gün, PROD hesabıyla):** VKN eşleşmesi ilk denemede
(deneme 1) çalıştı — `GIB2026000000029` bulundu. Taslak bulma sorunu KESİN ÇÖZÜLDÜ.

**İkinci bir gerçek hata bulundu ve düzeltildi (SMS gönderme adımı):** `smsGonder`
çağrısı GİB'den `"Genel Sistem Hatası:java.lang.NullPointerException"` döndürdü. Sebep:
kod telefon numarasını `getUserData` (`EARSIV_PORTAL_KULLANICI_BILGILERI_GETIR` →
`d.telNo`) ile çekiyordu. Batuhan'ın gerçek GİB portalında "İmzala" akışını DevTools'ta
yakalamasıyla görüldü ki gerçek portal telefonu **ayrı ve özel bir komutla** çekiyor:
`EARSIV_PORTAL_TELEFONNO_SORGULA` → `{telefon: "5551234567"}` (başında 0/90 olmayan
temiz 10 hane). `earsiv/client.js` → `telefonNoSorgula()` bu doğru komutu kullanacak
şekilde güncellendi; ayrıca Ayarlar'dan elle girilen telefon da (`0555...`, `+90 555...`
gibi farklı formatlarda olabilir) `telefonNormalizeEt()` ile aynı temiz forma çevriliyor.
**Bu düzeltmeyle SMS gönderme başarıyla çalıştı** (Batuhan'a gerçek SMS geldi).

**Üçüncü gerçek hata bulundu ve düzeltildi (SMS doğrulama/imzalama adımı):** SMS kodu
girilince yine `"Genel Sistem Hatası:java.lang.NullPointerException"` alındı. Log'da
`operationId=undefined` görüldü — `fatura` paketinin `sendSignSMSCode`'u OID'i
`result.oid`'den okuyordu ama GİB bunu `result.data.oid` altında dönüyor (SMS'in kendisi
gerçekten gidiyordu, sadece OID hiç doğru okunmuyordu). `github.com/mlevent/fatura`
(PHP, aynı repo TELEFONNO_SORGULA'yı da doğru kullanıyordu) `$response->object('data')->oid`
ile doğruladı. `earsiv/client.js` → `smsGonder` artık `runCommand`'ı doğrudan çağırıp
`result.data.oid`'i okuyor.

Aynı araştırmada AYRICA şu da bulundu: SMS kodu doğrulama (`verifySignSMSCode` →
`EARSIV_PORTAL_SMSSIFRE_DOGRULA`) GİB'de "Service Not Found" hatası veriyordu — bu komut
artık/hiç yok. Gerçek akış doğrulama+imzalamayı AYRI değil TEK bir komutla yapıyor:
`0lhozfib5410mp` (garip görünüyor ama `mlevent/fatura` kaynağından doğrulandı), sayfa
`RG_SMSONAY`, parametreler `DATA:[{belgeTuru:'FATURA', ettn}], SIFRE, OID, OPR:1`, başarı
`data.sonuc === '1'`. `smsDogrulaVeImzala` artık ayrı `verifySignSMSCode`+`signDraftInvoice`
yerine bu tek komutu kullanıyor.

**BAŞARILDI (2026-08-02, aynı gün): SMS gönder → kod doğrula → imzala zinciri OID
düzeltmesiyle ilk kez uçtan uca çalıştı** — Batuhan kodu girdi, hata almadan imzalandı
(yani `signDraftInvoice` adımının gerçek e-Arşiv faturası ürettiği doğrulandı). e-Arşiv
entegrasyonunun en kritik/riskli parçası artık canlıda çalışıyor.

**Dördüncü gerçek hata bulundu ve düzeltildi (indirme linki):** İmzalandıktan sonra
"İndir"e basınca GİB `{"error":"1","messages":[{"text":"Bu işlem için yetkiniz yok"}]}`
döndürdü. Sebep: `fatura` paketinin `getDownloadURL()`'ü `cmd=downloadResource`
kullanıyor, ama `github.com/mlevent/fatura` (PHP) referansı doğru komutun
`EARSIV_PORTAL_BELGE_INDIR` olduğunu gösterdi. `earsiv/client.js` → yeni
`indirmeUrlUret()` fonksiyonu bu doğru `cmd` ile linki elle üretiyor (kütüphanenin
`getDownloadURL` metodunu artık hiç kullanmıyoruz). **Canlı doğrulandı** — link artık
açılıyor.

**PDF olarak doğrudan indirme (2026-08-02, aynı gün, Batuhan'ın isteğiyle):** "İndir"
tarayıcıda GİB sayfası açmak yerine artık doğrudan PDF indiriyor. `earsiv/client.js` →
`indir()` artık `client.getInvoiceHTML()` (`EARSIV_PORTAL_FATURA_GOSTER`) ile GİB'in
resmi belge HTML'ini çekiyor, görünmez bir `BrowserWindow`'da render edip Electron'un
kendi `webContents.printToPDF()`'iyle PDF'e çeviriyor, `app.getPath('downloads')`
altına `fatura-<ettn>.pdf` olarak kaydedip `shell.openPath` ile açıyor. Tarayıcı hiç
açılmıyor. IPC arayüzü (`earsiv:indir` kanalı, `window.earsiv.indir`) değişmedi —
main.js/preload.js/index.html'de değişiklik gerekmedi, sadece `earsiv/client.js`
içindeki `indir()`'in gövdesi değişti. **Canlı doğrulandı** — ilk denemede PDF 2
sayfaya taşmıştı, `printToPDF({ scale: 0.9 })` ile tek sayfaya sığdırıldı, bu haliyle
onaylandı.

**SONUÇ (2026-08-02): e-Arşiv entegrasyonu uçtan uca PROD'da çalışıyor.** Önizle →
taslak oluştur (VKN'ye boş `faturaUuid` ile GİB'e gönder) → VKN+tarih eşleşmesiyle bul
→ SMS gönder (doğru OID ile) → kod doğrula+imzala (tek komut, GERİ ALINAMAZ) → PDF
indir — hepsi gerçek hesapla test edildi ve çalışıyor. Yolda bulunup düzeltilen 5 gerçek
GİB/`fatura` paketi hatası: (1) taslak arama ID'si hiç GİB'e ulaşmıyordu, (2) telefon
numarası yanlış komuttan okunuyordu, (3) SMS doğrulama komutu GİB'de yoktu (doğrulama+
imzalama tek komutmuş), (4) SMS gönderme cevabındaki OID yanlış alandan okunuyordu,
(5) indirme linkinin `cmd` parametresi yanlıştı. Hepsi gerçek DevTools trafiği ve/veya
açık kaynak referans kütüphaneleriyle (xBuhari/buhari-earsiv-api, mlevent/fatura)
çapraz doğrulanarak bulundu.

**Fatura önizleme eklendi (2026-08-02, aynı gün, Batuhan'ın isteğiyle):** GİB'e
gönderilmeden önce (resmi/geri alınamaz süreç başlamadan) ne kesileceğini gözle
görüp onaylayabilmesi için önizleme eklendi. İlk halinde ayrı/küçük bir modaldı, ama
Batuhan "normal fatura görüntüsü istiyorum" dedi — bunun üzerine servis formunun
zaten var olan antetli beyaz kağıt önizlemesiyle (`#onizlemeOverlay`, `onizlemeAc`/
`onizlemeKapat`, `formOnizlemeHtml`) AYNI mekanizmayı paylaşan `faturaOnizlemeHtml()`
yazıldı (antet + "Fatura" başlığı + alıcı unvan/VKN/adres + kalemler tablosu + KDV/
toplamlar + fatura notu, imza alanı yok). Overlay'in `.no-print` buton çubuğu artık iki
ayrı div (`#onizlemeButonlarServis` vs `#onizlemeButonlarFatura`) arasında toggle
ediliyor; `onizlemeKapat()` her zaman servis formu varsayılanına döner.

`earsivFaturaKesTikla` ikiye bölündü: önce önizlemeyi açıyor (`faturaOnizlemeVeri.devamEt`
callback'iyle), "Onayla, Faturayı Kes" (`onizlemeFaturaOnayla()`) tıklanınca asıl GİB
akışını (`earsivFaturaKesGerceklestir`, eski fonksiyonun gövdesi) çalıştırıyor. "Devam et"
(taslak zaten GİB'e gönderilmiş, `EARSIV_DEVAM_EDEN_DURUMLAR` + `earsiv_tarih` dolu)
durumunda önizleme TEKRAR gösterilmiyor — içerik zaten GİB'e gitmiş, tekrar onay istemek
kafa karıştırır. Ayrıca "Geçmiş"/"Fatura Kes" listelerindeki "Devam et"/"Sil" butonlarının
yanına, herhangi bir GİB işlemi başlatmadan salt kaydı görüntülemek için bağımsız bir
**"Önizle"** butonu eklendi (`earsivOnizlemeGoster`, Onayla butonu bu modda gizli). Bu
değişiklik hem "Geçmiş" hem "Fatura Kes" sekmesindeki akış için ortak (`earsivButonuUret`/
`earsivFaturaKesTikla` ikisi tarafından da paylaşılıyor).

Bu arada fark edilen küçük bir bug da düzeltildi: "Devam et" koşulu
(`kayit.earsiv_uuid` dolu olmasını şart koşuyordu) — VKN-eşleşmesi tasarımında taslak
bulunamazsa `earsiv_uuid` boş kalabilir (sadece `earsiv_tarih` dolu olur), bu durumda
eski kod yanlışlıkla YENİ bir taslak daha oluştururdu. Artık sadece `earsiv_tarih`
doluysa yeniden oluşturmuyor.

**Kapsam dışı (v1):** iptal/storno akışı, otomatik/toplu kesim, kalem bazlı farklı KDV
oranı, faturanın e-posta ile otomatik gönderimi, çoklu cihaz arası GİB kimlik senkronu.

---

## 12. Faturalarım sekmesi, fatura görüntüleme ve servis formu düzenleme (2026-08-04)

Batuhan tek seferde dört eksik bildirdi: (1) kesilen faturayı sadece "İndir" (her
seferinde PDF üretip diske yazan, GİB'e giriş yapan) ile görebiliyordu, salt görüntüleme
yoktu; (2) servis formu ve "Fatura Kes" kaynaklı faturalar iki ayrı yerde dağınıktı;
(3) kaydedilmiş bir servis formunu sonradan düzenleyemiyordu; (4) imza checkbox'ı
(bkz. bölüm 11 sonu, aynı gün acil eklenmişti) dağınık duruyordu. İki mimari kararı
(Faturalarım için yeni sekme mi yoksa Fatura Kes'e ekleme mi; düzenlemeyi fatura
kesilmişse engelle mi yoksa uyarıp izin ver mi) AskUserQuestion ile Batuhan'a soruldu,
ikisinde de önerilen (daha güvenli/temiz) seçenek onaylandı.

**Fatura görüntüleme (indirmeden):** `earsiv/client.js` → yeni `goruntule()` fonksiyonu,
GİB'e giriş yapıp `client.getInvoiceHTML()` (`EARSIV_PORTAL_FATURA_GOSTER`) ile HTML'i
çekip DÖNDÜRÜYOR — `indir()`'in aksine hiç dosyaya yazmıyor, hiç `BrowserWindow`/PDF
oluşturmuyor. Yeni IPC kanalı `earsiv:goruntule` (main.js, preload.js). `index.html` →
`earsivGoruntule(tablo, id)` bu HTML'i mevcut `onizlemeOverlay`'de gösteriyor.
`earsivButonuUret`'e `f.earsiv_uuid` doluysa görünen "Faturayı Görüntüle" butonu eklendi
(mevcut "Önizle" butonuyla — o yereldeki veriden yeniden kurulan bir taklit, bu GERÇEK
GİB içeriği — karışmasın diye farklı isim verildi).

**"Faturalarım" sekmesi:** Yeni `sayfaFaturalarim` + `faturalarimYenile()`.
`servis_formlari` (sadece `earsiv_durum` dolu olanlar — hiç fatura kesilmemiş servis
formları zaten Geçmiş'te kalıyor, karışmasın) ile `manuel_faturalar`'ı (hepsi, çünkü o
tablo zaten sırf e-Arşiv için var) birleştirip tek listede gösteriyor, `earsivButonuUret`
aynı şekilde paylaşılıyor. Firma adı + tarih aralığı filtresi var (`gecmisAra`/
`manuelFaturaListesiYenile` ile aynı desen). Bu görünümden silme yok — silme hâlâ
kaynak sekmelerde (Geçmiş / Fatura Kes).

**Servis formu sonradan düzenleme:** Geçmiş listesinde "Düzenle" butonu —
`f.earsiv_durum === 'imzalandi'` ise **disabled** (GİB'e resmen gönderilmiş veriyle
yerel kayıt arasında uyuşmazlık oluşmasın diye, Batuhan'ın seçtiği kural). `formDuzenle(id)`
kaydı + kalemlerini Servis Formu sekmesinin alanlarına dolduruyor, `duzenlenenServisFormuId`
global'ini set edip sekmeyi açıyor; başlık ("Düzenleniyor: F-2026-00xx") ve "Kaydet ve
yazdır" butonu ("Güncelle ve yazdır") buna göre değişiyor, "Vazgeç, yeni forma dön"
butonu görünür olur. `formKaydetVeYazdir()` düzenleme modundaysa YENİ id/form_no
üretmek yerine mevcudu kullanıyor, eski `form_kalemleri` satırlarını yumuşak silip
güncel `formKalemleri`'ni yeniden yazıyor, kayıttan sonra `formDuzenlemeIptal()` ile
formu sıfırlıyor. (Not: bu bölümde ilk yazıldığında "normal kayıtta form temizlenmiyor,
mevcut davranış korunuyor" deniyordu — sonra bir çift-kayıt hatası bulununca bu
DEĞİŞTİRİLDİ, bkz. bölüm 7'deki "Aynı servis formu iki kayıt olarak görünüyordu" notu:
artık HER başarılı kayıttan sonra form temizleniyor.)

**İmza checkbox'ı** artık kendi kartında ("Yazdırma seçeneği" başlıklı), buton
satırından ayrı, `accent-color` ile vurgulu — dağınık tek satırlık haliyle değil.

---

## 13. Teklif Formu (2026-08-06)

Batuhan gerçek bir antetli kağıt (`assets/teklif-antet.png` — orijinali
`~/Desktop/petsis-antetli-1.png`, 1654×2339px, A4 ~200dpi) ve gerçek bir örnek teklif
(Bornova/Arkpet PDF) gönderdi. Örnekte kalemler **USD** cinsindendi, sağ üstte o günün
dolar kuru gösteriliyordu, toplamlar TL'ye çevrilmişti. Üç mimari karar
AskUserQuestion ile soruldu, üçünde de önerilen seçenek onaylandı: (1) teklif başına
**tek para birimi** seçilip kur otomatik çekilsin, (2) firma **mevcut Firmalar
listesinden** seçilsin (serbest metin değil), (3) teklifler **kaydedilsin, geçmişi
olsun** (tek seferlik doldur-yazdır değil).

**Servis formundan/faturadan TAMAMEN bağımsız** yeni bir sekme: "Teklif Formu".
Kendi kalem state'i (`teklifKalemleri`), kendi kalem tablosu pattern'i (`teklifKalemEkle`/
`Sil`/`UrunSecildi`/`Guncelle`/`TablosunuCiz` — diğer üç kalem tablosuyla — servis formu,
Fatura Kes — birebir aynı desen, sadece `miktar`/`cinsi`/`birimFiyat` alan adları farklı).

**Döviz mekaniği:** para birimi (`teklifParaBirimi`: TRY/USD/EUR) değişince
`open.er-api.com`'dan (ürün ekleme ekranındaki `tlKarsiligi()` ile AYNI API, ama kur
DEĞERİNİN kendisi lazım olduğu için ayrı, basit bir fetch) güncel kur otomatik çekilip
`teklifKur` input'una yazılıyor — kullanıcı isterse elle değiştirebilir (internet yoksa
elle girer). Kalemler seçilen döviz cinsinden giriliyor (TL'ye çevrilmiyor — ürün
kütüphanesindeki fiyatların hep TL olmasından FARKLI bir davranış, bilerek). Sadece
TOPLAMLAR (Toplam/KDV/Genel toplam) kur ile TL'ye çevriliyor, tıpkı örnekteki gibi.

**Antetli kağıt:** `teklifOnizlemeHtml()` içeriği, `#onizlemeOverlay`'in (servis
formuyla PAYLAŞILAN, beyaz kağıt) üstüne, `background-image: url('assets/teklif-antet.png')`
ile açılıyor — ayrı bir overlay YOK, aynı `onizlemeAc()`/`onizlemeKapat()` kullanılıyor,
buton bar'ları da servis formununkiyle aynı (`#onizlemeButonlarServis`: "← Düzenlemeye
dön" + "Yazdır" — teklif için de bu ikisi zaten yeterli, GİB'e özgü "Onayla" adımı yok).
**İlk versiyon** sadece görselin üst (logo) kısmını kırpıp gösteriyordu — Batuhan
"her şeyi antetli kağıdın üstüne yapacaksın" diyerek bunun yanlış olduğunu belirtti.
**Düzeltilmiş tasarım:** görsel artık TÜM SAYFANIN arka planı, hiç kırpılmıyor. Görsel
A4 ile birebir aynı en-boy oranında (1654×2339px ≈ 210×297mm) çekildiği için
`background-size:100% 100%` üzerinde bozulma olmadan tam oturuyor. İçerik (firma/tarih/
kalemler/toplamlar/imza), `min-height:277mm` + `padding:78mm 8mm 15mm` olan TEK bir
container İÇİNE konuyor — üst boşluk (78mm) logo alanını geçiyor, alttaki adres/website
zaten görselin kendi içinde olduğu için ayrıca yazılmıyor. `mm` birimi bilerek seçildi
(px/% yerine) — tarayıcı print motoru `mm`'i gerçek fiziksel sayfa ölçüsü olarak
yorumluyor, bu yüzden px/% tabanlı tahminlerden daha güvenilir.

**Ayrıca bulunan ve düzeltilen ayrı bir bug (2026-08-06):** İlk test çıktısında antet
kısmının kesildiğini bildirirken Batuhan'ın attığı PDF'te asıl sorun antet DEĞİL,
yazdırırken arkadaki "Teklif Formu" sekmesinin de aynı çıktıya art arda basılmasıydı —
bkz. bölüm 7'deki "Yazdırınca arka plandaki sekme de basılıyordu" notu (`.content`
print'te gizlenmiyordu, `position:fixed` print'te normal akışa dönüyor).

**Bilinmeyen/doğrulanmamış:** `padding-top:78mm` (logo alanı için ayrılan üst boşluk)
kabaca bir tahmin, kesin ölçülmedi. Batuhan gerçek çıktıda logo/tagline'ın hâlâ
kesildiğini ya da çok fazla boş alan olduğunu görürse bu değeri ayarlamak gerekir.
Ayrıca içerik bir A4 sayfasından UZUN olursa (çok kalem eklenirse) arka plan görseli
sadece ilk sayfada tam görünür, taşan kısım ikinci sayfada düz beyaz kalır — bu bilinen
bir sınırlama, v1 için kabul edildi (örnek teklif zaten tek sayfaya rahatça sığıyordu).

**İki ek düzeltme (2026-08-06, aynı gün, ikinci tur):**
1. Batuhan "yazıların arkasındaki kutucuklar antetli kağıdı bozmasın" dedi — `.card`/
   `.totals-box`/`th` normalde opak beyaz/gri arka planlı, antet görselinin üstünü
   kapatıyordu. `#onizlemeOverlay .teklif-antet-sayfa .card/.totals-box/table th` için
   `background: transparent !important` eklendi — ID+class kombinasyonu sayesinde
   (specificity) hem ekran hem print'teki genel `.card`/`.totals-box`/`th` kurallarını
   eziyor, servis formu/fatura önizlemesini ETKİLEMİYOR (onlar bu class'a sahip değil).
2. `@page { margin: 14mm; }` (önceden var, genel ayar) yüzünden antet görseli tam sayfayı
   değil, kenar boşluklu alanı kaplıyordu (en-boy oranı da bozuluyordu, 210×297mm yerine
   182×269mm'e sıkıştığı için). Print'e özel bir kural eklendi: `.teklif-antet-sayfa`
   `margin:-14mm` ile sayfa kenarına kadar taşırılıp (`width:calc(100% + 28mm)`,
   `min-height:297mm` — artık GERÇEKTEN tam A4), içerik aynı miktar ekstra padding
   (`92mm 22mm 20mm`, önceki değerlere +14mm) ile geri içeri çekiliyor — "full-bleed
   arka plan" tekniği. Bu SADECE `@media print` içinde, sadece `.teklif-antet-sayfa`
   class'ına uygulanıyor, başka hiçbir şeyi etkilemiyor.

**Hâlâ canlı yazıcı çıktısıyla doğrulanmadı** — bir sonraki denemede antetin tam
sayfayı kapladığından, kutucukların saydam olduğundan ve logo/tagline'ın kesilmediğinden
emin olunmalı.

**Çıktı düzeni değişikliği (2026-08-06, üçüncü tur):** Batuhan şunu istedi: Teklif No
kağıtta HİÇ görünmesin (kayıtta/geçmiş listesinde hâlâ var, sadece yazdırılmıyor);
Tarih artık Firma bilgisinin ÜSTÜNDE (önceden ikisi + Teklif No aynı satırda yan
yanaydı); Firma ile Ürünler tablosu arasına, hiçbir etiket/metin yazmayan TAMAMEN BOŞ
bir kutu eklendi (`border` ile çerçeveli, `min-height:70px`, sonradan elle yazı
yazılacak alan — mevcut "Açıklama / notlar" alanından FARKLI, o hâlâ toplamlardan
sonra kendi yerinde duruyor ve dijital olarak yazılan metni basıyor).

**Veri modeli — YENİ TABLOLAR, Batuhan'ın Supabase dashboard SQL Editor'de
ÇALIŞTIRMASI GEREKİYOR (henüz çalıştırılmadı):**
```sql
create table teklifler (
  id uuid primary key,
  user_id uuid default auth.uid(),
  firma_id uuid references firmalar(id),
  tarih date,
  para_birimi text,
  kur numeric,
  kdv_orani numeric,
  aciklama text,
  on_not text,
  teklif_no text,
  deleted boolean default false,
  updated_at timestamptz default now()
);

create table teklif_kalemleri (
  id uuid primary key,
  user_id uuid default auth.uid(),
  teklif_id uuid references teklifler(id),
  urun_id uuid references urunler(id),
  aciklama text,
  miktar numeric,
  cinsi text,
  birim_fiyat numeric,
  deleted boolean default false,
  updated_at timestamptz default now()
);

alter table teklifler enable row level security;
alter table teklif_kalemleri enable row level security;

create policy "kullanici kendi verisi" on teklifler
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "kullanici kendi verisi" on teklif_kalemleri
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
Bu çalıştırılmadan "Teklif Formu" sekmesinde kaydedilen teklifler yerelde görünür ama
Supabase'e senkronize olmaz (diğer tablolarla aynı şema-serbest `kayitUpsert` davranışı
— bkz. bölüm 6).

**`on_not` sütunu sonradan eklendi (2026-08-06, aynı gün, üçüncü tur):** Firma ile
Ürünler arasındaki kutu için — bu ayrı bir alan, kağıtta BAŞLIKSIZ basılıyor (mevcut
`aciklama` alanından farklı, o "Açıklama" başlığıyla toplamlardan SONRA basılıyor).
**Eğer Batuhan yukarıdaki SQL'i `on_not` eklenmeden ÖNCE zaten çalıştırdıysa**, ayrıca
şunu da çalıştırması gerekir:
```sql
alter table teklifler add column if not exists on_not text;
```

Teklif numarası formatı `T-2026-0001` (servis formunun `F-2026-0001` deseniyle aynı,
yereldeki teklif sayısından üretiliyor — bkz. bölüm 10'daki çok-kullanıcı uyarısı
burada da geçerli).

**Kapsam dışı (v1):** teklif düzenleme (servis formu gibi sonradan düzenlenemiyor,
sadece görüntülenip silinebiliyor), teklifi faturaya/servis formuna dönüştürme,
teklif geçerlilik süresi alanı, e-posta ile gönderim.
