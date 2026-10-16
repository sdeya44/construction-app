// Local persistence (device only). Everything lives under one localStorage key.
const KEY = 'mazil-quotes.v1';

const DEFAULTS = {
  settings: {
    company: 'מציל חיים בע״מ',
    osek: '514701044',
    producer: '',
    prefix: '06',
    nextNo: 408,
    vat: 18,
    headerImg: '',          // data URL of a replacement header image; '' = built-in
  },
  quotes: [],
  customers: [],
  catalog: [],
};

let db = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { ...structuredClone(DEFAULTS), ...d, settings: { ...DEFAULTS.settings, ...(d.settings || {}) } };
    }
  } catch (e) { console.error('load failed', e); }
  return structuredClone(DEFAULTS);
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
  catch (e) { alert('שמירה נכשלה: נגמר מקום האחסון במכשיר. גבה ומחק הצעות ישנות.'); return false; }
}

export const getDb = () => db;
export const settings = () => db.settings;
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function newQuote() {
  const s = db.settings;
  return {
    id: uid(), no: null, prefix: s.prefix, createdAt: new Date().toISOString(), copyType: 'מקור',
    ref: '', producer: s.producer, customer: { name: '', phone: '', fax: '', taxId: '' },
    items: [{ code: '0', desc: '', qty: '1', price: '', disc: '0' }],
    discount: 0, vat: s.vat, notes: '', roundTotal: true,
  };
}

export function upsertQuote(q) {
  if (q.no == null) {
    const s = db.settings;
    q.prefix = s.prefix;
    q.no = Number(s.nextNo) || 1;
    s.nextNo = q.no + 1;
  }
  q.updatedAt = new Date().toISOString();
  const i = db.quotes.findIndex(x => x.id === q.id);
  if (i >= 0) db.quotes[i] = q; else db.quotes.unshift(q);
  upsertCustomer(q.customer);
  return save();
}

export function deleteQuote(id) { db.quotes = db.quotes.filter(q => q.id !== id); save(); }
export const getQuote = id => db.quotes.find(q => q.id === id);

export function duplicateQuote(q) {
  const c = structuredClone(q);
  Object.assign(c, { id: uid(), no: null, createdAt: new Date().toISOString(), updatedAt: undefined, copyType: 'מקור', vat: db.settings.vat });
  return c;
}

function upsertCustomer(c) {
  const name = (c.name || '').trim();
  if (!name) return;
  const i = db.customers.findIndex(x => x.name.trim() === name);
  const rec = { name, phone: c.phone || '', fax: c.fax || '', taxId: c.taxId || '' };
  if (i >= 0) db.customers[i] = rec; else db.customers.push(rec);
}

export function saveCatalogItem(it) {
  const i = db.catalog.findIndex(x => x.id === it.id);
  if (i >= 0) db.catalog[i] = it; else db.catalog.push({ ...it, id: it.id || uid() });
  save();
}
export function deleteCatalogItem(id) { db.catalog = db.catalog.filter(x => x.id !== id); save(); }

export function exportJson() { return JSON.stringify({ app: 'mazil-quotes', version: 1, exportedAt: new Date().toISOString(), ...db }, null, 1); }

export function importJson(text) {
  const d = JSON.parse(text);
  if (!d || !Array.isArray(d.quotes) || !d.settings) throw new Error('קובץ גיבוי לא תקין');
  db = { ...structuredClone(DEFAULTS), quotes: d.quotes, customers: d.customers || [], catalog: d.catalog || [], settings: { ...DEFAULTS.settings, ...d.settings } };
  save();
}
