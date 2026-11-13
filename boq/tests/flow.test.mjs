// Work-flow rules found in the end-to-end review: quantity source, locks, statuses, versions, revisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Store } from '../js/store.js';
import { Api } from '../js/api.js';

const require = createRequire(import.meta.url);
const SQL = await require('../vendor/sql-wasm.js')({ locateFile: (f) => fileURLToPath(new URL(`../vendor/${f}`, import.meta.url)) });

function setup(mode = 'cumulative') {
  const api = new Api(new Store(SQL, null));
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'c', vat_rate: '0', mode });
  const vol = api.saveItem({ contract_id: c, struct: '01', chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '100', price: '100', description: 'חפירה' });
  const conc = api.saveItem({ contract_id: c, struct: '01', chapter: '02', sub: '01', num: 10, unit: 'מ"ק', qty: '50', price: '1000', description: 'בטון' });
  return { api, p, c, vol, conc };
}

for (const mode of ['cumulative', 'periodic']) {
  test(`opening a calculation sheet keeps what was billed manually (${mode}) — no silent drop`, () => {
    const { api, c, vol } = setup(mode);
    const b1 = api.createBill(c, { month: '2026-01' });
    api.setLine(b1, vol, { q_calc: '42.45', q_sub: '42.45', q_appr: '42.45' });
    api.approveBill(b1);
    const m = api.addMeas(c, vol);
    api.saveMeas(m, { d1: '12', d2: '3', t: '0.25' });                      // 9 m³ new work
    assert.equal(api.item(vol).qsrc, 'meas');
    assert.equal(api.item(vol).meas_opening, '42.45');
    const b2 = api.createBill(c, { month: '2026-02' });
    const row = api.calc(b2).rows.find((x) => x.itemId === vol);
    assert.equal(row.cumQ, '51.45');
    assert.equal(row.curQ, '9');
    assert.ok(api.calc(b2).due > 0);
  });
}

test('manual source ignores the sheet; a falling cumulative is flagged', () => {
  const { api, c, vol } = setup();
  const m = api.addMeas(c, vol); api.saveMeas(m, { d1: '10', d2: '1', t: '1' });
  api.setQtySource(vol, 'manual');
  const b1 = api.createBill(c, { month: '2026-01' });
  api.setLine(b1, vol, { q_sub: '30' });
  assert.equal(api.calc(b1).rows.find((x) => x.itemId === vol).cumQ, '30');
  api.approveBill(b1);
  const b2 = api.createBill(c, { month: '2026-02' });
  api.setLine(b2, vol, { q_sub: '20' });
  assert.ok(api.calc(b2).warnings.some((w) => w.type === 'decrease' && /-10/.test(w.text)));
});

test('contract BOQ: locked on quote conversion and on first bill; changes only through change items', () => {
  const { api, p, c, vol } = setup();
  api.saveItem({ ...api.item(vol), qty: '110' });                           // not locked yet
  const b = api.createBill(c, { month: '2026-01' });
  assert.equal(api.contract(c).locked, 1);
  assert.throws(() => api.saveItem({ ...api.item(vol), qty: '120' }), /נעול/);
  assert.throws(() => api.saveItem({ ...api.item(vol), price: '99' }), /נעול/);
  api.saveItem({ ...api.item(vol), description: 'חפירה — תיקון כתיב' });   // wording is free
  assert.throws(() => api.deleteItem(vol), /נעול/);
  assert.throws(() => api.importItems(c, { items: [] }), /נעול/);
  assert.throws(() => api.saveSection(c, '01.01', { discount: '5' }), /נעול/);
  const x = api.saveItem({ contract_id: c, struct: '01', chapter: '01', sub: '01', num: 20, unit: 'מ"ק', qty: '5', price: '100', description: 'תוספת' });
  assert.equal(api.item(x).kind, 'extra');
  assert.equal(api.item(x).change_status, 'pending');
  api.saveItem({ ...api.item(x), qty: '6' });                                 // pending change item stays editable
  api.approveChange(x);
  assert.throws(() => api.saveItem({ ...api.item(x), qty: '7' }), /נעול/);
  assert.throws(() => api.unlockContract(c, 'טעות'), /חשבונות/);
  api.deleteBill(b);
  api.unlockContract(c, 'טעות הקלדה בכמות');
  api.saveItem({ ...api.item(vol), qty: '120' });
  // quote → client contract is locked at once; the quote stays editable
  const q = api.saveContract({ project_id: p, kind: 'quote', name: 'הצעה' });
  const qi = api.saveItem({ contract_id: q, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '10', price: '10', description: 'x' });
  const k = api.copyContract(q, { kind: 'client', name: 'חוזה' });
  assert.equal(api.contract(k).locked, 1);
  assert.equal(api.contract(k).origin_id, q);
  api.saveItem({ ...api.item(qi), qty: '11' });
});

test('bill status: submitted → returned for corrections → resubmitted → approved, with history; collection is derived', () => {
  const { api, c, vol } = setup();
  const b1 = api.createBill(c, { month: '2026-01' });
  api.setLine(b1, vol, { q_sub: '10' });
  api.submitBill(b1);
  api.returnBill(b1, 'המפקח ביקש פירוט');
  assert.equal(api.bill(b1).status, 'draft');
  assert.equal(api.bill(b1).returned, 1);
  api.setLine(b1, vol, { q_sub: '9' });
  api.submitBill(b1);
  api.approveBill(b1);
  assert.deepEqual(api.billEvents(b1).map((e) => e.status), ['draft', 'submitted', 'returned', 'submitted', 'approved']);
  assert.match(api.billEvents(b1)[3].note, /מחדש/);
  // collectible = this bill + unpaid balance of earlier approved bills (deduction stays "approved", not "paid")
  api.addPayment(b1, { amount: '400', date: '2026-02-01' });
  const b2 = api.createBill(c, { month: '2026-02' });
  api.setLine(b2, vol, { q_sub: '12' });
  assert.equal(api.calc(b2).due, 30000);                    // (12 − 9) × 100
  assert.equal(api.outstandingBefore(c, 2), 90000 - 40000);
});

