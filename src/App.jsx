import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { createApp, reactive, h } from 'vue';
import CategoryCards from './vue/CategoryCards.vue';

const api = window.finder;

// === ユーティリティ ===
function formatSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(' ', 'T'));
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return Math.floor(diff / 60) + '分前';
  if (diff < 86400) return Math.floor(diff / 3600) + '時間前';
  if (diff < 172800) return '昨日';
  if (diff < 604800) return Math.floor(diff / 86400) + '日前';
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}

const EMOJI = {
  '.pdf':'📕','.doc':'📘','.docx':'📘','.xls':'📊','.xlsx':'📊','.ppt':'📙','.pptx':'📙',
  '.txt':'📝','.md':'📝','.csv':'📊','.jpg':'🖼️','.jpeg':'🖼️','.png':'🖼️','.gif':'🎞️',
  '.svg':'🎨','.webp':'🖼️','.heic':'📷','.psd':'🎨','.mp4':'🎬','.mov':'🎬','.avi':'📹',
  '.mkv':'🎬','.mp3':'🎵','.wav':'🎶','.flac':'🎵','.m4a':'🎵','.js':'⚡','.ts':'💎',
  '.py':'🐍','.go':'🔵','.java':'☕','.c':'⚙️','.cpp':'⚙️','.rs':'🦀','.html':'🌐',
  '.css':'🎨','.json':'📋','.yaml':'📋','.sh':'🖥️','.sql':'🗄️','.zip':'📦','.tar':'📦',
  '.gz':'📦','.7z':'📦','.rar':'📦','.dmg':'💿','.iso':'💿','.ttf':'🔤','.db':'🗃️',
  '.epub':'📚','.vue':'💚','.jsx':'⚛️','.tsx':'⚛️',
};
const CAT_EMOJI = { document:'📄', image:'🖼️', video:'🎬', audio:'🎵', code:'💻', archive:'📦', font:'🔤', data:'🗃️', other:'📁' };

function fileEmoji(ext, cat) { return EMOJI[(ext||'').toLowerCase()] || CAT_EMOJI[cat] || '📁'; }
function shortenPath(p, max = 45) {
  if (!p) return '';
  const h = p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  return h.length <= max ? h : h.slice(0, 15) + '...' + h.slice(-(max - 18));
}

// === Vue ブリッジ（ReactからVueコンポーネントを使う）===
const VueBridge = memo(function VueBridge({ component, props: vueProps, onSelect }) {
  const el = useRef(null);
  const stateRef = useRef(null);
  const appRef = useRef(null);
  const callbackRef = useRef(onSelect);
  callbackRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    stateRef.current = reactive({ ...vueProps, onSelect: (v) => callbackRef.current?.(v) });
    appRef.current = createApp({
      setup: () => () => h(component, stateRef.current)
    });
    appRef.current.mount(el.current);
    return () => { appRef.current?.unmount(); };
  }, []);

  useEffect(() => {
    if (stateRef.current && vueProps) {
      Object.assign(stateRef.current, vueProps);
    }
  }, [vueProps]);

  return <div ref={el} />;
});

// === メディア即再生対応拡張子 ===
const VIDEO_PLAY_EXTS = new Set(['.mp4','.webm','.ogg','.mov','.m4v']);
const AUDIO_PLAY_EXTS = new Set(['.mp3','.wav','.ogg','.m4a','.flac','.aac','.weba','.opus']);
const IMAGE_VIEW_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.webp','.ico','.tiff','.tif','.avif','.svg']);

function isPlayableVideo(file) {
  return file.category === 'video' && VIDEO_PLAY_EXTS.has((file.ext || '').toLowerCase());
}
function isPlayableAudio(file) {
  return file.category === 'audio' && AUDIO_PLAY_EXTS.has((file.ext || '').toLowerCase());
}
function isViewableImage(file) {
  return file.category === 'image' && IMAGE_VIEW_EXTS.has((file.ext || '').toLowerCase());
}

// === サムネイル ===
const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.webp','.ico','.tiff','.tif','.avif']);
function isImageFile(file) {
  return file.category === 'image' && IMAGE_EXTS.has((file.ext || '').toLowerCase());
}

