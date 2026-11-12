import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Store } from '../js/store.js';
import { Api } from '../js/api.js';
import { exportBidForm, readBidForm } from '../js/excel.js';

const require = createRequire(import.meta.url);
const ExcelJS = require('../vendor/exceljs.min.js');
const SQL = await require('../vendor/sql-wasm.js')({ locateFile: (f) => fileURLToPath(new URL(`../vendor/${f}`, import.meta.url)) });

function setup() {
  const api = new Api(new Store(SQL, null));
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'c', vat_rate: '0' });
  const a = api.saveItem({ contract_id: c, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '100', price: '100', description: 'חפירה' });
  const b = api.saveItem({ contract_id: c, chapter: '02', sub: '01', num: 10, unit: 'מ"ר', qty: '10', price: '50', description: 'רצפה' });
  return { api, p, c, a, b };
}

test('tender: scope, bids, lowest per item, totals after bidder discount, best complete bid', () => {
  const { api, c, a, b } = setup();
  assert.throws(() => api.createTender(c, { name: 't', scope: '01.05' }), /אין סעיפים/);
  const t = api.createTender(c, { name: 'עפר ובטון' });
  const x = api.saveBidder({ tender_id: t, name: 'א', discount: '0' });
  const y = api.saveBidder({ tender_id: t, name: 'ב', discount: '10' });
  api.setBidPrice(x, a, '90'); api.setBidPrice(x, b, '60');
  api.setBidPrice(y, a, '95'); api.setBidPrice(y, b, '55');
  const r = api.compareTender(t);
  assert.equal(r.rows.find((z) => z.item.id === a).low, x);
  assert.equal(r.rows.find((z) => z.item.id === b).low, y);
  assert.equal(r.totals[x].net, 960000);           // 9,000 + 600
  assert.equal(r.totals[y].net, 904500);           // (9,500 + 550) − 10% = 9,045.00
  assert.equal(r.best, y);
});

test('tender totals: discount applies to the bidder total', () => {
  const { api, c, a, b } = setup();
  const t = api.createTender(c, { name: 't' });
  const y = api.saveBidder({ tender_id: t, name: 'ב', discount: '10' });
  api.setBidPrice(y, a, '95'); api.setBidPrice(y, b, '55');
  const r = api.compareTender(t);
  assert.equal(r.totals[y].gross, 1005000);
  assert.equal(r.totals[y].discount, 100500);
  assert.equal(r.totals[y].net, 904500);
  assert.equal(r.estimate, 1050000);
});

test('award: requires a complete bid, creates a linked subcontract with bid prices', () => {
  const { api, c, a, b } = setup();
  const t = api.createTender(c, { name: 'שלד' });
  const x = api.saveBidder({ tender_id: t, name: 'קבלן א', discount: '2' });
  api.setBidPrice(x, a, '90');
  assert.throws(() => api.awardTender(t, x), /חסרים/);
  api.setBidPrice(x, b, '40');
  const sub = api.awardTender(t, x);
  const s = api.contract(sub);
  assert.equal(s.kind, 'sub'); assert.equal(s.parent_id, c); assert.equal(s.general_discount, '2');
  const items = api.items(sub);
  assert.deepEqual(items.map((i) => [i.price, i.source_item_id]), [['90', a], ['40', b]]);
  assert.equal(api.tender(t).status, 'awarded');
  assert.equal(api.profit(c).totals.plannedMargin, (10000 - 9000) * 100 + (500 - 400) * 100);
  assert.throws(() => api.awardTender(t, x), /כבר נסגר/);
});

test('bid form Excel round-trip: prices typed in column E come back by item code', async () => {
  const { api, c, a } = setup();
  const t = api.createTender(c, { name: 't' });
  const x = api.saveBidder({ tender_id: t, name: 'א' });
  const bytes = await exportBidForm(ExcelJS, { tender: api.tender(t), bidder: { name: 'א' }, sections: api.sections(c), company: 'כיאן' });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  const ws = wb.worksheets[0];
  ws.eachRow((row) => { if (row.getCell(1).value === '01.01.01.0010') row.getCell(5).value = 87.5; if (row.getCell(1).value === '01.02.01.0010') row.getCell(5).value = '1,234.5'; });
  const filled = new Uint8Array(await wb.xlsx.writeBuffer());
  const rows = await readBidForm(ExcelJS, filled);
  const res = api.importBidPrices(x, rows);
  assert.equal(res.matched, 2); assert.equal(res.missing, 0);
  assert.equal(api.compareTender(t).rows.find((r) => r.item.id === a).bids[x], '87.5');
});

test('cash flow: actual payments, open balances after payment terms, forecast to end month', () => {
  const { api, c, a } = setup();
  api.saveContract({ ...api.contract(c), end_month: '2026-06', pay_terms: 30 });
  const b1 = api.createBill(c, { month: '2026-01' }); api.setLine(b1, a, { q_sub: '50' }); api.approveBill(b1); // 5,000 due
  api.addPayment(b1, { amount: '2000', date: '2026-02-15' });
  const s = api.saveContract({ project_id: api.contract(c).project_id, kind: 'sub', name: 's', vat_rate: '0', pay_terms: 0 });
  const si = api.saveItem({ contract_id: s, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '20', price: '100', description: 'x' }); // half executed
  const sb = api.createBill(s, { month: '2026-01' }); api.setLine(sb, si, { q_appr: '10' }); api.approveBill(sb);
  const cf = api.cashflow({ now: '2026-02-10' });
  const m = (k) => cf.months.find((r) => r.month === k) ?? {};
  assert.equal(m('2026-02').inActual, 200000);
  assert.equal(m('2026-03').inExpected >= 300000, true);      // 3,000 open; January bill, net+30 → due in March
  assert.equal(m('2026-02').outExpected, 100000);              // sub bill Jan, terms 0 → Jan, overdue → current month
  // remaining client scope 10,500 − 5,000 = 5,500 spread Feb..Jun (5 months), paid +30 days
  const forecast = cf.months.reduce((t, r) => t + r.inExpected, 0) - 300000;
  assert.equal(forecast, 550000);
  assert.ok(cf.months.at(-1).cumulative === cf.months.reduce((t, r) => t + r.net, 0));
  assert.ok(cf.warnings.some((w) => w.includes('s:')));      // sub has no end month → warned, not silently dropped
});

test('management report aggregates per project', () => {
  const { api, p, c, a } = setup();
  const b1 = api.createBill(c, { month: '2026-01' }); api.setLine(b1, a, { q_sub: '120' }); api.approveBill(b1);
  api.saveDefect({ project_id: p, description: 'd', due: '2000-01-01' });
  const [r] = api.managementReport();
  assert.equal(r.project.id, p);
  assert.equal(r.client.cumNet, 1200000);
  assert.equal(r.overrunItems, 1); assert.equal(r.overrunCents, 200000);
  assert.equal(r.openDefects, 1); assert.equal(r.overdueDefects, 1);
});

test('executed margin follows client-approved quantity, not the subcontractor billing timing', () => {
  const { api, c, a, b } = setup();
  const t = api.createTender(c, { name: 't' });
  const x = api.saveBidder({ tender_id: t, name: 'x' });
  api.setBidPrice(x, a, '80'); api.setBidPrice(x, b, '50');
  api.awardTender(t, x);
  const cb = api.createBill(c, { month: '2026-01' }); api.setLine(cb, a, { q_sub: '40' }); api.approveBill(cb);
  const r = api.profit(c);
  assert.equal(r.totals.execSub, 0);              // the sub has not billed yet
  assert.equal(r.totals.execMargin, 40 * 20 * 100); // 40 units × (100 − 80)
});
