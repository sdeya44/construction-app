// Persistence: Electron → a real file on disk with rotating backups (via preload bridge);
// browser → IndexedDB. Both store the complete SQLite database as one blob.
const native = globalThis.kayanNative ?? null;
export const isDesktop = !!native;

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kayan-boq', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('files').objectStore('files').get(key);
    t.onsuccess = () => res(t.result ? new Uint8Array(t.result) : null);
    t.onerror = () => rej(t.error);
  });
}
async function idbPut(key, bytes) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function loadData() { return native ? native.loadData() : idbGet('db'); }
export async function loadDekel() { return native ? native.loadDekel() : idbGet('dekel'); }
export async function saveDekel(bytes) { return native ? native.saveDekel(bytes) : idbPut('dekel', bytes); }

let pending = null, timer = null, saving = Promise.resolve();
export const saveState = { status: 'saved', listeners: new Set(), error: null };
const setStatus = (s, err = null) => { saveState.status = s; saveState.error = err; for (const l of saveState.listeners) l(s); };

/** Debounced save of the whole DB. */
export function scheduleSave(bytes) {
  pending = bytes;
  setStatus('pending');
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}
export function flush() {
  clearTimeout(timer);
  if (!pending) return saving;
  const b = pending; pending = null;
  setStatus('saving');
  saving = saving.then(() => (native ? native.saveData(b) : idbPut('db', b)))
    .then(() => setStatus(pending ? 'pending' : 'saved'))
    .catch((e) => { setStatus('error', e); console.error(e); });
  return saving;
}
globalThis.addEventListener?.('beforeunload', (e) => { if (pending) { flush(); e.preventDefault(); } });

export async function requestPersistence() {
  if (!native && navigator.storage?.persist) { try { return await navigator.storage.persist(); } catch { return false; } }
  return true;
}
export const dataLocation = () => (native ? native.dataPath() : 'אחסון הדפדפן (IndexedDB) — מומלץ לגבות לקובץ באופן קבוע');

/** Download bytes as a file (works in browser and Electron). */
export function download(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function pickFile(accept) {
  return new Promise((res) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept });
    i.onchange = async () => { const f = i.files[0]; res(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null); };
    i.click();
  });
}
export async function printPdf(name) {
  if (native?.printToPdf) return native.printToPdf(name);
  window.print();
}
