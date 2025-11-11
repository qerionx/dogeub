import JSZip from 'jszip';

const DB_NAME = 'gm loader db';
const DB_VERSION = 1;
const STORE_NAME = 'gms';

class LocalGmLoader {
  constructor() {
    this.db = null;
  }

  initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  async saveGame(db, gameName, files) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const gameData = {
        id: gameName,
        name: gameName,
        files: files,
        uploadDate: new Date().toISOString(),
        lastPlayed: new Date().toISOString()
      };
      const request = store.put(gameData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async updateLastPlayed(db, gameName) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(gameName);
      
      getRequest.onsuccess = () => {
        const gameData = getRequest.result;
        if (gameData) {
          gameData.lastPlayed = new Date().toISOString();
          const putRequest = store.put(gameData);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async cleanupOldGames(db) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const game = cursor.value;
          const lastPlayed = new Date(game.lastPlayed || game.uploadDate);
          if (lastPlayed < threeDaysAgo) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getGame(db, gameName) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(gameName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      mjs: 'application/javascript',
      json: 'application/json',
      xml: 'application/xml',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      webp: 'image/webp',
      bmp: 'image/bmp',
      avif: 'image/avif',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf',
      eot: 'application/vnd.ms-fontobject',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      mp4: 'video/mp4',
      webm: 'video/webm',
      ogv: 'video/ogg',
      wasm: 'application/wasm',
      zip: 'application/zip',
      gz: 'application/gzip',
      pdf: 'application/pdf',
      data: 'application/octet-stream',
      unityweb: 'application/octet-stream',
      bundle: 'application/octet-stream',
      bin: 'application/octet-stream',
      dat: 'application/octet-stream',
      mem: 'application/octet-stream',
      asset: 'application/octet-stream',
      resource: 'application/octet-stream',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  isBinaryFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const textExtensions = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'xml', 'txt', 'md', 'csv', 'svg']);
    return !textExtensions.has(ext);
  }

  async extractZip(zipUrl) {
    const response = await fetch(zipUrl);
    const blob = await response.blob();
    const zip = new JSZip();
    const contents = await zip.loadAsync(blob);
    const files = {};
    
    for (const [path, zipEntry] of Object.entries(contents.files)) {
      if (!zipEntry.dir) {
        const isBinary = this.isBinaryFile(path);
        const mimeType = this.getMimeType(path);
        const content = await zipEntry.async(isBinary ? 'base64' : 'string');
        
        files[path] = {
          content: content,
          mime: mimeType,
          binary: isBinary,
        };
      }
    }
    return files;
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const existing = regs.find(reg => reg.active?.scriptURL.includes('/loadersw.js'));
        if (!existing) {
          await navigator.serviceWorker.register('/loadersw.js');
        }
      } catch (error) {
        console.error('sw error:', error);
      }
    }
  }

  async loadGm(gameUrl) {
    await this.registerServiceWorker();
    const db = await this.initDB();
    
    await this.cleanupOldGames(db);
    
    const gameName = gameUrl.split('/').pop().replace('.zip', '') || 'game-' + Date.now();
    
    const existing = await this.getGame(db, gameName);
    if (existing) {
      await this.updateLastPlayed(db, gameName);
      return {
        url: `/game/${gameName}/index.html`,
        fromCache: true
      };
    }

    const files = await this.extractZip(gameUrl);
    await this.saveGame(db, gameName, files);
    return {
      url: `/game/${gameName}/index.html`,
      fromCache: false
    };
  }
}

export default LocalGmLoader;
