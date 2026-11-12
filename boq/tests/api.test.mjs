import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from '../js/store.js';
import { Api } from '../js/api.js';
import { parseSkn, buildSkn } from '../js/skn.js';

const require = createRequire(import.meta.url);
const SQL = await require('../vendor/sql-wasm.js')({ locateFile: (f) => fileURLToPath(new URL(`../vendor/${f}`, import.meta.url)) });

function setup(contract = {}) {
  let saved = null;
  const store = new Store(SQL, null, (b) => { saved = b; });
  const api = new Api(store);
  const p = api.saveProject({ name: 'רפת', client: 'מזמין' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'שלד', vat_rate: '18', retention_rate: '5', ...contract });
  const i1 = api.saveItem({ contract_id: c, chapter: '02', sub: '01', num: 10, description: 'בטון', unit: 'מ"ק', qty: '100', price: '1000' });
  const i2 = api.saveItem({ contract_id: c, chapter: '02', sub: '01', num: 20, description: 'רצפה', unit: 'מ"ר', qty: '50', price: '200' });
  return { store, api, p, c, i1, i2, saved: () => saved };
}

test('full cycle: bill → submit → approve → payment; persistence round-trip', () => {
  const { api, c, i1, i2, saved, store } = setup();
  const b1 = api.createBill(c, { month: '2026-01' });
  api.setLine(b1, i1, { q_sub: '40' });
  assert.equal(api.calc(b1).periodNet, 4000000);
  assert.throws(() => api.createBill(c, { month: '2026-02' }), /פתוח/);
  api.submitBill(b1);
  assert.throws(() => api.setLine(b1, i1, { q_sub: '50' }));
  api.approveBill(b1);
  const snap = api.bill(b1).snap;
  assert.equal(snap.retention, 200000);
  // approved snapshot frozen against later price edits
  assert.throws(() => api.saveItem({ ...api.item(i1), price: '1' }), /חויב/);
  api.addPayment(b1, { amount: '1000' });
  assert.throws(() => api.addPayment(b1, { amount: '99999999' }), /חורג/);
  const b2 = api.createBill(c, { month: '2026-02' });
  assert.equal(api.lines(b2).get(i1).q_sub, '40'); // prefilled cumulative
  api.setLine(b2, i1, { q_sub: '70' });
  api.setLine(b2, i2, { q_sub: '10' });
  assert.equal(api.calc(b2).periodNet, 3000000 + 200000);
  // the persisted bytes reopen with the same data
  const again = new Api(new Store(SQL, saved()));
  assert.equal(again.bills(c).length, 2);
  assert.equal(again.bill(b1).snap.periodNet, 4000000);
  assert.ok(store.get('SELECT COUNT(*) n FROM audit').n > 3);
});

test('atomic import rejects duplicates and saves nothing', () => {
  const { api, c } = setup();
  const before = api.items(c).length;
  assert.throws(() => api.importItems(c, { items: [
    { struct: '01', chapter: '03', sub: '01', num: 1, unit: "יח'", qty: '1', price: '1', description: 'a' },
    { struct: '01', chapter: '02', sub: '01', num: 10, unit: "יח'", qty: '1', price: '1', description: 'dup' },
  ] }), /בוטל/);
  assert.equal(api.items(c).length, before);
});

test('SKN import → contract → SKN export reproduces the file', () => {
  const { api, p } = setup();
  const ref = readFileSync(new URL('./fixtures/ref.skn', import.meta.url));
  const parsed = parseSkn(ref);
  const c = api.saveContract({ project_id: p, kind: 'client', name: parsed.title });
  api.importItems(c, parsed, 'replace');
  const out = buildSkn(parsed.title, api.sections(c), api.items(c));
  assert.equal(Buffer.from(out.bytes).toString('hex'), ref.toString('hex'));
});

