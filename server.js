'use strict';
// ============================================================
// server.js - Express サーバー
// sfa のアーキテクチャ: Helmet + CORS + Compression + REST API
// 初心者に優しいファイルファインダー
// ============================================================
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const { fileOps, favOps, tagOps, close: closeDb } = require('./lib/db');
const indexer = require('./lib/indexer');

const app = express();
const PORT = process.env.PORT || 3456;

// === ミドルウェア（sfa同様のセキュリティスタック）===
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === SSE（リアルタイム更新）===
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('data: {"type":"connected"}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(type, data) {
  const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

indexer.onEvent((event, data) => broadcast(event, data));

// === API エンドポイント ===

// ダッシュボード統計
app.get('/api/stats', (req, res) => {
  const stats = fileOps.stats();
  const categories = fileOps.categoryStats();
  const catInfo = indexer.getCategoryInfo();
  const enriched = categories.map(c => ({
    ...c,
    label: catInfo[c.category]?.label || 'その他',
    icon: catInfo[c.category]?.icon || '📁'
  }));
  // その他カテゴリにアイコンと名前付与
  enriched.forEach(c => {
    if (c.category === 'other' && !catInfo[c.category]) {
      c.label = 'その他';
      c.icon = '📁';
    }
  });
  res.json({ ...stats, categories: enriched, indexState: indexer.getState() });
});

// 検索
app.get('/api/search', (req, res) => {
  const q = req.query.q || '';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  if (!q.trim()) return res.json([]);
  res.json(fileOps.search(q, limit, offset));
});

// 最近のファイル
app.get('/api/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  res.json(fileOps.recent(limit));
});

// カテゴリ別ファイル
app.get('/api/category/:name', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const sort = req.query.sort || 'modified_at';
  const order = req.query.order || 'DESC';
  res.json(fileOps.byCategory(req.params.name, limit, offset, sort, order));
});

// タイムライン（最近のイベント）
app.get('/api/timeline', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(fileOps.recentEvents(limit));
});

// 重複ファイル
app.get('/api/duplicates', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(fileOps.duplicates(limit));
});

// 大きいファイル
app.get('/api/large', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(fileOps.largeFiles(limit));
});

// ディレクトリ閲覧
app.get('/api/browse', (req, res) => {
  const dir = req.query.path || os.homedir();
  const sort = req.query.sort || 'name';
  const order = req.query.order || 'ASC';

  // インデックスされたファイル
  const files = fileOps.browse(dir, sort, order);

  // 実際のサブディレクトリも返す
  let subdirs = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    subdirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: path.join(dir, e.name),
        isDir: true
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* permission denied */ }

  res.json({ dir, files, subdirs, parent: path.dirname(dir) });
});

// お気に入り
app.get('/api/favorites', (req, res) => res.json(favOps.list()));
app.post('/api/favorites', (req, res) => {
  const { path: fp } = req.body;
  if (!fp) return res.status(400).json({ error: 'path required' });
  favOps.add(fp);
  res.json({ ok: true });
});
app.delete('/api/favorites', (req, res) => {
  const { path: fp } = req.body;
  if (!fp) return res.status(400).json({ error: 'path required' });
  favOps.remove(fp);
  res.json({ ok: true });
});

// タグ
app.get('/api/tags', (req, res) => res.json(tagOps.list()));
app.post('/api/tags', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  tagOps.create(name, color);
  res.json({ ok: true });
});

// ファイルにタグ
app.post('/api/files/:id/tags', (req, res) => {
  const { tagId } = req.body;
  tagOps.addToFile(parseInt(req.params.id), tagId);
  res.json({ ok: true });
});

// ファイル情報
app.get('/api/file', (req, res) => {
  const fp = req.query.path;
  if (!fp) return res.status(400).json({ error: 'path required' });
  const file = fileOps.getByPath(fp);
  if (!file) return res.status(404).json({ error: 'not found' });
  const tags = tagOps.getFileTags(file.id);
  const isFav = favOps.isFav(fp);
  res.json({ ...file, tags, isFavorite: isFav });
});

