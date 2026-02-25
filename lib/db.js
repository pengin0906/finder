'use strict';
// ============================================================
// db.js - データベースサービス
// sfa の pg-service.js パターン: JSONB的柔軟ストレージ + 高速検索
// SQLite + FTS5 で即座に使える（PostgreSQL不要）
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'finder.db');

let db;

function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);

  // パフォーマンス最適化（sfa同様のプロダクション設定）
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('foreign_keys = ON');

  initSchema();
  return db;
}

function initSchema() {
  db.exec(`
    -- メインファイルテーブル（sfaのJSONBパターン: 構造化カラム + JSON柔軟フィールド）
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      ext TEXT DEFAULT '',
      dir TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      category TEXT DEFAULT 'other',
      mime_type TEXT DEFAULT '',
      created_at TEXT,
      modified_at TEXT,
      accessed_at TEXT,
      indexed_at TEXT DEFAULT (datetime('now','localtime')),
      hash TEXT,
      metadata TEXT DEFAULT '{}',
      is_hidden INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0
    );

    -- インデックス（sfaのpg-service同様、頻出クエリを高速化）
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
    CREATE INDEX IF NOT EXISTS idx_files_dir ON files(dir);
    CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
    CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
    CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
    CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(is_deleted);

    -- FTS5 全文検索（ファイル名とパスで即座に検索）
    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      name, dir, ext,
      content='files',
      content_rowid='id',
      tokenize='unicode61'
    );

    -- FTS自動同期トリガー
    CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, name, dir, ext)
      VALUES (new.id, new.name, new.dir, new.ext);
    END;

    CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, name, dir, ext)
      VALUES ('delete', old.id, old.name, old.dir, old.ext);
    END;

    CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, name, dir, ext)
      VALUES ('delete', old.id, old.name, old.dir, old.ext);
      INSERT INTO files_fts(rowid, name, dir, ext)
      VALUES (new.id, new.name, new.dir, new.ext);
    END;

    -- ファイルイベント履歴（いつ何が起きたか追跡）
    CREATE TABLE IF NOT EXISTS file_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      event_type TEXT NOT NULL,
      old_path TEXT,
      detail TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_time ON file_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type ON file_events(event_type);

    -- お気に入り
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      added_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- タグ
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#F59E0B'
    );

    -- ファイル-タグ関連
    CREATE TABLE IF NOT EXISTS file_tags (
      file_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (file_id, tag_id),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    -- 設定
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// === ファイル操作 ===

const stmtCache = {};
function stmt(sql) {
  if (!stmtCache[sql]) stmtCache[sql] = getDb().prepare(sql);
  return stmtCache[sql];
}

const fileOps = {
  upsert(file) {
    return stmt(`
      INSERT INTO files (path, name, ext, dir, size, category, mime_type, created_at, modified_at, accessed_at, is_hidden, metadata, indexed_at)
      VALUES (@path, @name, @ext, @dir, @size, @category, @mime_type, @created_at, @modified_at, @accessed_at, @is_hidden, @metadata, datetime('now','localtime'))
      ON CONFLICT(path) DO UPDATE SET
        name=@name, ext=@ext, dir=@dir, size=@size, category=@category,
        mime_type=@mime_type, modified_at=@modified_at, accessed_at=@accessed_at,
        is_hidden=@is_hidden, metadata=@metadata, is_deleted=0,
        indexed_at=datetime('now','localtime')
    `).run(file);
  },

  upsertMany(files) {
    const insert = getDb().transaction((items) => {
      for (const f of items) fileOps.upsert(f);
    });
    insert(files);
  },

  markDeleted(filePath) {
    stmt(`UPDATE files SET is_deleted=1 WHERE path=?`).run(filePath);
  },

  search(query, limit = 50, offset = 0) {
    if (!query || !query.trim()) return [];
    // FTS5検索 - 部分一致にワイルドカード追加
    const ftsQuery = query.trim().split(/\s+/).map(w => `"${w}"*`).join(' ');
    try {
      return stmt(`
        SELECT f.*, rank
        FROM files_fts fts
        JOIN files f ON f.id = fts.rowid
        WHERE files_fts MATCH ? AND f.is_deleted=0
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(ftsQuery, limit, offset);
    } catch {
      // FTS構文エラー時はLIKEフォールバック
      const like = `%${query.trim()}%`;
      return stmt(`
        SELECT * FROM files WHERE is_deleted=0 AND (name LIKE ? OR path LIKE ?)
        ORDER BY modified_at DESC LIMIT ? OFFSET ?
      `).all(like, like, limit, offset);
    }
  },

  recent(limit = 30) {
    return stmt(`
      SELECT * FROM files WHERE is_deleted=0
      ORDER BY modified_at DESC LIMIT ?
    `).all(limit);
  },

  byCategory(category, limit = 100, offset = 0, sort = 'modified_at', order = 'DESC') {
    const validSorts = ['name', 'size', 'modified_at', 'created_at'];
    const validOrders = ['ASC', 'DESC'];
    sort = validSorts.includes(sort) ? sort : 'modified_at';
    order = validOrders.includes(order) ? order : 'DESC';
    return getDb().prepare(`
      SELECT * FROM files WHERE is_deleted=0 AND category=?
      ORDER BY ${sort} ${order} LIMIT ? OFFSET ?
    `).all(category, limit, offset);
  },

  categoryStats() {
    return stmt(`
      SELECT category, COUNT(*) as count, COALESCE(SUM(size),0) as total_size
      FROM files WHERE is_deleted=0
      GROUP BY category ORDER BY count DESC
    `).all();
  },

  stats() {
    return stmt(`
      SELECT
        COUNT(*) as total_files,
        COALESCE(SUM(size),0) as total_size,
        COUNT(DISTINCT dir) as total_dirs,
        COUNT(DISTINCT category) as total_categories
      FROM files WHERE is_deleted=0
    `).get();
  },

  duplicates(limit = 50) {
    return stmt(`
      SELECT hash, GROUP_CONCAT(path, '|||') as paths, COUNT(*) as cnt, size, name
      FROM files WHERE is_deleted=0 AND hash IS NOT NULL AND hash != ''
      GROUP BY hash HAVING cnt > 1
      ORDER BY size DESC LIMIT ?
    `).all(limit);
  },

  largeFiles(limit = 50) {
    return stmt(`
      SELECT * FROM files WHERE is_deleted=0
      ORDER BY size DESC LIMIT ?
    `).all(limit);
  },

  browse(dirPath, sort = 'name', order = 'ASC') {
    const validSorts = ['name', 'size', 'modified_at', 'category'];
    const validOrders = ['ASC', 'DESC'];
    sort = validSorts.includes(sort) ? sort : 'name';
    order = validOrders.includes(order) ? order : 'ASC';
    return getDb().prepare(`
      SELECT * FROM files WHERE is_deleted=0 AND dir=?
      ORDER BY ${sort} ${order}
    `).all(dirPath);
  },

  getById(id) {
    return stmt(`SELECT * FROM files WHERE id=?`).get(id);
  },

  getByPath(filePath) {
    return stmt(`SELECT * FROM files WHERE path=?`).get(filePath);
  },

  subdirs(dirPath) {
    return stmt(`
      SELECT DISTINCT dir FROM files
      WHERE is_deleted=0 AND dir LIKE ? AND dir != ?
      AND dir NOT LIKE ?
    `).all(dirPath + '/%', dirPath, dirPath + '/%/%');
  },

  recentEvents(limit = 50) {
    return stmt(`SELECT * FROM file_events ORDER BY timestamp DESC LIMIT ?`).all(limit);
  },

  addEvent(filePath, eventType, oldPath = null, detail = '') {
    stmt(`INSERT INTO file_events (file_path, event_type, old_path, detail) VALUES (?,?,?,?)`)
      .run(filePath, eventType, oldPath, detail);
  },

  totalCount() {
    return stmt(`SELECT COUNT(*) as count FROM files WHERE is_deleted=0`).get().count;
  },

  clearAll() {
    getDb().exec(`DELETE FROM files; DELETE FROM files_fts; DELETE FROM file_events;`);
  }
};

