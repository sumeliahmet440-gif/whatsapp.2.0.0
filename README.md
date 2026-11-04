# Sohbet

Instagram + WhatsApp karışımı mesajlaşma uygulaması (Node.js, Express, Socket.IO, SQLite, WebRTC).

## Özellikler
- Sadece isim seçerek giriş, profil (foto + biyografi). Başka cihaz için profilde "giriş kodu" var.
- Takip sistemi: mesajlaşmak için **karşılıklı takip** şart.
- Birebir sohbet ve gruplar (kişi ekleme, gruptan çıkma).
- Mesaj, fotoğraf, video, ses ve her türlü dosya gönderme; hepsi veritabanında ve diskte saklanır, **hiçbir şey silinmez** (herkes gruptan çıksa bile).
- Eski mesajları yükleme (50'şer 50'şer).
- Hikayeler (24 saat görünür, dosyalar saklanır).
- Sesli/görüntülü arama, grup araması, arama sırasında ➕ ile kişi ekleme.

## Klasör yapısı
```
leko.js
backup.js
restore.js
package.json
render.yaml
.gitignore
public/index.html
```

## Yerelde çalıştırma
```
npm install
npm start
```
http://localhost:3000

## Kalıcı veri (tamamen ücretsiz): GitHub'a yedekleme
Kredi kartı gerekmez. Kullanıcılar, mesajlar, takipler, hikayeler (veritabanı) ve yüklenen dosyalar
**özel (private) bir GitHub reposuna** dosya olarak kaydedilir; sunucu açılırken oradan geri yüklenir.

1. GitHub'da yeni bir repo aç, adı `sohbet-veri`, **Private** seç. İçine bir `README.md` ekleyerek başlat (boş repo olmasın, `main` dalı olsun).
2. GitHub > Settings > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate:
   - Repository access: **Only select repositories** > `sohbet-veri`
   - Permissions > Repository permissions > **Contents: Read and write**
   - Token'ı kopyala.
3. Render > Environment bölümüne ekle:
   - `GH_TOKEN` = kopyaladığın token
   - `GH_REPO` = `kullanıcıadın/sohbet-veri`
4. Deploy et. Loglarda `Bulut yedekleme açık.` yazmalı.

Notlar: Veritabanı değişiklik oldukça en fazla dakikada bir, kapanırken de son kez kaydedilir. GitHub dosya sınırı 100 MB olduğu için
90 MB'tan büyük dosyalar yedeklenmez (sohbette görünür ama sunucu sıfırlanırsa kaybolur). Repo çok büyürse (1 GB+) eski repoyu silip yenisini açabilirsin.
Veri reposu MUTLAKA private olmalı. `GH_TOKEN` varsa S3 yerine o kullanılır.

## Alternatif: S3 ile bulut yedekleme
Render'ın ücretsiz planında disk her yeniden başlatmada sıfırlanır. Bu yüzden uygulama verileri
S3 uyumlu bir depoya otomatik yedekler ve açılırken geri yükler:
- Mesajlar, profiller, takipler, hikayeler (veritabanı): değişiklik oldukça her 20 saniyede yedeklenir, kapanırken de son bir yedek alınır.
- Fotoğraf / video / dosyalar: yüklenir yüklenmez depoya da kaydedilir; sunucu sıfırlanırsa istendiğinde depodan geri getirilir.
- Kullanıcı her zaman aynı hesabıyla (tarayıcıda kayıtlı, ya da profildeki giriş koduyla) geri döner, her şeyi yerinde bulur.

### Depo kurulumu (Cloudflare R2 ya da Backblaze B2, ikisi de ~10 GB ücretsiz)
1. Bir bucket (kova) oluştur, bir de erişim anahtarı (Access Key ID + Secret) üret.
2. Render > Environment bölümüne şunları gir:
   - `S3_ENDPOINT` (R2: `https://<hesap-id>.r2.cloudflarestorage.com`, B2: `https://s3.<bölge>.backblazeb2.com`)
   - `S3_BUCKET`, `S3_KEY`, `S3_SECRET`
   - B2 kullanıyorsan `S3_REGION` değerini bölgenle değiştir (ör. `us-west-004`).

## GitHub + Render
1. GitHub'da yeni repo aç, bu klasörün **içindekileri** (leko.js, package.json, backup.js, restore.js, render.yaml, public/ klasörü) repo'nun **köküne** yükle.
   (Klasörün kendisini değil; repo açılınca `package.json` ilk sayfada görünmeli.)
2. Render > **New > Web Service** > repoyu bağla ve şunları gir:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/healthz`
   - Instance Type: `Free`
3. **Environment** bölümüne `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_REGION` değerlerini gir (yukarıdaki depo kurulumu).
4. Deploy et. Loglarda `Bulut yedekleme açık.` yazısını görmelisin.

Not: S3 değişkenlerini girmezsen veriler Render yeniden başladığında SİLİNİR.
Ücretsiz planda sunucu 15 dk boşta kalınca uyur; ilk girişte ~1 dk içinde uyanır ve verilerini yedekten geri yükler.
Depoya ulaşılamazsa sunucu bilerek açılmaz (boş veritabanı yedeğin üstüne yazılmasın diye); ayarları düzeltip yeniden deploy et.

## Yeni özellikler
- 😊 Emoji paneli, **GIF** gönderme (GIPHY araması için Render'a ücretsiz `GIPHY_KEY` ekle; anahtar yoksa "Cihazdan GIF seç" çalışır).
- 📎 Birden çok foto / video / belge seçip gönderme, panodan yapıştırma ve sürükle-bırak.
- 🎙️ Sesli mesaj kaydı.
- ⬇ Sohbette yukarı kaydırınca "en alta in" butonu (yeni mesaj sayısıyla); yukarıda okurken sayfa kendi kaymaz.
- Profil fotoğrafı: hangi boyutta/şekilde olursa olsun ortadan kareye kırpılıp 512x512 yapılır, yuvarlağa tam oturur.
- Aramada 🖥️ ekran paylaşımı ve 🔄 ön/arka kamera çevirme.
- Tüm dosyalar (GIF, ses, profil fotoğrafı dahil) GitHub veri reposuna da yedeklenir.

## Notlar
- Mikrofon/kamera için HTTPS gerekir (Render verir).
- Aramalar WebRTC mesh: 4-6 kişiye kadar rahat çalışır.
- Bazı ağlarda arama bağlanmazsa `TURN_URL`, `TURN_USER`, `TURN_PASS` ortam değişkenlerini doldur.
- Dosya limiti 200 MB.
