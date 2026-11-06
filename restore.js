// Sunucu başlamadan önce çalışır: yerelde veritabanı yoksa yedekten (GitHub "veri" dalı ya da S3) geri yükler.
// ÖNEMLİ: Depoya ulaşılamazsa sunucuyu BAŞLATMAZ (aksi halde boş veritabanı yedeğin üstüne yazılırdı).
const fs = require('fs');
const path = require('path');
const bk = require('./backup');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(bk.DATA_DIR, { recursive: true });
  const dbPath = path.join(bk.DATA_DIR, 'app.db');
  if (!bk.enabled) {
    console.log('Yedekleme kapalı (GITHUB_TOKEN/GITHUB_REPO ya da S3_* değişkenleri yok): veriler bu sunucuda geçici/yerel tutulur, yeniden başlayınca SİLİNİR.');
    return;
  }
  if (fs.existsSync(dbPath)) return;

  for (let i = 1; i <= 5; i++) {
    try {
      await bk.getFile('app.db', dbPath);
      console.log(`Veritabanı yedekten geri yüklendi (${bk.mode}).`);
      return;
    } catch (e) {
      if (bk.isNotFound(e)) {
        console.log(`Depoda henüz yedek yok (${bk.mode}), yeni veritabanı oluşturulacak.`);
        return;
      }
      console.error(`Yedek okunamadı (deneme ${i}/5): ${e.name || ''} ${e.message}`);
      await sleep(3000 * i);
    }
  }
  console.error('Depoya ulaşılamadı. Veri kaybı olmasın diye sunucu başlatılmıyor. Yedekleme ayarlarını (GITHUB_* ya da S3_*) kontrol et.');
  process.exit(1);
})().then(
  () => process.exit(0),
  (e) => { console.error('Geri yükleme hatası', e); process.exit(1); }
);