// サムネイルキャッシュ（data URL）
const thumbCache = new Map();
async function loadThumb(filePath) {
  if (thumbCache.has(filePath)) return thumbCache.get(filePath);
  const dataUrl = await api.getThumbnail(filePath, 120);
  if (dataUrl) thumbCache.set(filePath, dataUrl);
  return dataUrl;
}

// サムネイルを非同期ロードするReactフック（全ファイル対応）
function useThumb(file) {
  const [src, setSrc] = useState(() => thumbCache.get(file.path) || null);
  useEffect(() => {
    if (thumbCache.has(file.path)) { setSrc(thumbCache.get(file.path)); return; }
    loadThumb(file.path).then(url => { if (url) setSrc(url); });
  }, [file.path]);
  return src;
}

// カテゴリ別カラー（ファイルアイコン用）
const CAT_COLORS = {
  document: { bg: '#3B82F6', fg: '#DBEAFE', dark: '#1E40AF' },
  image:    { bg: '#EC4899', fg: '#FCE7F3', dark: '#BE185D' },
  video:    { bg: '#8B5CF6', fg: '#EDE9FE', dark: '#6D28D9' },
  audio:    { bg: '#06B6D4', fg: '#CFFAFE', dark: '#0E7490' },
  code:     { bg: '#10B981', fg: '#D1FAE5', dark: '#047857' },
  archive:  { bg: '#F59E0B', fg: '#FEF3C7', dark: '#B45309' },
  font:     { bg: '#6366F1', fg: '#E0E7FF', dark: '#4338CA' },
  data:     { bg: '#EF4444', fg: '#FEE2E2', dark: '#B91C1C' },
  other:    { bg: '#6B7280', fg: '#F3F4F6', dark: '#374151' },
};

// === ファイルアイコン（アプリ風の大きなバッジ） ===
// 色ベタ塗り角丸 + ドカンと白文字 = 一発でわかる
const BADGE_ICONS = {
  '.pdf':  { bg:'#DC2626', dark:'#991B1B', letter:'PDF' },
  '.doc':  { bg:'#2563EB', dark:'#1E40AF', letter:'W' },
  '.docx': { bg:'#2563EB', dark:'#1E40AF', letter:'W' },
  '.xls':  { bg:'#16A34A', dark:'#166534', letter:'X' },
  '.xlsx': { bg:'#16A34A', dark:'#166534', letter:'X' },
  '.csv':  { bg:'#16A34A', dark:'#166534', letter:'CSV' },
  '.ppt':  { bg:'#EA580C', dark:'#9A3412', letter:'P' },
  '.pptx': { bg:'#EA580C', dark:'#9A3412', letter:'P' },
  '.txt':  { bg:'#6B7280', dark:'#374151', letter:'TXT' },
  '.md':   { bg:'#6B7280', dark:'#374151', letter:'MD' },
  '.epub': { bg:'#7C3AED', dark:'#5B21B6', letter:'EPUB' },
  '.rtf':  { bg:'#2563EB', dark:'#1E40AF', letter:'RTF' },
  '.odt':  { bg:'#2563EB', dark:'#1E40AF', letter:'ODT' },
  '.ods':  { bg:'#16A34A', dark:'#166534', letter:'ODS' },
  '.odp':  { bg:'#EA580C', dark:'#9A3412', letter:'ODP' },
  '.pages':{ bg:'#F97316', dark:'#C2410C', letter:'Pages' },
  '.numbers':{ bg:'#16A34A', dark:'#166534', letter:'Num' },
  '.key':  { bg:'#0EA5E9', dark:'#0369A1', letter:'Key' },
  '.tex':  { bg:'#475569', dark:'#1E293B', letter:'TEX' },
};

