// Yedekleme / geri yükleme.
// GitHub: GITHUB_TOKEN + GITHUB_REPO (ana depo) zorunlu.
// İsteğe bağlı: GITHUB_REPO_MEDIA ve GITHUB_REPO_REELS ile medya/Reels ayrı depolara gider.
// S3 ayarları varsa mevcut davranış korunur ve S3 önceliklidir.
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const useS3 = !!(process.env.S3_BUCKET && process.env.S3_KEY && process.env.S3_SECRET);
const primaryRepo = String(process.env.GITHUB_REPO || '').trim();
const mediaRepo = String(process.env.GITHUB_REPO_MEDIA || primaryRepo).trim();
const reelsRepo = String(process.env.GITHUB_REPO_REELS || mediaRepo || primaryRepo).trim();
const useGh = !useS3 && !!(process.env.GITHUB_TOKEN && primaryRepo);
const enabled = useS3 || useGh;
const mode = useS3 ? 's3' : useGh ? 'github-multi' : 'local';
const interval = Number(process.env.BACKUP_INTERVAL_MS) || 2000;

const state = { lastOk: null, lastKey: null, lastError: null, lastErrorAt: null, okCount: 0, errCount: 0 };
function status() {
  return {
    mode, enabled,
    repositories: useGh ? { database: primaryRepo, media: mediaRepo, reels: reelsRepo } : undefined,
    lastBackupAt: state.lastOk ? new Date(state.lastOk).toISOString() : null,
    lastBackupAgoSec: state.lastOk ? Math.round((Date.now() - state.lastOk) / 1000) : null,
    okCount: state.okCount, errCount: state.errCount,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt).toISOString() : null,
  };
}

class NotFoundError extends Error { constructor(m) { super(m); this.name = 'NotFound'; } }
const isNotFound = (e) =>
  !!e && (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.Code === 'NoSuchKey' ||
    e.name === 'GitHubError' && e.status === 404 ||
    (e.$metadata && e.$metadata.httpStatusCode === 404));

