import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Store } from '../js/store.js';
import { Api } from '../js/api.js';

const require = createRequire(import.meta.url);
const SQL = await require('../vendor/sql-wasm.js')({ locateFile: (f) => fileURLToPath(new URL(`../vendor/${f}`, import.meta.url)) });

function setup() {
  const api = new Api(new Store(SQL, null));
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'c', vat_rate: '0' });
  const i = api.saveItem({ contract_id: c, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '100', price: '100', description: 'x' });
  const bill = (m, q) => { const id = api.createBill(c, { month: m }); api.setLine(id, i, { q_sub: q }); api.approveBill(id); return id; };
  return { api, p, c, i, bill };
}

test('reopen: only the last approved bill, needs a reason, blocked by payments; final reopens contract', () => {
  const { api, c, i, bill } = setup();
  const b1 = bill('2026-01', '10');
  const b2 = api.createBill(c, { month: '2026-02', type: 'final' }); api.setLine(b2, i, { q_sub: '20' }); api.approveBill(b2);
  assert.equal(api.contract(c).status, 'closed');
  assert.throws(() => api.reopenBill(b1, 'טעות'), /האחרון/);
  assert.throws(() => api.reopenBill(b2, ''), /סיבה/);
  api.addPayment(b2, { amount: '1' });
  assert.throws(() => api.reopenBill(b2, 'טעות בכמות'), /תשלומים/);
  api.deletePayment(api.payments(b2)[0].id);
  api.reopenBill(b2, 'טעות בכמות');
  assert.equal(api.bill(b2).status, 'submitted');
  assert.equal(api.contract(c).status, 'active');
  assert.ok(api.audit().some((a) => a.detail === 'טעות בכמות'));
});

test('receipt split across bills: oldest first, exact allocation, balance limits', () => {
  const { api, c, bill } = setup();
  const b1 = bill('2026-01', '10'); // 1,000
  const b2 = bill('2026-02', '30'); // +2,000
  const r = api.addReceipt(c, { amount: '1500' });
  assert.deepEqual(r.allocations.map((a) => a.cents), [100000, 50000]);
  assert.equal(api.bill(b1).paid, 100000);
  assert.equal(api.payments(b2)[0].group_id, r.group);
  assert.throws(() => api.addReceipt(c, { amount: '2000' }), /גבוה מהיתרה/);
  assert.throws(() => api.addReceipt(c, { amount: '100', allocations: [{ bill_id: b2, amount: '90' }] }), /שונה/);
  api.addReceipt(c, { amount: '100', allocations: [{ bill_id: b2, amount: '100' }] });
  assert.equal(api.bill(b2).paid, 60000);
});

test('purchase offset reduces the bill, frozen at approval, no double counting along a chain', () => {
  const { api, c, i } = setup();
  const order = api.savePurchase({ contract_id: c, type: 'order', doc_no: 'H-1', amount: '300' });
  const deliv = api.savePurchase({ contract_id: c, type: 'delivery', doc_no: 'T-1', amount: '300', parent_id: order });
  const inv = api.savePurchase({ contract_id: c, type: 'invoice', doc_no: 'C-1', amount: '300', parent_id: deliv });
  const b = api.createBill(c, { month: '2026-01' }); api.setLine(b, i, { q_sub: '10' });
  api.assignPurchase(inv, b);
  assert.equal(api.calc(b).materials, 30000);
  assert.equal(api.calc(b).beforeVat, 100000 - 30000);
  assert.throws(() => api.assignPurchase(order, b), /פעמיים/);
  api.approveBill(b);
  assert.throws(() => api.assignPurchase(inv, null), /מאושר/);
  assert.throws(() => api.deletePurchase(inv), /מאושר/);
  assert.equal(api.bill(b).snap.materials, 30000);
});

test('status as of a cut-off date ignores later approvals and payments', () => {
  const { api, c, p, bill } = setup();
  const b1 = bill('2026-01', '10');
  api.s.run(`UPDATE bills SET approved_at='2026-02-05T10:00:00Z' WHERE id=?`, [b1]);
  api.addPayment(b1, { amount: '400', date: '2026-02-20' });
  const before = api.statusAsOf('2026-02-01', p)[0];
  assert.equal(before.cumNet, 0); assert.equal(before.paid, 0);
  const after = api.statusAsOf('2026-02-28', p)[0];
  assert.equal(after.cumNet, 100000); assert.equal(after.paid, 40000); assert.equal(after.balance, 60000);
  assert.equal(after.progress, 0.1);
  void c;
});

test('profit: client vs subcontract per item, planned and executed', () => {
  const { api, c, i, bill } = setup();
  bill('2026-01', '40');
  const s = api.copyContract(c, { kind: 'sub', name: 'קבלן עפר', keepPrices: false });
  const si = api.items(s)[0];
  api.saveItem({ ...si, price: '80' });
  const sb = api.createBill(s, { month: '2026-01' }); api.setLine(sb, si.id, { q_appr: '40' }); api.approveBill(sb);
  const r = api.profit(c);
  assert.equal(r.totals.plannedMargin, 100 * 20 * 100);
  assert.equal(r.totals.execMargin, 40 * 20 * 100);
  assert.equal(r.lines[0].unitMargin, '20');
  void i;
});

test('defects: create, close stamps date, delete', () => {
  const { api, p, c } = setup();
  const d = api.saveDefect({ project_id: p, contract_id: c, description: 'סדק בקיר', severity: 'high', location: 'מבנה 1' });
  api.saveDefect({ ...api.defects(p)[0], status: 'closed' });
  assert.ok(api.defects(p)[0].closed);
  assert.throws(() => api.saveDefect({ project_id: p, description: '' }));
  api.deleteDefect(d);
  assert.equal(api.defects(p).length, 0);
});