// === お気に入り ===
const favOps = {
  list() {
    return stmt(`
      SELECT f.*, fav.added_at as favorited_at
      FROM favorites fav JOIN files f ON f.path = fav.file_path
      WHERE f.is_deleted=0 ORDER BY fav.added_at DESC
    `).all();
  },
  add(filePath) {
    return stmt(`INSERT OR IGNORE INTO favorites (file_path) VALUES (?)`).run(filePath);
  },
  remove(filePath) {
    return stmt(`DELETE FROM favorites WHERE file_path=?`).run(filePath);
  },
  isFav(filePath) {
    return !!stmt(`SELECT 1 FROM favorites WHERE file_path=?`).get(filePath);
  }
};

// === タグ ===
const tagOps = {
  list() { return stmt(`SELECT * FROM tags ORDER BY name`).all(); },
  create(name, color = '#F59E0B') {
    return stmt(`INSERT OR IGNORE INTO tags (name, color) VALUES (?,?)`).run(name, color);
  },
  delete(id) { return stmt(`DELETE FROM tags WHERE id=?`).run(id); },
  addToFile(fileId, tagId) {
    return stmt(`INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?,?)`).run(fileId, tagId);
  },
  removeFromFile(fileId, tagId) {
    return stmt(`DELETE FROM file_tags WHERE file_id=? AND tag_id=?`).run(fileId, tagId);
  },
  getFileTags(fileId) {
    return stmt(`
      SELECT t.* FROM tags t JOIN file_tags ft ON t.id=ft.tag_id WHERE ft.file_id=?
    `).all(fileId);
  }
};

// === 設定 ===
const settingOps = {
  get(key, defaultValue = null) {
    const row = stmt(`SELECT value FROM settings WHERE key=?`).get(key);
    return row ? JSON.parse(row.value) : defaultValue;
  },
  set(key, value) {
    stmt(`INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)`).run(key, JSON.stringify(value));
  }
};

function close() {
  if (db) { db.close(); db = null; }
  Object.keys(stmtCache).forEach(k => delete stmtCache[k]);
}

module.exports = { getDb, fileOps, favOps, tagOps, settingOps, close };
