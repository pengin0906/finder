'use strict';
// ============================================================
// indexer.js - ファイルインデクサー（KVS版）
// sfaのバッチ処理パターン: 高速ファイル走査 + KVS一括投入
// ネイティブモジュール不要
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const mime = require('mime-types');

let kvs = null;

// === カテゴリ定義 ===
const CATEGORIES = {
  document: { label: '文書', icon: '📄',
    ext: new Set(['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp',
      '.txt','.rtf','.csv','.tsv','.md','.tex','.pages','.numbers','.key','.epub','.mobi']) },
  image: { label: '画像', icon: '🖼️',
    ext: new Set(['.jpg','.jpeg','.png','.gif','.bmp','.svg','.webp','.ico','.tiff','.tif',
      '.raw','.cr2','.nef','.heic','.heif','.avif','.psd','.ai','.eps']) },
  video: { label: '動画', icon: '🎬',
    ext: new Set(['.mp4','.avi','.mkv','.mov','.wmv','.flv','.webm','.m4v','.mpg','.mpeg','.3gp','.ogv','.ts']) },
  audio: { label: '音楽', icon: '🎵',
    ext: new Set(['.mp3','.wav','.flac','.aac','.ogg','.wma','.m4a','.opus','.aiff','.mid','.midi']) },
  code: { label: 'コード', icon: '💻',
    ext: new Set(['.js','.ts','.jsx','.tsx','.py','.rb','.go','.rs','.java','.c','.cpp','.h',
      '.cs','.php','.swift','.kt','.html','.css','.scss','.sql','.yaml','.yml','.json','.xml',
      '.sh','.bash','.vue','.svelte','.dart','.lua','.ipynb']) },
  archive: { label: '圧縮', icon: '📦',
    ext: new Set(['.zip','.tar','.gz','.bz2','.xz','.7z','.rar','.dmg','.iso','.pkg','.deb','.rpm','.appimage']) },
  font: { label: 'フォント', icon: '🔤', ext: new Set(['.ttf','.otf','.woff','.woff2','.eot']) },
  data: { label: 'データ', icon: '🗃️',
    ext: new Set(['.db','.sqlite','.sqlite3','.mdb','.parquet','.hdf5','.h5','.npy','.pkl']) }
};

function categorize(ext) {
  const lower = (ext || '').toLowerCase();
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    if (def.ext.has(lower)) return cat;
  }
  return 'other';
}

function getCategoryInfo() {
  const info = {};
  for (const [k, v] of Object.entries(CATEGORIES)) info[k] = { label: v.label, icon: v.icon };
  info.other = { label: 'その他', icon: '📁' };
  return info;
}

// === スキップ ===
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.cache', '.npm', '.yarn',
  'vendor', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache',
  'dist', 'build', '.next', '.nuxt', 'coverage', '.DS_Store', 'Thumbs.db',
  '$RECYCLE.BIN', 'System Volume Information', '.Trash', '.Trash-1000',
  'Library', '.Spotlight-V100', '.fseventsd', '.TemporaryItems',
  'snap', 'lost+found', 'proc', 'sys', 'dev', 'run'
]);
const MAX_DEPTH = 10;
const HASH_LIMIT = 50 * 1024 * 1024;

// === 状態 ===
let state = { running: false, progress: 0, total: 0, current: '' };
const listeners = [];

function onEvent(fn) { listeners.push(fn); }
function emit(event, data) { listeners.forEach(fn => fn(event, data)); }
function getState() { return { ...state }; }

function init(kvsInstance) { kvs = kvsInstance; }

// === メタデータ ===
function fileMeta(fp, stat) {
  const ext = path.extname(fp).toLowerCase();
  return {
    path: fp,
    name: path.basename(fp),
    ext,
    dir: path.dirname(fp),
    size: stat.size,
    category: categorize(ext),
    mime_type: mime.lookup(fp) || '',
    created_at: stat.birthtime.toISOString().slice(0, 19).replace('T', ' '),
    modified_at: stat.mtime.toISOString().slice(0, 19).replace('T', ' '),
    accessed_at: stat.atime.toISOString().slice(0, 19).replace('T', ' '),
    is_hidden: path.basename(fp).startsWith('.') ? 1 : 0,
    hash: null
  };
}