function fileIconSvg(file) {
  const ext = (file.ext || '').toLowerCase();
  const badge = BADGE_ICONS[ext];

  if (badge) {
    const fs = badge.letter.length >= 4 ? 24 : badge.letter.length === 3 ? 30 : 42;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="140" viewBox="0 0 120 140">
      <rect x="6" y="10" width="108" height="120" rx="22" fill="${badge.bg}"/>
      <rect x="6" y="70" width="108" height="60" rx="22" fill="${badge.dark}"/>
      <rect x="6" y="70" width="108" height="30" fill="${badge.dark}"/>
      <text x="60" y="${fs > 30 ? 78 : 76}" text-anchor="middle" fill="white" font-size="${fs}" font-weight="800" font-family="-apple-system,'Helvetica Neue',sans-serif" opacity="0.95">${badge.letter}</text>
      <text x="60" y="118" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="13" font-weight="600" font-family="-apple-system,sans-serif">${ext.replace('.','').toUpperCase()}</text>
    </svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  // その他: カテゴリ色のバッジ + 拡張子
  const c = CAT_COLORS[file.category] || CAT_COLORS.other;
  const label = ext.replace('.','').toUpperCase().slice(0,5) || '?';
  const fs = label.length >= 4 ? 22 : label.length === 3 ? 28 : 38;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="140" viewBox="0 0 120 140">
    <rect x="6" y="10" width="108" height="120" rx="22" fill="${c.bg}"/>
    <rect x="6" y="70" width="108" height="60" rx="22" fill="${c.dark || c.bg}"/>
    <rect x="6" y="70" width="108" height="30" fill="${c.dark || c.bg}"/>
    <text x="60" y="${fs > 30 ? 78 : 76}" text-anchor="middle" fill="white" font-size="${fs}" font-weight="800" font-family="-apple-system,'Helvetica Neue',sans-serif" opacity="0.95">${label}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// === コンポーネント ===
function FileItem({ file, onClick, onOpen, onReveal, onFav, onDragStart }) {
  const emoji = fileEmoji(file.ext, file.category);
  const thumb = useThumb(file);

  return (
    <div
      className="file-item"
      onClick={() => onClick?.(file)}
      onDoubleClick={() => onOpen?.(file.path)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', file.path);
        e.dataTransfer.effectAllowed = 'copyMove';
        onDragStart?.(file);
      }}
    >
      {thumb ? (
        <img className="file-thumb" src={thumb} alt="" />
      ) : (
        <div className="file-emoji">{emoji}</div>
      )}
      <div className="file-info">
        <div className="file-name">{file.name}</div>
        <div className="file-path">{shortenPath(file.dir)}</div>
      </div>
      <div className="file-meta">
        <span className="file-size">{formatSize(file.size)}</span>
        <span className="file-time">{formatTime(file.modified_at)}</span>
      </div>
      <div className="file-actions">
        <button className="file-action-btn" title="開く" onClick={e => { e.stopPropagation(); onOpen?.(file.path); }}>📂</button>
        <button className="file-action-btn" title="場所を表示" onClick={e => { e.stopPropagation(); onReveal?.(file.path); }}>📍</button>
        <button className="file-action-btn" title="お気に入り" onClick={e => { e.stopPropagation(); onFav?.(file.path); }}>☆</button>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, desc }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}

// グリッドアイテム（画像はサムネイル、その他はSVGアイコン）
function GridItem({ file, onClick, onDoubleClick }) {
  const thumb = useThumb(file);
  return (
    <div className="visual-grid-item" onClick={onClick} onDoubleClick={onDoubleClick} title={file.name}>
      <div className="visual-grid-icon">
        {thumb ? (
          <img src={thumb} alt={file.name} />
        ) : (
          <img src={fileIconSvg(file)} alt={file.name} />
        )}
      </div>
      <div className="visual-grid-name">{file.name}</div>
      <div className="visual-grid-size">{formatSize(file.size)}</div>
    </div>
  );
}

function Breadcrumb({ dirPath, onNavigate }) {
  const parts = dirPath.split('/').filter(Boolean);
  let cum = '';
  return (
    <div className="breadcrumb">
      {parts.map((p, i) => {
        cum += '/' + p;
        const cp = cum;
        return (
          <span key={i}>
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            <span className="breadcrumb-item" onClick={() => onNavigate(cp)}>{p}</span>
          </span>
        );
      })}
    </div>
  );
}

// === メディアプレーヤー（動画・音楽・画像すべて即再生）===
function MediaPlayer({ file, onClose, onOpen, onReveal, onPrev, onNext, hasPrev, hasNext }) {
  const videoRef = useRef(null);
  const mediaUrl = api.getMediaUrl(file.path);
  const isVideo = isPlayableVideo(file);
  const isAudio = isPlayableAudio(file);
  const isImage = isViewableImage(file);

  // キーボード: Escape=閉じる, ←=前, →=次
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      if (e.key === 'ArrowRight' && hasNext) onNext();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  return (
    <div className="modal-overlay media-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* 左矢印 */}
      {hasPrev && <button className="media-nav media-nav-left" onClick={onPrev} title="前へ (←)">‹</button>}

      <div className="media-player-modal">
        {isVideo && (
          <video ref={videoRef} src={mediaUrl} autoPlay controls className="media-video" />
        )}
        {isAudio && (
          <div className="media-audio-wrap">
            <div className="media-audio-icon">🎵</div>
            <audio src={mediaUrl} autoPlay controls className="media-audio" />
          </div>
        )}
        {isImage && (
          <img src={mediaUrl} alt={file.name} className="media-image" />
        )}

        <div className="media-info">
          <div className="media-name">{file.name}</div>
          <div className="media-meta">
            <span>{formatSize(file.size)}</span>
            <span>{formatTime(file.modified_at)}</span>
          </div>
          <div className="media-actions">
            {hasPrev && <button className="btn btn-outline" onClick={onPrev}>← 前へ</button>}
            <button className="btn btn-outline" onClick={() => onOpen?.(file.path)}>📂 開く</button>
            <button className="btn btn-outline" onClick={() => onReveal?.(file.path)}>📍 場所</button>
            <button className="btn btn-outline" onClick={onClose}>✕ 閉じる</button>
            {hasNext && <button className="btn btn-primary media-next-btn" onClick={onNext}>次へ →</button>}
          </div>
        </div>
      </div>

      {/* 右矢印 */}
      {hasNext && <button className="media-nav media-nav-right" onClick={onNext} title="次へ (→)">›</button>}
    </div>
  );
}

// === ドロップゾーン ===
function DropZone({ onDrop, label }) {
  const [active, setActive] = useState(false);
  return (
    <div
      className={`drop-zone ${active ? 'active' : ''}`}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setActive(true); }}
      onDragLeave={() => setActive(false)}
      onDrop={e => { e.preventDefault(); setActive(false); onDrop?.(e); }}
    >
      <div className="drop-icon">📥</div>
      <p>{label || 'ここにファイルをドラッグ＆ドロップ'}</p>
    </div>
  );
}