// ファイルを開く
app.post('/api/open', (req, res) => {
  const { path: fp } = req.body;
  if (!fp || !fs.existsSync(fp)) return res.status(400).json({ error: 'file not found' });
  const cmd = process.platform === 'darwin' ? `open "${fp}"` : `xdg-open "${fp}"`;
  exec(cmd, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// ファイルを表示（ファイルマネージャーで場所を開く）
app.post('/api/reveal', (req, res) => {
  const { path: fp } = req.body;
  if (!fp) return res.status(400).json({ error: 'path required' });
  const target = fs.existsSync(fp) ? fp : path.dirname(fp);
  const cmd = process.platform === 'darwin'
    ? `open -R "${target}"`
    : `xdg-open "${path.dirname(target)}"`;
  exec(cmd, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// インデックス
app.post('/api/index', async (req, res) => {
  const result = await indexer.fullIndex(req.body.paths);
  res.json(result);
});

app.get('/api/index/status', (req, res) => {
  res.json(indexer.getState());
});

// ハッシュ計算（重複検出用）
app.post('/api/compute-hashes', async (req, res) => {
  const result = await indexer.computeHashes();
  res.json(result);
});

// よく使う場所
app.get('/api/places', (req, res) => {
  const home = os.homedir();
  const places = [
    { name: 'ホーム', icon: '🏠', path: home },
    { name: 'デスクトップ', icon: '🖥️', path: path.join(home, 'Desktop') },
    { name: 'ダウンロード', icon: '📥', path: path.join(home, 'Downloads') },
    { name: 'ドキュメント', icon: '📄', path: path.join(home, 'Documents') },
    { name: '画像', icon: '🖼️', path: path.join(home, 'Pictures') },
    { name: '音楽', icon: '🎵', path: path.join(home, 'Music') },
    { name: '動画', icon: '🎬', path: path.join(home, 'Movies') || path.join(home, 'Videos') },
  ].filter(p => fs.existsSync(p.path));
  res.json(places);
});

// SPA フォールバック
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === サーバー起動 ===
const server = app.listen(PORT, async () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║                                      ║');
  console.log('  ║   📂 ファインダー 起動しました！      ║');
  console.log(`  ║   🌐 http://localhost:${PORT}            ║`);
  console.log('  ║                                      ║');
  console.log('  ║   ブラウザで開いてください             ║');
  console.log('  ║   Ctrl+C で終了                       ║');
  console.log('  ║                                      ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  // 自動ブラウザオープン
  const url = `http://localhost:${PORT}`;
  if (process.platform === 'darwin') exec(`open "${url}"`);
  else if (process.platform === 'linux') exec(`xdg-open "${url}" 2>/dev/null`);

  // ファイルインデックス開始
  const count = fileOps.totalCount();
  if (count === 0) {
    console.log('  📊 初回インデックスを作成中...');
    const result = await indexer.fullIndex();
    if (result.success) {
      console.log(`  ✅ ${result.count.toLocaleString()} ファイルをインデックスしました`);
      // バックグラウンドでハッシュ計算
      indexer.computeHashes().then(r => {
        if (r.computed > 0) console.log(`  🔗 ${r.computed} ファイルのハッシュを計算しました`);
      });
    }
  } else {
    console.log(`  📊 ${count.toLocaleString()} ファイルがインデックス済み`);
    // バックグラウンドで更新
    indexer.fullIndex().then(() => indexer.computeHashes());
  }

  // リアルタイム監視開始
  indexer.startWatching();
});

// グレースフルシャットダウン
process.on('SIGINT', () => {
  console.log('\n  👋 終了します...');
  indexer.stopWatching();
  closeDb();
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  indexer.stopWatching();
  closeDb();
  server.close(() => process.exit(0));
});