// ======================= S3 (mevcut davranış korunur) =======================
let s3 = null, S3 = null;
if (useS3) {
  S3 = require('@aws-sdk/client-s3');
  s3 = new S3.S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.S3_KEY, secretAccessKey: process.env.S3_SECRET },
  });
}
const Bucket = process.env.S3_BUCKET;
async function s3Put(key, filePath) {
  const size = fs.statSync(filePath).size;
  await s3.send(new S3.PutObjectCommand({ Bucket, Key: key, Body: fs.createReadStream(filePath), ContentLength: size }));
}
async function s3Get(key, dest) {
  const r = await s3.send(new S3.GetObjectCommand({ Bucket, Key: key }));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  await pipeline(r.Body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}
async function s3Delete(key) {
  await s3.send(new S3.DeleteObjectCommand({ Bucket, Key: key }));
}

// ======================= GitHub: depo başına bağımsız kuyruk =======================
const common = {
  api: (process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, ''),
  token: process.env.GITHUB_TOKEN,
  branch: process.env.GITHUB_BRANCH || 'veri',
  dir: String(process.env.GITHUB_DIR || 'veri').replace(/^\/+|\/+$/g, ''),
  delay: Number(process.env.GITHUB_DELAY_MS) || 3000,
  maxFile: (Number(process.env.GITHUB_MAX_FILE_MB) || 25) * 1024 * 1024,
};
function normalizeRepo(value) {
  return String(value || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
}
class GhError extends Error {
  constructor(status, msg) { super(`GitHub ${status}: ${msg}`); this.name = 'GitHubError'; this.status = status; }
}
const storeCache = new Map();
function createStore(repoValue) {
  const repo = normalizeRepo(repoValue);
  if (!repo) return null;
  if (storeCache.has(repo)) return storeCache.get(repo);
  const store = {
    ...common, repo, base: common.dir ? common.dir + '/' : '',
    accessOk: false, head: null, headAt: 0,
    pending: new Map(), timer: null, running: false,
  };
  storeCache.set(repo, store);
  return store;
}
const dbStore = useGh ? createStore(primaryRepo) : null;
const mediaStore = useGh ? createStore(mediaRepo || primaryRepo) : null;
const reelsStore = useGh ? createStore(reelsRepo || mediaRepo || primaryRepo) : null;

async function gh(store, method, p, body, accept) {
  const url = `${store.api}/repos/${store.repo}${p}`;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: 'Bearer ' + store.token,
          Accept: accept || 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'sohbet-app',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(2000 * attempt);
      continue;
    }
    const limited = (res.status === 403 || res.status === 429) &&
      (res.headers.get('retry-after') || res.headers.get('x-ratelimit-remaining') === '0');
    if ((limited || res.status >= 500) && attempt < 4) {
      let wait = Number(res.headers.get('retry-after')) * 1000;
      if (!wait) {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
        wait = limited && reset > 0 ? reset : 3000 * attempt;
      }
      await res.arrayBuffer().catch(() => {});
      await sleep(Math.min(wait, 60000));
      continue;
    }
    return res;
  }
}
async function must(res) {
  if (res.ok) return res;
  let msg = '';
  try { const j = await res.json(); msg = j.message || JSON.stringify(j); } catch {}
  throw new GhError(res.status, msg || res.statusText);
}
async function ensureAccess(store) {
  if (store.accessOk) return;
  if (!/^[\w.-]+\/[\w.-]+$/.test(store.repo))
    throw new Error('GitHub depo adı "kullanıcı/depo-adı" biçiminde olmalı: ' + store.repo);
  const r = await gh(store, 'GET', '');
  if (r.status === 401) throw new Error('GITHUB_TOKEN geçersiz ya da süresi dolmuş');
  if (r.status === 404) throw new Error(`GitHub deposu bulunamadı veya token erişemiyor: ${store.repo}. Token'da Contents: Read and write izni olmalı.`);
  await must(r);
  const info = await r.json();
  if (!info.private && process.env.GITHUB_ALLOW_PUBLIC !== '1')
    throw new Error(`GitHub deposu herkese açık (public): ${store.repo}. Güvenlik için Private yap.`);
  if (info.permissions && info.permissions.push === false)
    throw new Error(`Token yazma iznine sahip değil: ${store.repo}. Contents: Read and write ver.`);
  store.accessOk = true;
}
async function loadHead(store, maxAge = 0) {
  if (store.head && Date.now() - store.headAt <= maxAge) return store.head;
  await ensureAccess(store);
  const rr = await gh(store, 'GET', `/git/ref/heads/${encodeURIComponent(store.branch)}`);
  if (rr.status === 404) {
    store.head = { commit: null, tree: null, files: new Map(), total: 0 };
    store.headAt = Date.now();
    return store.head;
  }
  await must(rr);
  const commit = (await rr.json()).object.sha;
  if (store.head && store.head.commit === commit) { store.headAt = Date.now(); return store.head; }
  const cr = await must(await gh(store, 'GET', `/git/commits/${commit}`));
  const tree = (await cr.json()).tree.sha;
  const tr = await must(await gh(store, 'GET', `/git/trees/${tree}?recursive=1`));
  const t = await tr.json();
  if (t.truncated) throw new Error(`GitHub dosya listesi kesildi: ${store.repo}`);
  const files = new Map();
  let total = 0;
  for (const e of t.tree) {
    if (e.type === 'blob' && e.path.startsWith(store.base)) {
      files.set(e.path.slice(store.base.length), { sha: e.sha, size: e.size || 0 });
      total += e.size || 0;
    }
  }
  store.head = { commit, tree, files, total };
  store.headAt = Date.now();
  return store.head;
}
async function ghGet(store, key, dest) {
  let f = (await loadHead(store, 20000)).files.get(key);
  if (!f) f = (await loadHead(store, 0)).files.get(key);
  if (!f) throw new NotFoundError(`GitHub deposunda yok: ${key} (${store.repo})`);
  const r = await must(await gh(store, 'GET', `/git/blobs/${f.sha}`, undefined, 'application/vnd.github.raw+json'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

function arm(store, urgent) {
  if (store.running) return;
  if (urgent) {
    if (store.timer) clearTimeout(store.timer);
    store.timer = setTimeout(() => runFlush(store), 0);
  } else if (!store.timer) store.timer = setTimeout(() => runFlush(store), store.delay);
}
function ghPut(store, key, filePath, urgent) {
  return new Promise((resolve, reject) => {
    const cur = store.pending.get(key);
    if (cur) { cur.file = filePath; cur.waiters.push({ resolve, reject }); }
    else store.pending.set(key, { file: filePath, waiters: [{ resolve, reject }] });
    arm(store, urgent);
  });
}
async function runFlush(store) {
  store.timer = null;
  if (store.running || !store.pending.size) return;
  store.running = true;
  const batch = store.pending;
  store.pending = new Map();
  try {
    await commitBatch(store, batch);
    for (const it of batch.values()) it.waiters.forEach((w) => w.resolve());
  } catch (e) {
    for (const it of batch.values()) it.waiters.forEach((w) => w.reject(e));
  } finally {
    store.running = false;
    if (store.pending.size) arm(store, true);
  }
}
async function commitBatch(store, batch) {
  const h = await loadHead(store, 0);
  const entries = [], added = new Map();
  for (const [key, it] of batch) {
    let buf;
    try { buf = fs.readFileSync(it.file); }
    catch (e) { console.error('Yedeklenecek dosya okunamadı:', key, e.message); continue; }
    const isUpload = key.startsWith('uploads/');
    if (isUpload && buf.length > store.maxFile) {
      console.warn(`GitHub'a konmadı (${(buf.length / 1048576).toFixed(1)} MB dosya sınırı aşıldı): ${key}`);
      continue;
    }
    const b = await must(await gh(store, 'POST', '/git/blobs', { content: buf.toString('base64'), encoding: 'base64' }));
    const sha = (await b.json()).sha;
    entries.push({ path: store.base + key, mode: '100644', type: 'blob', sha });
    added.set(key, { sha, size: buf.length });
  }
  if (!entries.length) return;
  const t = await must(await gh(store, 'POST', '/git/trees', { ...(h.tree ? { base_tree: h.tree } : {}), tree: entries }));
  const tree = (await t.json()).sha;
  const c = await must(await gh(store, 'POST', '/git/commits', {
    message: 'veri yedeği ' + new Date().toISOString(), tree, parents: [],
  }));
  const commit = (await c.json()).sha;
  const refPath = `refs/heads/${store.branch}`;
  let done = false;
  if (!h.commit) {
    const r = await gh(store, 'POST', '/git/refs', { ref: refPath, sha: commit });
    if (r.status === 422) await r.arrayBuffer().catch(() => {});
    else { await must(r); done = true; }
  }
  if (!done) await must(await gh(store, 'PATCH', `/git/refs/heads/${encodeURIComponent(store.branch)}`, { sha: commit, force: true }));
  const files = new Map(h.files);
  for (const [k, v] of added) files.set(k, v);
  let total = 0;
  for (const v of files.values()) total += v.size;
  store.head = { commit, tree, files, total };
  store.headAt = Date.now();
}
async function deleteCloudFile(store, key) {
  if (!store) return;
  const h = await loadHead(store, 0);
  const old = h.files.get(key);
  if (!old) return;
  const t = await must(await gh(store, 'POST', '/git/trees', {
    ...(h.tree ? { base_tree: h.tree } : {}),
    tree: [{ path: store.base + key, mode: '100644', type: 'blob', sha: null }],
  }));
  const tree = (await t.json()).sha;
  const c = await must(await gh(store, 'POST', '/git/commits', {
    message: 'eski dosya temizliği ' + new Date().toISOString(), tree, parents: [],
  }));
  const commit = (await c.json()).sha;
  const refPath = `refs/heads/${store.branch}`;
  if (!h.commit) {
    const r = await gh(store, 'POST', '/git/refs', { ref: refPath, sha: commit });
    if (r.status !== 422) await must(r); else await r.arrayBuffer().catch(() => {});
  } else {
    await must(await gh(store, 'PATCH', `/git/refs/heads/${encodeURIComponent(store.branch)}`, { sha: commit, force: true }));
  }
  h.files.delete(key);
  h.total = [...h.files.values()].reduce((n, v) => n + v.size, 0);
  h.commit = commit; h.tree = tree; store.headAt = Date.now();
}

// app.db her zaman ilk depoda; yüklemeler türüne göre medya veya Reels deposunda.
function storeForUpload(category) {
  return category === 'reels' ? reelsStore : mediaStore;
}
function storesForRead(key) {
  if (key !== 'app.db' && key.startsWith('uploads/')) return [...new Set([reelsStore, mediaStore, dbStore].filter(Boolean))];
  return [dbStore].filter(Boolean);
}

async function putFile(key, filePath, urgent, category) {
  if (!enabled) return;
  try {
    if (useS3) await s3Put(key, filePath);
    else {
      const store = key.startsWith('uploads/') ? storeForUpload(category) : dbStore;
      await ghPut(store, key, filePath, !!urgent);
    }
    state.lastOk = Date.now(); state.lastKey = key; state.okCount++; state.lastError = null;
  } catch (e) {
    state.lastError = String((e && e.message) || e).slice(0, 300);
    state.lastErrorAt = Date.now(); state.errCount++;
    throw e;
  }
}
async function getFile(key, dest) {
  if (!enabled) throw new Error('yedekleme kapalı');
  if (useS3) return s3Get(key, dest);
  let lastError = null;
  for (const store of storesForRead(key)) {
    try { await ghGet(store, key, dest); return; }
    catch (e) {
      if (isNotFound(e)) { lastError = e; continue; }
      throw e;
    }
  }
  throw lastError || new NotFoundError('Yedek bulunamadı: ' + key);
}
async function fetchUpload(name) {
  return getFile('uploads/' + name, path.join(DATA_DIR, 'uploads', name));
}
async function putUpload(name, category) {
  const file = path.join(DATA_DIR, 'uploads', name);
  if (useGh && fs.statSync(file).size > common.maxFile) {
    console.warn(`GitHub'a konmadı (${(common.maxFile / 1048576).toFixed(1)} MB dosya sınırı): ${name}`);
    return;
  }
  return putFile('uploads/' + name, file, true, category || 'media');
}
let deleteChain = Promise.resolve();
function deleteUpload(name) {
  deleteChain = deleteChain.catch(() => {}).then(async () => {
    const key = 'uploads/' + name;
    if (useS3) return s3Delete(key);
    if (!useGh) return;
    // Eski tek-depo sürümünden kalan dosyalar dahil, üç depoda da ara.
    for (const store of new Set([reelsStore, mediaStore, dbStore].filter(Boolean))) {
      await deleteCloudFile(store, key);
    }
  });
  return deleteChain;
}
function flushNow() {
  if (!useGh) return;
  for (const store of storeCache.values()) if (store.pending.size) arm(store, true);
}

module.exports = {
  isNotFound, enabled, mode, interval, DATA_DIR,
  putFile, getFile, putUpload, fetchUpload, deleteUpload, flushNow, status,
};
