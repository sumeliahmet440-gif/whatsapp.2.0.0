// Yedekleme / geri yükleme. İki seçenek:
//  1) GitHub (ücretsiz): GH_TOKEN + GH_REPO (özel bir veri reposu)
//  2) S3 uyumlu depo (Cloudflare R2, Backblaze B2...): S3_BUCKET, S3_KEY, S3_SECRET
// Hiçbiri tanımlı değilse hiçbir şey yapmaz (yerel disk kullanılır).
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const useGH = !!(process.env.GH_TOKEN && process.env.GH_REPO);
const useS3 = !useGH && !!(process.env.S3_BUCKET && process.env.S3_KEY && process.env.S3_SECRET);
const enabled = useGH || useS3;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
let s3 = null, S3 = null;
if (useS3) {
  S3 = require('@aws-sdk/client-s3');
  s3 = new S3.S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: true,
    // Yeni SDK sürümleri B2/R2'de sorun çıkaran ek sağlama toplamı göndermesin
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.S3_KEY, secretAccessKey: process.env.S3_SECRET },
  });
}
const Bucket = process.env.S3_BUCKET;

// ---------- GitHub (ücretsiz): verileri ÖZEL bir repoya dosya olarak kaydeder ----------
const GH_REPO = process.env.GH_REPO; // "kullanici/sohbet-veri"
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const GH_MAX = 90 * 1024 * 1024; // GitHub dosya sınırı 100 MB
const shaCache = new Map();
const ghUrl = (key) => `${process.env.GH_API || "https://api.github.com"}/repos/${GH_REPO}/contents/${key.split('/').map(encodeURIComponent).join('/')}`;
const ghHeaders = (accept) => ({
  Authorization: 'Bearer ' + process.env.GH_TOKEN,
  Accept: accept || 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'sohbet-app',
});
const ghErr = (r, text) => { const e = new Error(`GitHub ${r.status}: ${String(text).slice(0, 200)}`); e.status = r.status; e.name = r.status === 404 ? 'NotFound' : 'GitHubError'; return e; };

async function ghSha(key) {
  const r = await fetch(ghUrl(key) + '?ref=' + encodeURIComponent(GH_BRANCH), { headers: ghHeaders() });
  if (r.status === 404) return undefined;
  if (!r.ok) throw ghErr(r, await r.text());
  return (await r.json()).sha;
}
async function ghPut(key, filePath) {
  const size = fs.statSync(filePath).size;
  if (size > GH_MAX) throw new Error(`Dosya GitHub için çok büyük (${Math.round(size / 1048576)} MB): ${key}`);
  const content = fs.readFileSync(filePath).toString('base64');
  for (let i = 0; i < 3; i++) {
    let sha = shaCache.get(key);
    if (sha === undefined) sha = await ghSha(key);
    const body = { message: 'yedek: ' + key, content, branch: GH_BRANCH };
    if (sha) body.sha = sha;
    const r = await fetch(ghUrl(key), { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { shaCache.set(key, (await r.json()).content.sha); return; }
    const t = await r.text();
    if (r.status === 409 || r.status === 422) { shaCache.delete(key); continue; } // sha eski, yeniden al
    throw ghErr(r, t);
  }
  throw new Error('GitHub yazma başarısız: ' + key);
}
async function ghGet(key, dest) {
  const r = await fetch(ghUrl(key) + '?ref=' + encodeURIComponent(GH_BRANCH), { headers: ghHeaders('application/vnd.github.raw+json') });
  if (!r.ok) throw ghErr(r, await r.text());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  fs.renameSync(tmp, dest);
  try { const sha = await ghSha(key); if (sha) shaCache.set(key, sha); } catch {}
}

async function putFile(key, filePath) {
  if (!enabled) return;
  if (useGH) return ghPut(key, filePath);
  const size = fs.statSync(filePath).size;
  await s3.send(new S3.PutObjectCommand({ Bucket, Key: key, Body: fs.createReadStream(filePath), ContentLength: size }));
}

async function getFile(key, dest) {
  if (!enabled) throw new Error('yedekleme kapalı');
  if (useGH) return ghGet(key, dest);
  const r = await s3.send(new S3.GetObjectCommand({ Bucket, Key: key }));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  await pipeline(r.Body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

// Yerelde olmayan yüklemeyi depodan getir
async function fetchUpload(name) {
  await getFile('uploads/' + name, path.join(DATA_DIR, 'uploads', name));
}
async function putUpload(name) {
  await putFile('uploads/' + name, path.join(DATA_DIR, 'uploads', name));
}

const isNotFound = (e) =>
  !!e && (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.Code === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404));

const INTERVAL = useGH ? 60000 : 20000; // GitHub'da commit sayısını azaltmak için 60 sn
module.exports = { INTERVAL, isNotFound, enabled, DATA_DIR, putFile, getFile, putUpload, fetchUpload };