test('versions: partial copy by chapter, copy to another project, compare and quote revisions', () => {
  const { api, c, vol } = setup();
  const p2 = api.saveProject({ name: 'פרויקט אחר' });
  const conc = api.copyContract(c, { kind: 'quote', name: 'בטונים בלבד', chapters: ['01.02'], asVersion: true, versionLabel: 'בטונים' });
  assert.deepEqual(api.items(conc).map((i) => i.description), ['בטון']);
  assert.equal(api.versions(c).length, 2);
  assert.equal(api.contract(conc).version_label, 'בטונים');
  const other = api.copyContract(c, { kind: 'quote', name: 'העתק', projectId: p2 });
  assert.equal(api.contract(other).project_id, p2);
  assert.equal(api.items(other).length, 2);
  // compare: one removed item, then a price change and an addition
  let cmp = api.compareBoq({ contractId: c }, { contractId: conc });
  assert.deepEqual(cmp.counts, { added: 0, removed: 1, changed: 0, same: 1 });
  const ci = api.items(conc)[0];
  api.saveItem({ ...ci, price: '1100' });
  api.saveItem({ contract_id: conc, struct: '01', chapter: '02', sub: '01', num: 20, unit: 'מ"ר', qty: '10', price: '50', description: 'טיח' });
  cmp = api.compareBoq({ contractId: c }, { contractId: conc });
  assert.equal(cmp.counts.added, 1);
  assert.equal(cmp.counts.changed, 1);
  assert.equal(cmp.totals.b - cmp.totals.a, (50 * 1100 + 500 - 50 * 1000 - 100 * 100) * 100);
  // revisions freeze what was sent; later edits show against the revision
  const r1 = api.issueRevision(conc, { recipient: 'מזמין', note: 'נשלח במייל' });
  assert.equal(api.revisions(conc)[0].rev, 1);
  api.saveItem({ ...api.items(conc)[0], qty: '60' });
  const vs = api.compareBoq({ revisionId: r1 }, { contractId: conc });
  assert.equal(vs.counts.changed, 1);
  assert.equal(api.revision(r1).snapshot.items[0].qty, '50');
  void vol;
});

test('duplicate item number gives a clear Hebrew message', () => {
  const { api, c } = setup();
  assert.throws(() => api.saveItem({ contract_id: c, struct: '01', chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '1', price: '1', description: 'כפול' }), /כבר קיים/);
});

test('submit turns the claim into the approved column; return goes back to the claim; next month and reopen reason', () => {
  const { api, c, vol } = setup();
  assert.equal(api.nextBillMonth(c).length, 7);
  const b1 = api.createBill(c, { month: '2026-01' });
  api.setLine(b1, vol, { q_sub: '40' });
  api.submitBill(b1);
  assert.equal(api.bill(b1).basis, 'appr');
  assert.equal(api.lines(b1).get(vol).q_appr, '40');
  api.setLine(b1, vol, { q_appr: '35' });                    // reviewer reduces
  assert.equal(api.calc(b1).rows.find((x) => x.itemId === vol).cumQ, '35');
  api.returnBill(b1, 'לתקן');
  assert.equal(api.bill(b1).basis, 'sub');
  api.setLine(b1, vol, { q_sub: '38' });
  api.submitBill(b1);
  assert.equal(api.lines(b1).get(vol).q_appr, '38');          // a new claim restarts the review
  api.approveBill(b1);
  assert.equal(api.nextBillMonth(c), '2026-02');
  assert.equal(api.reopenBlock(b1), null);
  const b2 = api.createBill(c, { month: api.nextBillMonth(c) });
  assert.match(api.reopenBlock(b1), /חשבון 2/);
  // home screen: the open bill and the unpaid approved one are listed
  const kinds = api.attention().map((a) => a.kind);
  assert.ok(kinds.includes('draft') && kinds.includes('unpaid'));
  void b2;
});

test('monthly (non-cumulative) view: period rows and chapter / discount figures add up to the cumulative bill', async () => {
  const { periodTotals } = await import('../js/engine.js');
  const { api, c, vol, conc } = setup();
  api.saveSection(c, '01.02', { discount: '3' });
  api.saveContract({ ...api.contract(c), general_discount: '0.5' });
  const b1 = api.createBill(c, { month: '2026-01' });
  api.setLine(b1, vol, { q_sub: '40' }); api.setLine(b1, conc, { q_sub: '10' });
  api.approveBill(b1);
  const b2 = api.createBill(c, { month: '2026-02' });
  api.setBillView(b2, 'period');
  assert.equal(api.bill(b2).doc.view, 'period');
  api.setLine(b2, conc, { q_sub: '16' });                       // only concrete moved this month
  const r = api.calc(b2);
  const P = periodTotals(r, api.prevApproved(c, 2), false);
  const moved = P.rows.filter((x) => x.curQ !== '0');
  assert.deepEqual(moved.map((x) => x.itemId), [conc]);
  assert.equal(moved[0].pAmount, 6 * 1000 * 100);
  assert.equal(P.T.net, r.periodNet);                          // same money as the cumulative bill
  assert.equal(P.groups.reduce((s, g) => s + g.final, 0), r.periodNet);
  assert.equal(P.groups.find((g) => g.key === '01.02').discount, Math.round(6000 * 100 * 0.03));
  assert.equal(P.groups.find((g) => g.key === '01.01').gross, 0);
});
