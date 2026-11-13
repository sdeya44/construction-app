import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Store } from '../js/store.js';
import { Api } from '../js/api.js';
import { parseSkn } from '../js/skn.js';
import { exportBoq, exportBill, readSheetRows } from '../js/excel.js';

const require = createRequire(import.meta.url);
const ExcelJS = require('../vendor/exceljs.min.js');
const SQL = await require('../vendor/sql-wasm.js')({ locateFile: (f) => fileURLToPath(new URL(`../vendor/${f}`, import.meta.url)) });

test('BOQ → xlsx → rows: every item with its quantity and price; totals are formulas', async () => {
  const api = new Api(new Store(SQL, null));
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'c' });
  const parsed = parseSkn(readFileSync(new URL('./fixtures/ref.skn', import.meta.url)));
  api.importItems(c, parsed, 'replace');
  const bytes = await exportBoq(ExcelJS, { contract: api.contract(c), sections: api.sections(c), items: api.items(c) });
  const [sheet] = await readSheetRows(ExcelJS, bytes);
  const items = sheet.rows.filter((r) => /^\d\d\.\d\d\.\d\d\.\d{4}$/.test(r[0]));
  assert.equal(items.length, parsed.items.filter((i) => i.kind !== 'note').length);
  const big = items.find((r) => r[0] === '01.02.01.0010');
  assert.equal(Number(big[3]), 60); assert.equal(Number(big[4]), 1800); assert.equal(Number(big[5]), 108000);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  const total = wb.worksheets[0].lastRow.getCell(6).value;
  assert.match(total.formula, /^F\d+(\+F\d+)*$/);
});

test('bill → xlsx has detail formulas and the payable amount', async () => {
  const api = new Api(new Store(SQL, null));
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'c', general_discount: '0.5' });
  const i = api.saveItem({ contract_id: c, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '100', price: '50', description: 'חפירה' });
  const b = api.createBill(c, { month: '2026-01' }); api.setLine(b, i, { q_sub: '40' });
  const calc = api.calc(b);
  const bytes = await exportBill(ExcelJS, { contract: api.contract(c), bill: api.bill(b), calc, sections: api.sections(c) });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  const det = wb.getWorksheet('פירוט');
  const row = det.getRows(1, det.rowCount).find((r) => r.getCell(1).value === '01.1.010');
  assert.equal(row.getCell(10).value.formula, `H${row.number}*I${row.number}`);
  assert.equal(row.getCell(10).value.result, 2000);
  const sum = wb.getWorksheet('סיכום');
  const due = sum.getRows(1, sum.rowCount).find((r) => r.getCell(1).value === 'סכום לתשלום בחשבון זה');
  assert.equal(due.getCell(2).value, calc.due / 100);
});

test('monthly bill exports a "this month only" sheet', async () => {
  const { periodTotals } = await import('../js/engine.js');
  const api = new Api(new Store(SQL, null));
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'c', vat_rate: '0' });
  const a = api.saveItem({ contract_id: c, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '100', price: '50', description: 'חפירה' });
  const b2i = api.saveItem({ contract_id: c, chapter: '01', sub: '01', num: 20, unit: 'מ"ר', qty: '10', price: '200', description: 'ריצוף' });
  const b1 = api.createBill(c, { month: '2026-01' }); api.setLine(b1, a, { q_sub: '40' }); api.approveBill(b1);
  const b2 = api.createBill(c, { month: '2026-02' }); api.setBillView(b2, 'period'); api.setLine(b2, b2i, { q_sub: '3' });
  const bill = api.bill(b2), calc = api.calc(b2);
  const bytes = await exportBill(ExcelJS, { contract: api.contract(c), bill, calc, sections: api.sections(c), period: periodTotals(calc, api.prevApproved(c, 2), false) });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  const ws = wb.getWorksheet('פירוט חודשי');
  const vals = []; ws.eachRow((r) => vals.push(r.values.slice(1)));
  const items = vals.filter((v) => /^01\.1\./.test(String(v[0])));
  assert.equal(items.length, 1);                                     // only what moved this month
  assert.equal(items[0][4], 3);
  assert.ok(wb.getWorksheet('פירוט מצטבר'));
});
