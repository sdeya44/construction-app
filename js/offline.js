const DB_NAME    = 'cnstr_offline_v1';
const DB_VERSION = 1;
let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('cache'))
        db.createObjectStore('cache');
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

export async function saveCache(data) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').put(data, 'snapshot');
      tx.oncomplete = res;
      tx.onerror    = e => rej(e.target.error);
    });
  } catch {}
}

export async function loadCache() {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx  = db.transaction('cache', 'readonly');
      const req = tx.objectStore('cache').get('snapshot');
      req.onsuccess = e => res(e.target.result || null);
      req.onerror   = e => rej(e.target.error);
    });
  } catch { return null; }
}

export function startOfflineMonitor(onChange) {
  const handler = () => { onChange(navigator.onLine); updateStatusBar(navigator.onLine); };
  window.addEventListener('online',  handler);
  window.addEventListener('offline', handler);
}

export function updateStatusBar(online) {
  const bar = document.getElementById('status-bar');
  if (!bar) return;
  if (online) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    bar.className = 'status-bar offline';
    bar.innerHTML = `<div class="status-dot"></div><span>לא מקוון — מוצגים נתונים שמורים, שמירה מחייבת חיבור</span>`;
  }
}
