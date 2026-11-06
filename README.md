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

## Kalıcı veri (ücretsiz): GitHub'a otomatik yedekleme
Render'ın ücretsiz planında disk her yeniden başlatmada sıfırlanır. Bu yüzden uygulama verilerini
**kendi GitHub deponun `veri` dalına** kaydeder ve açılırken oradan okuyup geri yükler. Ek hesap, abonelik ya da kredi kartı gerekmez.

- **Mesajlar, profiller, takipler, hikayeler** (hepsi tek dosyada: `veri/app.db`): her değişiklikten yaklaşık 3-5 saniye sonra otomatik yedeklenir, sunucu kapanırken de son bir yedek alınır.
- **Fotoğraf / video / dosyalar** (`veri/uploads/`): yüklenir yüklenmez GitHub'a da konur; sunucu sıfırlanırsa istendiğinde oradan geri getirilir.
- Kullanıcı her zaman aynı hesabıyla (tarayıcıda kayıtlı, ya da profildeki giriş koduyla) geri döner, her şeyi yerinde bulur.
- Veriler **ayrı bir dalda** durur; ana dalın (`main`) değişmediği için Render her kayıtta yeniden deploy etmez. Dalın geçmişi şişmez (her kayıt tek commit).
- `veri/app.db` normal bir SQLite dosyasıdır; indirip [DB Browser for SQLite](https://sqlitebrowser.org) ile açıp bakabilirsin.

### Sınırlar (bilmen gerekenler)
- **25 MB'tan büyük dosyalar** (uzun videolar) GitHub'a konmaz; sunucu yeniden başlarsa o dosyalar kaybolur (mesaj yazısı kalır). Sınırı `GITHUB_MAX_FILE_MB` ile değiştirebilirsin ama GitHub dosya başına 100 MB'a izin verir ve ücretsiz Render'ın belleği (512 MB) büyük dosyalarda yetmez.
- Depo toplamı 900 MB'ı geçerse yeni dosyalar yedeklenmez (`GITHUB_MAX_TOTAL_MB`). GitHub depoların küçük kalmasını ister.
- Çok yoğun kullanımda GitHub'ın istek sınırına takılınabilir; uygulama bekleyip tekrar dener, kayıtlar biraz gecikebilir.
- Bu bir kişisel/arkadaş grubu uygulaması için uygundur; binlerce kullanıcı için gerçek bir depolama (R2/B2 gibi) gerekir.

### Çalışıyor mu? Kontrol et
Siteni açıp adresin sonuna `/durum` ekle (ör. `https://sohbet-app.onrender.com/durum`).
- `kalici_kayit: "AÇIK"` ve `lastBackupAgoSec` küçük bir sayıysa her şey yolunda.
- `KAPALI` yazıyorsa Render'da `GITHUB_TOKEN` / `GITHUB_REPO` girilmemiş demektir.
- `lastError` doluysa sebebi orada yazar (token süresi dolmuş, depo public, vb.).

### Kurulum (5 dakika)
1. **Deponu PRIVATE (özel) yap.** GitHub'da repo > Settings > en altta Danger Zone > Change visibility > Private.
   *Çok önemli:* veritabanında mesajlar ve herkesin giriş kodu var. Depo herkese açıksa uygulama **bilerek yedeklemez ve açılmaz** (logda sebebi yazar).
2. **Token oluştur:** GitHub > sağ üst profil > Settings > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate new token.
   - Repository access: **Only select repositories** > sohbet deponu seç
   - Permissions > Repository permissions > **Contents: Read and write**
   - Süre: ne kadar uzun seçebilirsen onu seç. Token'ın süresi dolarsa yedekleme durur (logda `Yedek hatası` görürsün); yenisini üretip Render'a yapıştır.
   - Oluşunca görünen `github_pat_...` değerini kopyala (bir daha gösterilmez).
3. **Render > Environment** bölümüne iki değişken gir:
   - `GITHUB_TOKEN` = kopyaladığın token
   - `GITHUB_REPO` = `kullanici/repo-adi` (ör. `ahmet/sohbet-app`)
4. Deploy et. Loglarda `Yedekleme açık (github).` yazısını görmelisin. Birkaç dakika kullanınca GitHub deponda `veri` adlı yeni bir dal belirir; içinde `veri/app.db` vardır.

Hata mesajları loglarda Türkçe ve açıklamalı çıkar (ör. "depo herkese açık", "token geçersiz", "depo bulunamadı").

> Zaten S3 uyumlu bir depon (Cloudflare R2, Backblaze B2) varsa onu da kullanabilirsin: `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET` (+ B2'de `S3_REGION`) değişkenlerini girersen GitHub yerine o kullanılır. İkisi de girilirse S3 öncelikli.

## GitHub + Render
1. GitHub'da yeni **private** repo aç, bu klasörün **içindekileri** (leko.js, package.json, backup.js, restore.js, render.yaml, public/ klasörü) repo'nun **köküne** yükle.
   (Klasörün kendisini değil; repo açılınca `package.json` ilk sayfada görünmeli.)
2. Render > **New > Web Service** > repoyu bağla ve şunları gir:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/healthz`
   - Instance Type: `Free`
3. **Environment** bölümüne `GITHUB_TOKEN` ve `GITHUB_REPO` değerlerini gir (yukarıdaki kurulum).
4. Deploy et. Loglarda `Yedekleme açık (github).` yazısını görmelisin.

Not: Bu değişkenleri girmezsen veriler Render yeniden başladığında SİLİNİR.
Ücretsiz planda sunucu 15 dk boşta kalınca uyur; ilk girişte ~1 dk içinde uyanır ve verilerini GitHub'dan geri yükler.
Depoya ulaşılamazsa sunucu bilerek açılmaz (boş veritabanı yedeğin üstüne yazılmasın diye); ayarları düzeltip yeniden deploy et.
Kodunu güncellemek için `main` dalına yüklemen yeterli, `veri` dalına dokunma (ya da silme, yoksa veriler gider).

## Notlar
- Mikrofon/kamera için HTTPS gerekir (Render verir).
- Aramalar WebRTC mesh: 4-6 kişiye kadar rahat çalışır.
- Bazı ağlarda arama bağlanmazsa `TURN_URL`, `TURN_USER`, `TURN_PASS` ortam değişkenlerini doldur.
- Dosya limiti 200 MB.


## Yeni özellikler (v1.2.0): GIF, ses kaydı ve çevrimdışı bildirimler
- Sohbet ekranındaki **GIF** düğmesi kısa bir videodan (en fazla 2,5 saniye) GIF üretir ve gönderir. GIF.js yerel npm bağımlılığı olarak sunulur; GIF dosyaları normal görsel gibi mevcut uploads/GitHub yedekleme yoluna girer.
- **🎙** düğmesi sesli mesaj kaydeder. Tarayıcı mikrofon izni ister; kayıt normal ses dosyası olarak gönderilir ve mevcut dosya yedeklemesine dahildir.
- Profilde **Bildirimleri aç** düğmesi Web Push aboneliği oluşturur. Mesaj ve gelen arama bildirimleri tarayıcı kapalıyken desteklenen tarayıcı/cihazlarda gelebilir. Aramaya cevap vermek için bildirime dokunup uygulamayı açmak gerekir; arka planda WebRTC görüşmesi garantisi yoktur.

### Web Push kurulumu (Render)
1. `npm install` çalıştırılmalı (web-push bağımlılığı eklendi).
2. Yerelde `npx web-push generate-vapid-keys` komutuyla anahtar çifti üret.
3. Render Environment bölümüne şu değişkenleri ekle:
   - `VAPID_PUBLIC_KEY` = üretilen public key
   - `VAPID_PRIVATE_KEY` = üretilen private key (gizli tut; GitHub'a koyma)
   - `VAPID_SUBJECT` = `mailto:senin-eposta-adresin` (geçerli iletişim e-postan)
4. Yeniden deploy et. Kullanıcılar uygulamada Profil > Bildirimleri aç seçeneğine basmalı.

Not: Web Push HTTPS gerektirir. Tarayıcı/işletim sistemi bildirim izni, güç tasarrufu, cihazın çevrimdışı olması ve Render'ın ücretsiz plandaki uyku davranışı teslimatı etkileyebilir. Bu özellikler GitHub yedekleme ayarlarını değiştirmez; yeni abonelik tablosu aynı `app.db` içinde saklanır.


## Yeni sürüm ekleri
- Mesajlar 10 günden sonra otomatik temizlenir (sunucu açılışında ve 6 saatte bir).
- Reels videoları 5 ay saklanır; her kullanıcı 7 günde en fazla 1 Reels paylaşabilir.
- Reels akışı, beğeni, yorum ve bağlantı paylaşımı eklendi.
- Kullanıcı GIF/çıkartma kütüphanesi: isimle arama, yükleme ve sohbetten gönderme.
- 30 hazır cevaplı uygulama içi AI yardım bölümü eklendi.
- Grup kurucusu grup adını ve açıklamasını düzenleyebilir.
- Görüntülü arama ekranında ekran paylaşımı kontrolü eklendi.

**Temizlik notu:** Otomatik silme kalıcıdır. 10 günden eski mesajlar ve 5 aydan eski Reels kayıtları veritabanından silinir. İlişkisiz yükleme dosyaları GitHub/S3 yedek alanından da silinmeye çalışılır. GitHub'daki daha önce oluşturulmuş commit/blob nesnelerinin fiziksel alanı GitHub'ın kendi çöp toplama politikasına bağlı olabilir.
- Grup kurucusu grup fotoğrafını da değiştirebilir.


## Üç GitHub deposuna dağıtılmış yedekleme

Mevcut tek depo düzeni korunur. İkinci ve üçüncü depo isteğe bağlıdır; ayarlanmazlarsa dosyalar ilk depoya gider.

Render > Environment bölümünde:

- `GITHUB_TOKEN`: Üç depoya da erişebilen aynı Fine-grained token.
- `GITHUB_REPO`: Ana depo (`kullanici/sohbet-veri-1`). `app.db` burada saklanır.
- `GITHUB_REPO_MEDIA`: Medya deposu (`kullanici/sohbet-veri-2`). Fotoğraf, GIF, çıkartma ve diğer yüklemeler burada saklanır.
- `GITHUB_REPO_REELS`: Reels deposu (`kullanici/sohbet-veri-3`). `/api/reels` üzerinden yüklenen videolar burada saklanır.
- `GITHUB_BRANCH`: Üç depoda da kullanılacak dal; varsayılan `veri`.
- `GITHUB_MAX_FILE_MB`: Dosya başına sınır; varsayılan 25 MB.
- `GITHUB_MAX_TOTAL_MB`: Depo başına uygulama sınırı; varsayılan 900 MB.

Üç depo da Private olmalı. Token'ın her üç depo için `Contents: Read and write` izni bulunmalı. `GITHUB_REPO_MEDIA` veya `GITHUB_REPO_REELS` boş bırakılırsa ilgili dosyalar önceki tek-depo düzeniyle ana depoya yazılır.

Eski tek-depo yedekleri için geri uyumluluk vardır: uygulama yüklemeyi yeni hedef depoya yapar; dosya geri yüklenirken Reels, medya ve ana depoda arama yapar. Silinen dosyalar da üç depoda aranıp kaldırılır.

Önemli: GitHub bir medya CDN'i veya sınırsız dosya deposu değildir. Bu ayarlar uygulamanın kendi 25 MB tek dosya ve 900 MB depo başına sınırlarını uygular; GitHub'ın kendi limitleri ayrıca geçerlidir. Büyük video yüklemeleri bu sınıra sığmıyorsa kalıcı yedeklenmez. Üç depoya ayırmak GitHub API hız limitini üçe katlamaz.

## PWA kurulum ve bildirim notları
- Android ve Windows'ta desteklenen tarayıcılarda Profil > Uygulamalar bölümünden kurulum istemi açılır. Tarayıcı istemi sunmazsa tarayıcı menüsündeki "Uygulamayı yükle" seçeneği kullanılabilir.
- iPhone/iPad'de Safari > Paylaş > Ana Ekrana Ekle adımları gerekir.
- Uygulama simgesi `/icon-192.png` ve `/icon-512.png` dosyalarıyla sağlanır.
- Web Push için Render'da `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` ve tercihen `VAPID_SUBJECT` tanımlanmalıdır. Kullanıcı profilinden bildirim izni vermelidir.
- Arka plandaki/kapalı uygulamada mesaj ve arama uyarıları işletim sistemi web bildirimi olarak gelir. Bildirimin kendi sesini cihaz/tarayıcı ayarları belirler; web sayfası kapalıyken özel bir ses dosyasını zorla çaldırmak tarayıcı güvenlik kısıtları nedeniyle mümkün değildir.
- iOS web push desteği sürüm ve kurulum koşullarına bağlıdır; ana ekrana eklenmiş web uygulaması ve kullanıcı izni gerekir.
- AI ekranı bu pakette uygulama yardım bilgi bankasıyla çalışan, WhatsApp benzeri sohbet düzeninde bir yardımcıdır. Gerçek üretken AI yanıtları için ayrıca güvenli sunucu tarafı AI API entegrasyonu ve API anahtarı gerekir; tarayıcıya gizli anahtar konulmamalıdır.