test('quote priced from Dekel with general + chapter markup; manual override wins; convert to contract', () => {
  const { api, p } = setup();
  const q = api.saveContract({ project_id: p, kind: 'quote', name: 'הצעה', quote_markup: '-10' });
  const a = api.saveItem({ contract_id: q, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '100', description: 'חפירה', dekel_code: '01.020.1100', dekel_price: '82', price_manual: 0 });
  assert.equal(api.item(a).price, '73.8');
  api.saveSection(q, '01.01', { markup: '5' });
  assert.equal(api.item(a).price, '77.49');
  api.saveItem({ ...api.item(a), price: '70', price_manual: 1 });
  api.saveContract({ ...api.contract(q), quote_markup: '0' });
  assert.equal(api.item(a).price, '70');
  const c = api.copyContract(q, { kind: 'client', name: 'חוזה מהצעה' });
  assert.equal(api.items(c)[0].price, '70');
  assert.throws(() => api.createBill(q, { month: '2026-01' }));
});

test('final bill closes the contract; approval is sequential; missing index blocks approval', () => {
  const { api, c, i1 } = setup({ index_rule: 'full', index_base_month: '2025-12' });
  api.setIndex('residential', '2025-12', '130');
  const b1 = api.createBill(c, { month: '2026-01', type: 'final' });
  api.setLine(b1, i1, { q_sub: '1' });
  assert.throws(() => api.approveBill(b1), /מדד/);
  api.setIndex('residential', '2026-01', '131.3');
  assert.equal(api.calc(b1).indexation.amount, 1000); // 1000₪ × 1%
  api.approveBill(b1);
  assert.equal(api.contract(c).status, 'closed');
  assert.throws(() => api.createBill(c, { month: '2026-02' }), /סופי/);
});

test('v1 database (UNIQUE on items, no planned_cents) is migrated in place', () => {
  const db = new SQL.Database();
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, client TEXT DEFAULT '', location TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active', dekel_threshold TEXT NOT NULL DEFAULT '15', notes TEXT DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE contracts (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, kind TEXT NOT NULL, parent_id INTEGER, name TEXT NOT NULL, number TEXT DEFAULT '', party TEXT DEFAULT '', mode TEXT NOT NULL DEFAULT 'cumulative', vat_rate TEXT NOT NULL DEFAULT '18', retention_rate TEXT NOT NULL DEFAULT '0', advance_cents INTEGER NOT NULL DEFAULT 0, advance_rate TEXT NOT NULL DEFAULT '0', general_discount TEXT NOT NULL DEFAULT '0', opening_cents INTEGER NOT NULL DEFAULT 0, index_rule TEXT NOT NULL DEFAULT 'none', index_series TEXT NOT NULL DEFAULT 'residential', index_base_month TEXT DEFAULT '', index_lag INTEGER NOT NULL DEFAULT 0, index_threshold TEXT NOT NULL DEFAULT '0', index_share TEXT NOT NULL DEFAULT '100', quote_markup TEXT NOT NULL DEFAULT '0', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
    CREATE TABLE items (id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL, struct TEXT NOT NULL, chapter TEXT NOT NULL, sub TEXT NOT NULL, num INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', qty TEXT NOT NULL DEFAULT '0', price TEXT NOT NULL DEFAULT '0', kind TEXT NOT NULL DEFAULT 'contract', change_status TEXT NOT NULL DEFAULT 'approved', dekel_code TEXT, dekel_price TEXT, price_manual INTEGER NOT NULL DEFAULT 1, source_item_id INTEGER, notes TEXT DEFAULT '', UNIQUE (contract_id, struct, chapter, sub, num));
    INSERT INTO projects (id, name, created_at) VALUES (1, 'p', 'x');
    INSERT INTO contracts (id, project_id, kind, name, created_at) VALUES (1, 1, 'client', 'c', 'x');
    INSERT INTO items (contract_id, struct, chapter, sub, num, kind, description) VALUES (1, '01', '00', '01', 10, 'note', 'a');`);
  const api = new Api(new Store(SQL, db.export()));
  assert.equal(api.contract(1).planned_cents, 0);
  api.importItems(1, { items: [{ struct: '01', chapter: '00', sub: '01', num: 10, kind: 'note', description: 'b', unit: '', qty: '0', price: '0' }] });
  assert.equal(api.items(1).length, 2);
  assert.throws(() => api.importItems(1, { items: [
    { struct: '01', chapter: '01', sub: '01', num: 10, unit: "יח'", qty: '1', price: '1', description: 'x' },
    { struct: '01', chapter: '01', sub: '01', num: 10, unit: "יח'", qty: '1', price: '1', description: 'y' }] }));
});
