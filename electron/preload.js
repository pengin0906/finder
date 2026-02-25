const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('finder', {
  // === クエリ ===
  search: (q, limit) => ipcRenderer.invoke('finder:search', q, limit),
  getStats: () => ipcRenderer.invoke('finder:getStats'),
  getRecent: (limit) => ipcRenderer.invoke('finder:getRecent', limit),
  getCategory: (name, limit) => ipcRenderer.invoke('finder:getCategory', name, limit),
  browse: (dirPath) => ipcRenderer.invoke('finder:browse', dirPath),
  getPlaces: () => ipcRenderer.invoke('finder:getPlaces'),
  getDuplicates: () => ipcRenderer.invoke('finder:getDuplicates'),
  getLargeFiles: (limit) => ipcRenderer.invoke('finder:getLargeFiles', limit),
  getFavorites: () => ipcRenderer.invoke('finder:getFavorites'),
  getFileDetail: (p) => ipcRenderer.invoke('finder:getFileDetail', p),

  // === アクション ===
  addFavorite: (p) => ipcRenderer.invoke('finder:addFavorite', p),
  removeFavorite: (p) => ipcRenderer.invoke('finder:removeFavorite', p),
  openFile: (p) => ipcRenderer.invoke('finder:openFile', p),
  revealFile: (p) => ipcRenderer.invoke('finder:revealFile', p),
  reindex: () => ipcRenderer.invoke('finder:reindex'),
  copyFile: (src, dest) => ipcRenderer.invoke('finder:copyFile', src, dest),
  moveFile: (src, dest) => ipcRenderer.invoke('finder:moveFile', src, dest),
  deleteFile: (p) => ipcRenderer.invoke('finder:deleteFile', p),
  syncFiles: (src, dest) => ipcRenderer.invoke('finder:syncFiles', src, dest),
  selectDirectory: () => ipcRenderer.invoke('finder:selectDirectory'),
  getDroppedFiles: (paths) => ipcRenderer.invoke('finder:getDroppedFiles', paths),
  getThumbnail: (p, size) => ipcRenderer.invoke('finder:getThumbnail', p, size),
  readFileContent: (p, max) => ipcRenderer.invoke('finder:readFileContent', p, max),
  extractArchive: (p) => ipcRenderer.invoke('finder:extractArchive', p),

  // === メディア再生 ===
  getMediaUrl: (p) => 'finder-media://' + encodeURIComponent(p),

  // === イベント ===
  onEvent: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('finder:event', handler);
    return () => ipcRenderer.removeListener('finder:event', handler);
  },
  onIndexDone: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('finder:indexDone', handler);
    return () => ipcRenderer.removeListener('finder:indexDone', handler);
  }
});
