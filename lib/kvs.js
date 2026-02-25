'use strict';
// ============================================================
// kvs.js - Pure JavaScript Key-Value Store
// sfaのJSONBパターンを純粋なKVSで再実装
// ネイティブモジュール完全不要。超軽量。
// ============================================================
const fs = require('fs');
const path = require('path');

class FileKVS {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.store = new Map();
    this.favorites = new Set();
    this.searchIndex = new Map();
    this.dirty = false;

    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    this.load();
    this._saveInterval = setInterval(() => this.save(), 30000);
  }

  // === 永続化 ===
  load() {
    try {
      const raw = fs.readFileSync(this.dataPath, 'utf8');
      const data = JSON.parse(raw);
      if (data.files) {
        for (const f of data.files) {
          this.store.set(f.path, f);
          this._index(f);
        }
      }
      if (data.favorites) {
        for (const fp of data.favorites) this.favorites.add(fp);
      }
    } catch { /* 初回起動 */ }
  }

  save() {
    if (!this.dirty) return;
    try {
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        files: [...this.store.values()],
        favorites: [...this.favorites]
      };
      const tmp = this.dataPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.dataPath);
      this.dirty = false;
    } catch (e) {
      console.error('KVS保存エラー:', e.message);
    }
  }

  close() {
    clearInterval(this._saveInterval);
    this.save();
  }

  // === 検索インデックス ===
  _tokenize(text) {
    return text.toLowerCase()
      .split(/[\s._\-\/\\()[\]{},;:!?@#$%^&*+=<>~`'"]+/)
      .filter(t => t.length > 0);
  }

  _index(file) {
    const tokens = this._tokenize(file.name);
    for (const t of tokens) {
      if (!this.searchIndex.has(t)) this.searchIndex.set(t, new Set());
      this.searchIndex.get(t).add(file.path);
    }
  }

  _deindex(file) {
    const tokens = this._tokenize(file.name);
    for (const t of tokens) {
      const set = this.searchIndex.get(t);
      if (set) { set.delete(file.path); if (set.size === 0) this.searchIndex.delete(t); }
    }
  }

  // === CRUD ===
  put(file) {
    const existing = this.store.get(file.path);
    if (existing) this._deindex(existing);
    this.store.set(file.path, file);
    this._index(file);
    this.dirty = true;
  }

  putMany(files) {
    for (const f of files) {
      const existing = this.store.get(f.path);
      if (existing) this._deindex(existing);
      this.store.set(f.path, f);
      this._index(f);
    }
    this.dirty = true;
  }

  get(key) { return this.store.get(key) || null; }
  delete(key) {
    const existing = this.store.get(key);
    if (existing) this._deindex(existing);
    this.store.delete(key);
    this.dirty = true;
  }
  has(key) { return this.store.has(key); }
  get size() { return this.store.size; }

  // === 検索クエリ ===
  search(query, limit = 50) {
    if (!query || !query.trim()) return [];
    const tokens = this._tokenize(query);
    if (tokens.length === 0) return [];

    const scores = new Map();
    for (const token of tokens) {
      for (const [indexToken, paths] of this.searchIndex) {
        let score = 0;
        if (indexToken === token) score = 3;
        else if (indexToken.startsWith(token)) score = 2;
        else if (indexToken.includes(token)) score = 1;
        if (score > 0) {
          for (const p of paths) scores.set(p, (scores.get(p) || 0) + score);
        }
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([p]) => this.store.get(p))
      .filter(Boolean);
  }

  recent(limit = 30) {
    return [...this.store.values()]
      .sort((a, b) => (b.modified_at || '').localeCompare(a.modified_at || ''))
      .slice(0, limit);
  }

  byCategory(category, limit = 100) {
    const results = [];
    for (const f of this.store.values()) {
      if (f.category === category) results.push(f);
    }
    return results
      .sort((a, b) => (b.modified_at || '').localeCompare(a.modified_at || ''))
      .slice(0, limit);
  }

  largeFiles(limit = 50) {
    return [...this.store.values()]
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, limit);
  }

  categoryStats() {
    const cats = {};
    for (const f of this.store.values()) {
      const c = f.category || 'other';
      if (!cats[c]) cats[c] = { count: 0, total_size: 0 };
      cats[c].count++;
      cats[c].total_size += f.size || 0;
    }
    return Object.entries(cats)
      .map(([category, d]) => ({ category, ...d }))
      .sort((a, b) => b.count - a.count);
  }

  stats() {
    let totalSize = 0;
    const dirs = new Set();
    for (const f of this.store.values()) {
      totalSize += f.size || 0;
      dirs.add(f.dir);
    }
    return { total_files: this.store.size, total_size: totalSize, total_dirs: dirs.size };
  }

  duplicates(limit = 50) {
    const hashMap = {};
    for (const f of this.store.values()) {
      if (f.hash) {
        if (!hashMap[f.hash]) hashMap[f.hash] = [];
        hashMap[f.hash].push(f);
      }
    }
    return Object.values(hashMap)
      .filter(files => files.length > 1)
      .map(files => ({ count: files.length, size: files[0].size, files }))
      .sort((a, b) => b.size * b.count - a.size * a.count)
      .slice(0, limit);
  }

  browse(dirPath) {
    const results = [];
    for (const f of this.store.values()) {
      if (f.dir === dirPath) results.push(f);
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  // === お気に入り ===
  addFavorite(fp) { this.favorites.add(fp); this.dirty = true; }
  removeFavorite(fp) { this.favorites.delete(fp); this.dirty = true; }
  isFavorite(fp) { return this.favorites.has(fp); }
  getFavorites() {
    return [...this.favorites].map(fp => this.store.get(fp)).filter(Boolean);
  }

  clear() {
    this.store.clear();
    this.searchIndex.clear();
    this.dirty = true;
  }
}

module.exports = { FileKVS };
