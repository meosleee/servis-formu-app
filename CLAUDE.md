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

**Repo:** github.com/meosleee/servis-formu-app (private)
**Supabase proje URL:** https://buncfnwagyrsgpayyqal.supabase.co

---

## 4. Dosya yapısı

```
servis-formu-app/
├── main.js              # Electron ana süreç (sadece pencere açar, ~30 satır)
├── preload.js           # Şu an boş — IPC köprüsüne ihtiyaç kalmadı
├── supabase.js          # SUPABASE_URL ve SUPABASE_KEY sabitleri
├── index.html           # TÜM uygulama: arayüz + iş mantığı + senkron
├── vendor/supabase.js   # supabase-js kütüphanesi (yerel kopya, CDN kullanılmıyor)
├── assets/logo.png      # Petsis logosu (arka planı şeffaf hale getirildi)
├── package.json         # electron-builder yapılandırması burada
└── .github/workflows/build-win.yml   # Windows derleme akışı
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
Çözüm: build komutuna `-- --publish never` eklendi.

**Kalem tablosunda her harfte odak kaybı:** her tuş vuruşunda tablo yeniden çiziliyordu.
Çözüm: `kalemGuncelle` artık tabloyu yeniden çizmiyor, sadece ilgili hücreyi güncelliyor.

**Koyu tema + yazdırma:** uygulama koyu tema, ama önizleme ve çıktı beyaz kağıt olmalı.
`#onizlemeOverlay` içinde renkler beyaza override ediliyor, `@media print` bloğu da
her şeyi siyah-beyaza zorluyor.

---

## 8. Derleme ve dağıtım

**Mac (yerel):** `npm start` ile çalıştır, `npm run dist:mac` ile dmg üret.

**Windows:** yerel Mac'te derlenemez. GitHub Actions kullanılıyor:
1. Değişiklikleri push et
2. GitHub → Actions → "Windows Build" → Run workflow
3. İş bitince Artifacts → `petsis-servis-formu-windows` zip'i indir → içinde Setup.exe

Uygulama imzasız olduğu için Windows SmartScreen uyarısı verir
("Ek bilgi" → "Yine de çalıştır" ile geçilir). Kod imzalama sertifikası ücretli,
şimdilik alınmadı.

---

## 9. Yapılacaklar / fikirler

- [ ] **Otomatik güncelleme** (electron-updater). Repo private olduğu için token
      derdi var; en temiz yol repo'yu public yapmak. Kullanıcıya soruldu, karar bekliyor.
- [ ] **e-Arşiv entegrasyonu.** Kullanıcı faturaları GİB e-Arşiv Portal'dan kesiyor.
      Portalın resmi API'si yok; otomatik entegrasyon ancak Paraşüt/Uyumsoft gibi
      ücretli özel entegratörlerle olur. Ara çözüm olarak "form verilerini e-Arşiv'e
      yapıştırmak için panoya kopyala" özelliği önerildi, henüz yapılmadı.
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
