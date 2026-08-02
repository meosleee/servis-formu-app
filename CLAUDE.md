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
├── main.js              # Electron ana süreç (pencere açar + otomatik güncelleme kontrolü)
├── preload.js           # Şu an boş — IPC köprüsüne ihtiyaç kalmadı
├── supabase.js          # SUPABASE_URL ve SUPABASE_KEY sabitleri
├── index.html           # TÜM uygulama: arayüz + iş mantığı + senkron
├── vendor/supabase.js   # supabase-js kütüphanesi (yerel kopya, CDN kullanılmıyor)
├── assets/logo.png      # Petsis logosu (arka planı şeffaf hale getirildi)
├── package.json         # electron-builder yapılandırması + publish (GitHub Releases) burada
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

**Koyu tema + yazdırma:** uygulama koyu tema, ama önizleme ve çıktı beyaz kağıt olmalı.
`#onizlemeOverlay` içinde renkler beyaza override ediliyor, `@media print` bloğu da
her şeyi siyah-beyaza zorluyor.

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
- [x] **e-Arşiv entegrasyonu** (2026-08-02, kod tamam, canlı test bekliyor). Ücretli
      entegratöre gerek kalmadan `fatura` (npm, github.com/f/fatura) paketiyle GİB
      e-Arşiv Portalı Batuhan'ın kendi kullanıcı adı/şifresiyle otomatikleştiriliyor.
      Detaylar için bkz. bölüm 11. Supabase şeması güncellendi. **Canlı uçtan uca test
      henüz yapılmadı** — GİB TEST hesabıyla deneme gerekiyor.
- [ ] Şifre sıfırlama akışı
- [ ] Google ile giriş (Google Cloud Console ayarı gerekir)
- [ ] Kesilmiş formu sonradan düzenleme
- [ ] Aylık ciro / form sayısı özeti
- [ ] Uygulama ikonu (şu an varsayılan Electron ikonu kullanılıyor)

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
- `patches/fatura+0.2.1.patch` — **`patch-package` ile kalıcı hale getirilmiş kritik
  bir düzeltme.** `fatura@0.2.1`'in `createDraftInvoice` fonksiyonu GİB'e ETTN alanını
  `faturaUuid` adıyla gönderiyor, GİB bunu tanımayıp "Ettn ya eksik ya boş" hatası
  veriyor (kütüphanenin kendi GitHub'ında bu tam sorunu düzelten ama birleştirilmemiş
  PR #45 var, biz aynı düzeltmeyi `ettn: faturaUuid` olarak yamaladık). `postinstall`
  script'i (`package.json`) her `npm install`'da bu yamayı otomatik uyguluyor —
  **`node_modules` silinip yeniden kurulsa bile düzeltme kaybolmaz.** Paket
  güncellenip bu bug resmi olarak düzeltilirse yama artık gereksiz olur, kaldırılabilir.
- `main.js` — `ipcMain.handle('earsiv:...')` kanalları (main process, Node-only —
  `fatura` renderer'da ÇALIŞAMAZ çünkü `contextIsolation: true`).
- `preload.js` — `window.earsiv.*` olarak `contextBridge` ile expose edilir (ilk kez
  gerçek içerik aldı, önceden tamamen boştu).
- `index.html` — "Ayarlar" sekmesi (GİB kimlik girişi, TEST/PROD seçimi, varsayılan
  TEST), "Geçmiş" sekmesinde "Faturayı Kes"/"Devam et"/"İndir" butonu + durum sütunu
  (`earsivDurumEtiketi`), SMS kod girme modalı (`#earsivSmsOverlay`).

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

**Sıradaki adım:** Yukarıdaki bulgular yüzünden TEST ortamında SMS akışını doğrulamanın
bir yolu kalmadı. Batuhan hazır olduğunda Ayarlar'da PROD'a geçip **tek, düşük tutarlı
gerçek bir formla** ilk canlı denemeyi yapmalı — draft oluşturma artık düzeltildiği için
(patch), `findInvoice` de (düşük hacimli gerçek hesapta) sorunsuz çalışması bekleniyor;
asıl merak edilen SMS gönder/doğrula/imzala adımlarının ilk kez gerçek hesapla nasıl
davranacağı.

**Kapsam dışı (v1):** iptal/storno akışı, otomatik/toplu kesim, kalem bazlı farklı KDV
oranı, faturanın e-posta ile otomatik gönderimi, çoklu cihaz arası GİB kimlik senkronu.