// モーダル用サムネイル（大きめ、全ファイル対応）
function DetailThumb({ file, emoji }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    api.getThumbnail(file.path, 300).then(url => { if (url) setSrc(url); });
  }, [file.path]);
  if (src) return <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 12, objectFit: 'contain' }} />;
  return <div style={{ fontSize: 52 }}>{emoji}</div>;
}

// === ファイル詳細モーダル ===
function FileDetailModal({ file, onClose, onOpen, onReveal, onFav, onBrowse }) {
  if (!file) return null;
  const emoji = fileEmoji(file.ext, file.category);
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <DetailThumb file={file} emoji={emoji} />
          <h2 style={{ wordBreak: 'break-all', marginTop: 6 }}>{file.name}</h2>
        </div>
        <div className="detail-row">
          <span className="detail-label">場所</span>
          <span className="detail-value clickable" onClick={() => { onClose(); onBrowse?.(file.dir); }}>
            {shortenPath(file.dir, 60)}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">フルパス</span>
          <span className="detail-value" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{file.path}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">サイズ</span>
          <span className="detail-value">{formatSize(file.size)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">種類</span>
          <span className="detail-value">{file.mime_type || file.ext || '不明'}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">更新</span>
          <span className="detail-value">{file.modified_at} ({formatTime(file.modified_at)})</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">作成</span>
          <span className="detail-value">{file.created_at || '不明'}</span>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => onOpen?.(file.path)}>📂 開く</button>
          <button className="btn btn-outline" onClick={() => onReveal?.(file.path)}>📍 場所を表示</button>
          <button className="btn btn-outline" onClick={() => onFav?.(file.path)}>
            {file.isFavorite ? '★ 解除' : '☆ お気に入り'}
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="btn btn-outline" onClick={onClose} style={{ fontSize: 12, padding: '7px 18px' }}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

// === 同期パネル ===
function SyncPanel() {
  const [src, setSrc] = useState('');
  const [dest, setDest] = useState('');
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);

  const selectSrc = async () => { const p = await api.selectDirectory(); if (p) setSrc(p); };
  const selectDest = async () => { const p = await api.selectDirectory(); if (p) setDest(p); };

  const doSync = async () => {
    if (!src || !dest) { setStatus('フォルダを2つ選んでください'); return; }
    setSyncing(true);
    setStatus('同期中...');
    const result = await api.syncFiles(src, dest);
    setSyncing(false);
    setStatus(result.success ? '同期完了！' : 'エラー: ' + result.error);
  };

  return (
    <div className="sync-panel">
      <h3>🔄 フォルダ同期（rsync）</h3>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
        フォルダの中身を別のフォルダにコピーします。同じファイルはスキップします。
      </p>
      <div className="sync-row">
        <div className="sync-path" onClick={selectSrc} style={{ cursor: 'pointer' }}>
          {src || 'コピー元フォルダを選ぶ...'}
        </div>
        <span className="sync-arrow">→</span>
        <div className="sync-path" onClick={selectDest} style={{ cursor: 'pointer' }}>
          {dest || 'コピー先フォルダを選ぶ...'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-primary" onClick={doSync} disabled={syncing}>
          {syncing ? '⏳ 同期中...' : '🔄 同期する'}
        </button>
        {status && <span style={{ fontSize: 13, color: status.includes('エラー') ? 'var(--danger)' : 'var(--success)' }}>{status}</span>}
      </div>
    </div>
  );
}

// ============================================================
// メインアプリ
// ============================================================
export default function App() {
  // === 状態 ===
  const [view, setView] = useState('home');
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [places, setPlaces] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [catFiles, setCatFiles] = useState([]);
  const [currentCat, setCurrentCat] = useState('');
  const [browseData, setBrowseData] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [largeFiles, setLargeFiles] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [detailFile, setDetailFile] = useState(null);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaList, setMediaList] = useState([]);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('finder-theme') || 'light');
  const [indexing, setIndexing] = useState(false);
  const [history, setHistory] = useState([]);
  const searchTimer = useRef(null);
  const inputRef = useRef(null);

  // === 初期ロード ===
  useEffect(() => {
    (async () => {
      const [s, r, p] = await Promise.all([
        api.getStats(), api.getRecent(20), api.getPlaces()
      ]);
      setStats(s);
      setRecent(r);
      setPlaces(p);
      if (s?.indexState?.running) setIndexing(true);
    })();

    const unsub1 = api.onEvent((data) => {
      if (data.event === 'progress') setIndexing(true);
      if (data.event === 'done') {
        setIndexing(false);
        api.getStats().then(setStats);
        api.getRecent(20).then(setRecent);
      }
    });
    const unsub2 = api.onIndexDone(() => {
      setIndexing(false);
      api.getStats().then(setStats);
      api.getRecent(20).then(setRecent);
    });

    return () => { unsub1(); unsub2(); };
  }, []);

  // === テーマ ===
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : '');
    localStorage.setItem('finder-theme', theme);
  }, [theme]);

  // === キーボードショートカット ===
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === 'Escape') { setDetailFile(null); setMediaFile(null); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // === 検索（デバウンス）===
  const handleSearch = useCallback((q) => {
    setQuery(q);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setView('home'); setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const r = await api.search(q);
      setResults(r);
      setView('search');
    }, 200);
  }, []);

  // === ナビゲーション履歴 ===
  const pushHistory = () => { setHistory(h => [...h, view]); };
  const goBack = () => {
    setHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setView(prev);
      setQuery('');
      return h.slice(0, -1);
    });
  };
  const canGoBack = history.length > 0;

  // === アクション ===
  const goHome = () => { pushHistory(); setView('home'); setQuery(''); };
  const openFile = (p) => api.openFile(p);
  const revealFile = (p) => api.revealFile(p);
  const toggleFav = async (p) => {
    await api.addFavorite(p);
    if (view === 'favorites') setFavorites(await api.getFavorites());
  };
  // 現在表示中のファイル一覧を取得
  const getCurrentFileList = () => {
    if (view === 'search') return results;
    if (view === 'category') return catFiles;
    if (view === 'browse') return browseData?.files || [];
    if (view === 'large') return largeFiles;
    if (view === 'favorites') return favorites;
    return recent;
  };

  const showDetail = async (file) => {
    if (isPlayableVideo(file) || isPlayableAudio(file) || isViewableImage(file)) {
      const list = getCurrentFileList().filter(f => isPlayableVideo(f) || isPlayableAudio(f) || isViewableImage(f));
      const idx = list.findIndex(f => f.path === file.path);
      setMediaList(list);
      setMediaIndex(idx >= 0 ? idx : 0);
      setMediaFile(file);
      return;
    }
    const d = await api.getFileDetail(file.path);
    setDetailFile(d || file);
  };

  const showCategory = async (name) => {
    pushHistory();
    const files = name === 'all' ? await api.getRecent(100) : await api.getCategory(name, 100);
    setCatFiles(files);
    setCurrentCat(name);
    setView('category');
  };
  const browseTo = async (dirPath) => {
    pushHistory();
    const data = await api.browse(dirPath);
    setBrowseData(data);
    setView('browse');
  };
  const showDuplicates = async () => {
    pushHistory();
    setDuplicates(await api.getDuplicates());
    setView('duplicates');
  };
  const showLarge = async () => {
    pushHistory();
    setLargeFiles(await api.getLargeFiles(50));
    setView('large');
  };
  const showFavs = async () => {
    pushHistory();
    setFavorites(await api.getFavorites());
    setView('favorites');
  };
  const reindex = async () => {
    setIndexing(true);
    await api.reindex();
    const [s, r] = await Promise.all([api.getStats(), api.getRecent(20)]);
    setStats(s);
    setRecent(r);
    setIndexing(false);
  };

  const fileProps = { onClick: showDetail, onOpen: openFile, onReveal: revealFile, onFav: toggleFav };

  // === ファイルドロップ処理 ===
  const handleFileDrop = async (e, targetDir) => {
    const files = e.dataTransfer?.files;
    const srcPath = e.dataTransfer?.getData('text/plain');

    if (srcPath && targetDir) {
      await api.moveFile(srcPath, targetDir);
      if (browseData) setBrowseData(await api.browse(browseData.dir));
    } else if (files?.length > 0) {
      const paths = Array.from(files).map(f => f.path);
      if (targetDir) {
        for (const p of paths) await api.copyFile(p, targetDir);
        if (browseData) setBrowseData(await api.browse(browseData.dir));
      }
    }
  };

  // === カテゴリ名 ===
  const CAT_NAMES = {
    document: '文書', image: '画像', video: '動画', audio: '音楽',
    code: 'コード', archive: '圧縮ファイル', font: 'フォント', data: 'データ', other: 'その他', all: '全てのファイル'
  };
  const CAT_ICONS = {
    document: '📄', image: '🖼️', video: '🎬', audio: '🎵',
    code: '💻', archive: '📦', font: '🔤', data: '🗃️', other: '📁', all: '📊'
  };

  // ============================================================
  // レンダリング
  // ============================================================
  return (
    <div className="app">
      {/* ヘッダー */}
      <header className="header">
        <div className="header-inner">
          {canGoBack && <button className="back-btn" onClick={goBack} title="戻る">←</button>}
          <div className="logo" onClick={goHome}><span>📂</span>ファインダー</div>
          <div className="search-wrap">
            <div className="search-icon">🔍</div>
            <input
              ref={inputRef}
              type="text"
              className="search-bar"
              placeholder="ファイルを探す... 名前を入力するだけ（Ctrl+K）"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && goHome()}
              autoFocus
            />
            {query && <button className="search-clear" onClick={goHome}>✕</button>}
          </div>
          <div className="header-actions">
            <button className="icon-btn" title="再読み込み" onClick={reindex}>🔄</button>
            <button className="icon-btn" title="テーマ切替" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="main-content">

        {/* === ホーム === */}
        {view === 'home' && stats && (
          <div className="fade-in">
            <div className="welcome">
              <h1>ファイルを見つけよう</h1>
              <p>上の検索バーに名前を入力するだけ。一部分でもOK。</p>
            </div>

            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-icon">📊</div>
                <div className="stat-value">{(stats.total_files || 0).toLocaleString()}</div>
                <div className="stat-label">ファイル数</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">💾</div>
                <div className="stat-value">{formatSize(stats.total_size)}</div>
                <div className="stat-label">合計サイズ</div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">📁</div>
                <div className="stat-value">{(stats.total_dirs || 0).toLocaleString()}</div>
                <div className="stat-label">フォルダ数</div>
              </div>
            </div>

            {/* カテゴリ - Vue コンポーネント */}
            <h2 className="section-title"><span className="icon">📁</span>カテゴリ別に探す</h2>
            <VueBridge
              component={CategoryCards}
              props={{ categories: stats.categories || [], totalSize: stats.total_size || 0 }}
              onSelect={showCategory}
            />

            {/* よく使う場所 */}
            <h2 className="section-title"><span className="icon">📍</span>よく使う場所</h2>
            <div className="places">
              {places.map(p => (
                <div key={p.path} className="place-card" onClick={() => browseTo(p.path)}>
                  <span className="place-icon">{p.icon}</span>
                  <span className="place-name">{p.name}</span>
                </div>
              ))}
            </div>

            {/* 最近のファイル */}
            <h2 className="section-title">
              <span className="icon">🕐</span>最近のファイル
              <button className="section-more" onClick={() => showCategory('all')}>もっと見る →</button>
            </h2>
            <div className="file-list">
              {recent.map(f => <FileItem key={f.path} file={f} {...fileProps} />)}
              {recent.length === 0 && <EmptyState icon="📂" title="まだファイルがありません" desc="インデックスが完了するまでお待ちください" />}
            </div>

            {/* クイックアクション */}
            <div className="nav-tabs" style={{ marginTop: 20 }}>
              <button className="nav-tab" onClick={showLarge}>📦 大きいファイル</button>
              <button className="nav-tab" onClick={showDuplicates}>🔗 重複ファイル</button>
              <button className="nav-tab" onClick={showFavs}>⭐ お気に入り</button>
              <button className="nav-tab" onClick={() => setView('sync')}>🔄 フォルダ同期</button>
            </div>
          </div>
        )}

        {/* === ホーム読み込み中 === */}
        {view === 'home' && !stats && (
          <div className="empty-state">
            <div className="spinner" style={{ width: 40, height: 40, margin: '0 auto 14px', borderWidth: 4 }} />
            <h3>準備中...</h3>
            <p>ファイルを読み込んでいます</p>
          </div>
        )}

        {/* === 検索結果 === */}
        {view === 'search' && (
          <div className="fade-in">
            <div className="nav-tabs">
              <button className="nav-tab active">🔍 検索結果</button>
              <button className="nav-tab" onClick={goHome}>🏠 ホーム</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 14, fontSize: 13 }}>
              「{query}」の検索結果: {results.length} 件
            </p>
            <div className="file-list">
              {results.map(f => <FileItem key={f.path} file={f} {...fileProps} />)}
              {results.length === 0 && <EmptyState icon="🔍" title="見つかりませんでした" desc="キーワードを変えてみてください。ファイル名の一部でも検索できます。" />}
            </div>
          </div>
        )}

        {/* === カテゴリ === */}
        {view === 'category' && (
          <div className="fade-in">
            <div className="nav-tabs">
              <button className="nav-tab" onClick={goHome}>🏠 ホーム</button>
              <button className="nav-tab active">{CAT_ICONS[currentCat] || '📁'} {CAT_NAMES[currentCat] || currentCat}</button>
            </div>

            {/* 全カテゴリ → ビジュアルグリッド表示 */}
            <div className="visual-grid">
              {catFiles.map(f => (
                <GridItem key={f.path} file={f} onClick={() => showDetail(f)} onDoubleClick={() => openFile(f.path)} />
              ))}
              {catFiles.length === 0 && <EmptyState icon={CAT_ICONS[currentCat] || '📁'} title="ファイルがありません" desc="このカテゴリにはまだファイルがありません" />}
            </div>
          </div>
        )}

        {/* === フォルダ閲覧 === */}
        {view === 'browse' && browseData && (
          <div className="fade-in">
            <div className="nav-tabs">
              <button className="nav-tab" onClick={goHome}>🏠 ホーム</button>
              <button className="nav-tab active">📂 フォルダ</button>
              {browseData.parent !== browseData.dir && (
                <button className="nav-tab" onClick={() => browseTo(browseData.parent)}>⬆️ 上へ</button>
              )}
            </div>
            <Breadcrumb dirPath={browseData.dir} onNavigate={browseTo} />

            {/* ドロップゾーン */}
            <DropZone
              onDrop={(e) => handleFileDrop(e, browseData.dir)}
              label="ここにファイルをドロップしてこのフォルダにコピー"
            />

            <div className="file-list">
              {browseData.subdirs.map(d => (
                <div key={d.path} className="file-item" onClick={() => browseTo(d.path)}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                  onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
                  onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); handleFileDrop(e, d.path); }}
                >
                  <div className="file-emoji" style={{ fontSize: 26 }}>📁</div>
                  <div className="file-info"><div className="file-name">{d.name}</div></div>
                </div>
              ))}
              {browseData.files.map(f => <FileItem key={f.path} file={f} {...fileProps} />)}
              {browseData.subdirs.length === 0 && browseData.files.length === 0 && (
                <EmptyState icon="📂" title="空のフォルダ" desc="このフォルダにはファイルがありません" />
              )}
            </div>
          </div>
        )}

        {/* === 重複ファイル === */}
        {view === 'duplicates' && (
          <div className="fade-in">
            <div className="nav-tabs">
              <button className="nav-tab" onClick={goHome}>🏠 ホーム</button>
              <button className="nav-tab active">🔗 重複ファイル</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 14, fontSize: 13 }}>
              同じ内容のファイルが複数の場所にあります
            </p>
            {duplicates.map((d, i) => (
              <div key={i} className="dup-group">
                <div className="dup-header">
                  <span className="dup-badge">{d.count} 個の重複</span>
                  <span>{formatSize(d.size)} × {d.count}</span>
                </div>
                <div className="file-list">
                  {d.files.map(f => <FileItem key={f.path} file={f} {...fileProps} />)}
                </div>
              </div>
            ))}
            {duplicates.length === 0 && <EmptyState icon="✅" title="重複ファイルはありません" desc="すべてのファイルがユニークです！" />}
          </div>
        )}

        {/* === 大きいファイル === */}
        {view === 'large' && (
          <div className="fade-in">
            <div className="nav-tabs">
              <button className="nav-tab" onClick={goHome}>🏠 ホーム</button>
              <button className="nav-tab active">📦 大きいファイル</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 14, fontSize: 13 }}>
              容量が大きいファイル順に表示しています
            </p>
            <div className="file-list">
              {largeFiles.map(f => <FileItem key={f.path} file={f} {...fileProps} />)}
            </div>
          </div>
        )}

        {/* === お気に入り === */}
        {view === 'favorites' && (
          <div className="fade-in">
            <div className="nav-tabs">
              <button className="nav-tab" onClick={goHome}>🏠 ホーム</button>
              <button className="nav-tab active">⭐ お気に入り</button>
            </div>
            <div className="file-list">
              {favorites.map(f => <FileItem key={f.path} file={f} {...fileProps} />)}
              {favorites.length === 0 && <EmptyState icon="⭐" title="お気に入りがありません" desc="ファイルの横にある ☆ をクリックするとお気に入りに追加できます" />}
            </div>
          </div>
        )}

        {/* === フォルダ同期 === */}
        {view === 'sync' && (
          <div className="fade-in">
            <div className="nav-tabs">
              <button className="nav-tab" onClick={goHome}>🏠 ホーム</button>
              <button className="nav-tab active">🔄 フォルダ同期</button>
            </div>
            <SyncPanel />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
              rsyncが入っていれば自動で使います。なくても cp でコピーします。
            </p>
          </div>
        )}
      </main>

      {/* インデックスバー */}
      {indexing && (
        <div className="indexing-bar">
          <div className="spinner" />
          <span className="indexing-text">ファイルを読み取り中...</span>
        </div>
      )}

      {/* メディアプレーヤー（動画・音楽・画像 即再生）*/}
      {mediaFile && (
        <MediaPlayer
          file={mediaFile}
          onClose={() => { setMediaFile(null); setMediaList([]); }}
          onOpen={openFile}
          onReveal={revealFile}
          hasPrev={mediaIndex > 0}
          hasNext={mediaIndex < mediaList.length - 1}
          onPrev={() => { const i = mediaIndex - 1; setMediaIndex(i); setMediaFile(mediaList[i]); }}
          onNext={() => { const i = mediaIndex + 1; setMediaIndex(i); setMediaFile(mediaList[i]); }}
        />
      )}

      {/* ファイル詳細モーダル */}
      {detailFile && (
        <FileDetailModal
          file={detailFile}
          onClose={() => setDetailFile(null)}
          onOpen={openFile}
          onReveal={revealFile}
          onFav={toggleFav}
          onBrowse={browseTo}
        />
      )}
    </div>
  );
}