// === ハッシュ ===
function quickHash(fp, size) {
  if (size === 0 || size > HASH_LIMIT) return null;
  try {
    const h = crypto.createHash('md5');
    const fd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(Math.min(8192, size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    h.update(buf);
    if (size > 8192) {
      const tail = Buffer.alloc(8192);
      fs.readSync(fd, tail, 0, 8192, size - 8192);
      h.update(tail);
    }
    fs.closeSync(fd);
    h.update(String(size));
    return h.digest('hex');
  } catch { return null; }
}

// === ディレクトリ走査 ===
function walkDir(dirPath, depth = 0) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch { return; }

  const batch = [];
  const subdirs = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && depth === 0) continue;
    const fp = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        subdirs.push(fp);
      } else if (entry.isFile()) {
        batch.push(fileMeta(fp, fs.statSync(fp)));
      }
    } catch { /* skip */ }
  }

  if (batch.length > 0) kvs.putMany(batch);
  state.progress = kvs.size;
  state.current = dirPath;
  emit('progress', getState());

  for (const sub of subdirs) walkDir(sub, depth + 1);
}

// === フルインデックス ===
async function fullIndex(paths) {
  if (state.running) return { error: 'インデックス作成中' };
  if (!kvs) return { error: 'KVS未初期化' };

  const home = os.homedir();
  const targets = paths || [
    path.join(home, 'Desktop'), path.join(home, 'Documents'),
    path.join(home, 'Downloads'), path.join(home, 'Pictures'),
    path.join(home, 'Music'), path.join(home, 'Movies'),
    path.join(home, 'Videos'), home
  ];

  state = { running: true, progress: 0, total: 0, current: '' };
  emit('start', getState());

  try {
    for (const t of targets) {
      if (!fs.existsSync(t)) continue;
      if (fs.statSync(t).isDirectory()) {
        walkDir(t, t === home ? 0 : 0);
      }
    }

    // ホーム直下のファイル
    try {
      const homeFiles = [];
      for (const e of fs.readdirSync(home, { withFileTypes: true })) {
        if (e.isFile() && !e.name.startsWith('.')) {
          try { homeFiles.push(fileMeta(path.join(home, e.name), fs.statSync(path.join(home, e.name)))); }
          catch { /* skip */ }
        }
      }
      if (homeFiles.length > 0) kvs.putMany(homeFiles);
    } catch { /* skip */ }

    state.total = kvs.size;
    state.running = false;
    state.current = '';
    kvs.save();
    emit('done', getState());
    return { success: true, count: kvs.size };
  } catch (err) {
    state.running = false;
    emit('error', { error: err.message });
    return { error: err.message };
  }
}

// === ハッシュ計算（重複検出用）===
function computeHashes(limit = 3000) {
  if (!kvs) return 0;
  let computed = 0;
  for (const f of kvs.store.values()) {
    if (f.hash || !f.size || f.size > HASH_LIMIT) continue;
    const h = quickHash(f.path, f.size);
    if (h) { f.hash = h; computed++; }
    if (computed >= limit) break;
  }
  if (computed > 0) kvs.dirty = true;
  return computed;
}

// === リアルタイム監視 ===
let watcher = null;

function startWatching() {
  if (watcher || !kvs) return;
  const chokidar = require('chokidar');
  const home = os.homedir();
  const watchPaths = [
    path.join(home, 'Desktop'), path.join(home, 'Documents'),
    path.join(home, 'Downloads'), path.join(home, 'Pictures'),
  ].filter(p => fs.existsSync(p));

  if (watchPaths.length === 0) return;

  watcher = chokidar.watch(watchPaths, {
    ignored: [/(^|[\/\\])\./, '**/node_modules/**', '**/.git/**', '**/Library/**'],
    persistent: true, ignoreInitial: true, depth: MAX_DEPTH,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  });

  watcher.on('add', (fp) => {
    try { kvs.put(fileMeta(fp, fs.statSync(fp))); emit('file-added', { path: fp }); } catch {}
  });
  watcher.on('change', (fp) => {
    try { kvs.put(fileMeta(fp, fs.statSync(fp))); emit('file-changed', { path: fp }); } catch {}
  });
  watcher.on('unlink', (fp) => {
    kvs.delete(fp); emit('file-deleted', { path: fp });
  });
}

function stopWatching() {
  if (watcher) { watcher.close(); watcher = null; }
}

module.exports = { init, fullIndex, computeHashes, getState, onEvent, startWatching, stopWatching, getCategoryInfo };
