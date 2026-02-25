const { app, BrowserWindow, ipcMain, shell, dialog, nativeImage, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const os = require('os');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const { FileKVS } = require('../lib/kvs');
const indexer = require('../lib/indexer');

let mainWindow;
let kvs;

// メディア再生用カスタムプロトコル（app.ready前に登録が必要）
protocol.registerSchemesAsPrivileged([
  { scheme: 'finder-media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 750,
    minWidth: 800, minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#FBF9F6',
    show: false
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  // finder-media:// プロトコル → ローカルファイルをストリーミング配信
  protocol.handle('finder-media', (request) => {
    const filePath = decodeURIComponent(request.url.slice('finder-media://'.length));
    return net.fetch(pathToFileURL(filePath).href);
  });

  const dataDir = app.getPath('userData');
  kvs = new FileKVS(path.join(dataDir, 'index.json'));
  indexer.init(kvs);

  createWindow();

  indexer.onEvent((event, data) => {
    mainWindow?.webContents.send('finder:event', { event, ...data });
  });

  if (kvs.size === 0) {
    console.log('📊 初回インデックス作成中...');
    const result = await indexer.fullIndex();
    if (result.success) {
      console.log(`✅ ${result.count.toLocaleString()} ファイル`);
      mainWindow?.webContents.send('finder:indexDone', result);
      indexer.computeHashes();
    }
  } else {
    console.log(`📊 ${kvs.size.toLocaleString()} ファイルがインデックス済み`);
    indexer.fullIndex().then(() => indexer.computeHashes());
  }

  indexer.startWatching();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  indexer.stopWatching();
  kvs?.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  indexer.stopWatching();
  kvs?.close();
});

// === IPC: クエリ ===
const catInfo = indexer.getCategoryInfo();

ipcMain.handle('finder:search', (_, q, limit) => kvs.search(q, limit || 50));

ipcMain.handle('finder:getStats', () => {
  const stats = kvs.stats();
  const categories = kvs.categoryStats().map(c => ({
    ...c,
    label: catInfo[c.category]?.label || 'その他',
    icon: catInfo[c.category]?.icon || '📁'
  }));
  return { ...stats, categories, indexState: indexer.getState() };
});

ipcMain.handle('finder:getRecent', (_, limit) => kvs.recent(limit || 30));
ipcMain.handle('finder:getCategory', (_, name, limit) => kvs.byCategory(name, limit || 100));

ipcMain.handle('finder:browse', (_, dirPath) => {
  const dir = dirPath || os.homedir();
  const files = kvs.browse(dir);
  let subdirs = [];
  try {
    subdirs = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {}
  return { dir, files, subdirs, parent: path.dirname(dir) };
});

ipcMain.handle('finder:getPlaces', () => {
  const home = os.homedir();
  return [
    { name: 'ホーム', icon: '🏠', path: home },
    { name: 'デスクトップ', icon: '🖥️', path: path.join(home, 'Desktop') },
    { name: 'ダウンロード', icon: '📥', path: path.join(home, 'Downloads') },
    { name: 'ドキュメント', icon: '📄', path: path.join(home, 'Documents') },
    { name: '画像', icon: '🖼️', path: path.join(home, 'Pictures') },
    { name: '音楽', icon: '🎵', path: path.join(home, 'Music') },
    { name: '動画', icon: '🎬', path: path.join(home, process.platform === 'darwin' ? 'Movies' : 'Videos') },
  ].filter(p => fs.existsSync(p.path));
});

ipcMain.handle('finder:getDuplicates', () => {
  indexer.computeHashes();
  return kvs.duplicates();
});

ipcMain.handle('finder:getLargeFiles', (_, limit) => kvs.largeFiles(limit || 50));

// テキスト系拡張子
const TEXT_EXTS = new Set([
  '.txt','.md','.csv','.tsv','.log','.rtf','.tex',
  '.js','.ts','.jsx','.tsx','.py','.rb','.go','.rs','.java','.c','.cpp','.h',
  '.cs','.php','.swift','.kt','.html','.css','.scss','.sql','.yaml','.yml',
  '.json','.xml','.sh','.bash','.vue','.svelte','.dart','.lua','.toml','.ini','.cfg'
]);

// macOS textutil で文書からテキスト抽出（DOC, DOCX, RTF, ODT, HTML等対応）
const DOC_EXTS = new Set(['.doc','.docx','.odt','.rtf','.pages']);
const SPREADSHEET_EXTS = new Set(['.xls','.xlsx','.ods','.numbers','.csv','.tsv']);
const SLIDE_EXTS = new Set(['.ppt','.pptx','.odp','.key']);

function extractDocText(fp, ext) {
  // macOSの textutil で文書をプレーンテキストに変換
  try {
    const { execSync } = require('child_process');
    const raw = execSync(`textutil -convert txt -stdout "${fp}" 2>/dev/null`, {
      timeout: 3000, maxBuffer: 10240, encoding: 'utf8'
    });
    return raw.slice(0, 300);
  } catch { return null; }
}

function extractPdfText(fp) {
  // macOS内蔵の mdimport or python でPDFテキスト抽出
  try {
    const { execSync } = require('child_process');
    // mdimportでメタデータからテキスト取得
    const raw = execSync(
      `mdimport -d2 "${fp}" 2>&1 | head -20`,
      { timeout: 3000, maxBuffer: 10240, encoding: 'utf8' }
    );
    // kMDItemTextContentからテキスト部分を抽出
    const match = raw.match(/kMDItemTextContent\s*=\s*"([^"]+)"/);
    if (match) return match[1].slice(0, 300);
    // Spotlight キャッシュからテキスト取得
    const raw2 = execSync(
      `mdls -name kMDItemTextContent "${fp}" 2>/dev/null`,
      { timeout: 3000, maxBuffer: 10240, encoding: 'utf8' }
    );
    const match2 = raw2.match(/=\s*"([^"]+)"/);
    if (match2) return match2[1].slice(0, 300);
    return null;
  } catch { return null; }
}

// テキストプレビュー付きSVGを生成（中身だけ大きく表示）
function contentPreviewSvg(textContent, color) {
  let lines = [];
  if (textContent) {
    lines = textContent.split('\n').filter(l => l.trim()).slice(0, 5).map(l => {
      return l.trim().slice(0, 16).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });
  }
  if (lines.length === 0) lines = ['(内容なし)'];

  const textLines = lines.map((l, i) =>
    `<text x="8" y="${28 + i * 26}" fill="#222" font-size="15" font-family="'Hiragino Sans','Helvetica Neue',sans-serif">${l || ' '}</text>`
  ).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">
    <rect x="2" y="2" width="116" height="156" rx="8" fill="white" stroke="${color}" stroke-width="2"/>
    ${textLines}
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// サムネイル生成（全ファイル対応）
ipcMain.handle('finder:getThumbnail', async (_, fp, size) => {
  try {
    if (!fs.existsSync(fp)) return null;
    const ext = path.extname(fp).toLowerCase();
    const file = kvs.get(fp);
    const category = file?.category || 'other';
    const colors = {
      document: '#3B82F6', code: '#10B981', data: '#EF4444', other: '#6B7280'
    };
    const color = colors[category] || colors.other;

    // 1. まずOS標準のサムネイル（画像・PDF・動画等に効く）
    try {
      const thumb = await nativeImage.createThumbnailFromPath(fp, { width: size || 120, height: size || 120 });
      if (!thumb.isEmpty()) return thumb.toDataURL();
    } catch {}

    // 2. 画像はnativeImageで直接読み込み
    const imgExts = ['.jpg','.jpeg','.png','.gif','.bmp','.webp','.ico','.tiff','.tif'];
    if (imgExts.includes(ext)) {
      try {
        const img = nativeImage.createFromPath(fp);
        if (!img.isEmpty()) {
          const resized = img.resize({ width: size || 120, quality: 'good' });
          return resized.toDataURL();
        }
      } catch {}
    }

    // 3. PDF → テキスト抽出してSVG
    if (ext === '.pdf') {
      const text = extractPdfText(fp);
      if (text) return contentPreviewSvg(text, '#DC2626');
    }

    // 4. 文書ファイル → textutil でテキスト抽出
    if (DOC_EXTS.has(ext)) {
      const text = extractDocText(fp, ext);
      if (text) return contentPreviewSvg(text, '#3B82F6');
    }

    // 5. スプレッドシート → textutil
    if (SPREADSHEET_EXTS.has(ext)) {
      const text = extractDocText(fp, ext);
      if (text) return contentPreviewSvg(text, '#059669');
    }

    // 6. スライド → textutil
    if (SLIDE_EXTS.has(ext)) {
      const text = extractDocText(fp, ext);
      if (text) return contentPreviewSvg(text, '#D97706');
    }

    // 7. テキスト系は直接読み込み
    if (TEXT_EXTS.has(ext)) {
      try {
        const raw = fs.readFileSync(fp, 'utf8').slice(0, 300);
        return contentPreviewSvg(raw, color);
      } catch {}
    }

    return null;
  } catch { return null; }
});
ipcMain.handle('finder:getFavorites', () => kvs.getFavorites());
ipcMain.handle('finder:addFavorite', (_, fp) => { kvs.addFavorite(fp); return true; });
ipcMain.handle('finder:removeFavorite', (_, fp) => { kvs.removeFavorite(fp); return true; });

ipcMain.handle('finder:getFileDetail', (_, fp) => {
  const file = kvs.get(fp);
  if (!file) return null;
  return { ...file, isFavorite: kvs.isFavorite(fp) };
});

// === IPC: ファイル操作 ===
ipcMain.handle('finder:openFile', (_, fp) => shell.openPath(fp));
ipcMain.handle('finder:revealFile', (_, fp) => shell.showItemInFolder(fp));

ipcMain.handle('finder:copyFile', (_, src, dest) => {
  try {
    const destPath = path.join(dest, path.basename(src));
    fs.copyFileSync(src, destPath);
    return { success: true, path: destPath };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('finder:moveFile', (_, src, dest) => {
  try {
    const destPath = path.join(dest, path.basename(src));
    fs.renameSync(src, destPath);
    kvs.delete(src);
    return { success: true, path: destPath };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('finder:deleteFile', async (_, fp) => {
  try {
    await shell.trashItem(fp);
    kvs.delete(fp);
    return { success: true };
  } catch (e) { return { error: e.message }; }
});

// === rsync 同期 ===
ipcMain.handle('finder:syncFiles', (_, src, dest) => {
  return new Promise((resolve) => {
    const isLinux = process.platform === 'linux';
    const isMac = process.platform === 'darwin';

    if (!isLinux && !isMac) {
      // Windows: xcopy fallback
      const cmd = `xcopy "${src}" "${dest}" /E /Y /I`;
      exec(cmd, (err) => resolve(err ? { error: err.message } : { success: true }));
      return;
    }

    // rsync があれば rsync、なければ cp -r
    try {
      execSync('which rsync', { stdio: 'ignore' });
      const srcTrail = src.endsWith('/') ? src : src + '/';
      exec(`rsync -av --progress "${srcTrail}" "${dest}/"`, (err, stdout) => {
        resolve(err ? { error: err.message } : { success: true, output: stdout });
      });
    } catch {
      exec(`cp -r "${src}/." "${dest}/"`, (err) => {
        resolve(err ? { error: err.message } : { success: true });
      });
    }
  });
});

ipcMain.handle('finder:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'フォルダを選択'
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('finder:getDroppedFiles', (_, paths) => {
  return paths.map(fp => {
    try {
      const stat = fs.statSync(fp);
      return {
        path: fp,
        name: path.basename(fp),
        size: stat.size,
        isDirectory: stat.isDirectory(),
        ext: path.extname(fp).toLowerCase()
      };
    } catch { return null; }
  }).filter(Boolean);
});

ipcMain.handle('finder:readFileContent', async (_, fp, maxBytes) => {
  try {
    if (!fs.existsSync(fp)) return null;
    const buf = Buffer.alloc(maxBytes || 8000);
    const fd = fs.openSync(fp, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.slice(0, bytesRead).toString('utf8');
  } catch { return null; }
});

ipcMain.handle('finder:reindex', async () => {
  return await indexer.fullIndex();
});

// === 圧縮ファイル解凍 ===
const ARCHIVE_EXTS = new Set(['.zip','.tar','.gz','.tgz','.bz2','.xz','.7z','.rar']);

ipcMain.handle('finder:extractArchive', async (_, fp) => {
  try {
    if (!fs.existsSync(fp)) return { error: 'ファイルが見つかりません' };
    const ext = path.extname(fp).toLowerCase();
    const baseName = path.basename(fp, ext);
    // .tar.gz 等の二重拡張子対応
    const realBase = baseName.endsWith('.tar') ? path.basename(baseName, '.tar') : baseName;
    const destDir = path.join(path.dirname(fp), realBase);

    // 解凍先フォルダ作成
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';

    let cmd;
    if (ext === '.zip') {
      if (isMac) {
        // macOS: ditto で解凍（日本語ファイル名に強い）
        cmd = `ditto -x -k "${fp}" "${destDir}"`;
      } else {
        cmd = `unzip -o "${fp}" -d "${destDir}"`;
      }
    } else if (ext === '.tar') {
      cmd = `tar xf "${fp}" -C "${destDir}"`;
    } else if (ext === '.gz' || ext === '.tgz') {
      cmd = `tar xzf "${fp}" -C "${destDir}"`;
    } else if (ext === '.bz2') {
      cmd = `tar xjf "${fp}" -C "${destDir}"`;
    } else if (ext === '.xz') {
      cmd = `tar xJf "${fp}" -C "${destDir}"`;
    } else if (ext === '.7z') {
      cmd = `7z x "${fp}" -o"${destDir}" -y`;
    } else if (ext === '.rar') {
      cmd = `unrar x "${fp}" "${destDir}/" -y`;
    } else {
      return { error: 'この形式の解凍には対応していません' };
    }

    return new Promise((resolve) => {
      exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ error: `解凍に失敗しました: ${err.message}` });
        } else {
          resolve({ success: true, destDir, message: `${realBase} に解凍しました` });
        }
      });
    });
  } catch (e) {
    return { error: e.message };
  }
});
