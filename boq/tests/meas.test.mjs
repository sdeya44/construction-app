import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Store } from '../js/store.js';
import { Api } from '../js/api.js';
import { calcRow, rowFormulaText, unitKind } from '../js/meas.js';

const require = createRequire(import.meta.url);
const SQL = await require('../vendor/sql-wasm.js')({ locateFile: (f) => fileURLToPath(new URL(`../vendor/${f}`, import.meta.url)) });

function setup(mode = 'cumulative') {
  const api = new Api(new Store(SQL, null));
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'c', vat_rate: '0', mode });
  const vol = api.saveItem({ contract_id: c, chapter: '02', sub: '01', num: 10, unit: 'מ"ק', qty: '100', price: '1000', description: 'בטון' });
  const area = api.saveItem({ contract_id: c, chapter: '02', sub: '01', num: 20, unit: 'מ"ר', qty: '50', price: '100', description: 'טיח' });
  return { api, c, vol, area };
}
const row = (api, c, item, f) => { const id = api.addMeas(c, item); api.saveMeas(id, f); return id; };

test('unit kinds follow Binarit units; formulas are the source app formulas', () => {
  assert.equal(unitKind('מ"ק'), 'volume'); assert.equal(unitKind('מ"ר'), 'area'); assert.equal(unitKind('מטר'), 'length'); assert.equal(unitKind("קומפ'"), 'count');
  const m = { shape: 'מלבן', d1: '5', d2: '2', t: '0.3', qty: '4', sign: 1 };
  assert.equal(calcRow(m, { unit: 'מ"ק' }), 12);
  assert.equal(rowFormulaText(m, 'volume'), '(5 × 2) × 0.3 × 4 = 12');
});

test('bill quantities come from the calculation sheet: claimed → submitted, approved → approved', () => {
  const { api, c, vol } = setup();
  row(api, c, vol, { shape: 'מלבן', d1: '10', d2: '2', t: '0.5', qty: '2' });        // 20
  const d = row(api, c, vol, { shape: 'מלבן', d1: '2', d2: '1', t: '0.5', sign: -1 });   // −1 deduction
  api.saveMeas(d, { sign: -1 });
  const r2 = row(api, c, vol, { shape: 'עיגול', d1: '1', t: '2' });                      // π/4·2 ≈ 1.5708
  const b = api.createBill(c, { month: '2026-01' });
  let calc = api.calc(b);
  assert.equal(calc.rows.find((x) => x.itemId === vol).cumQ, '20.5708');
  api.setMeasApproval(r2, { status: 'reduced', value: '1', note: 'לפי מדידת מפקח' });
  api.saveBill(b, { basis: 'appr' });
  calc = api.calc(b);
  assert.equal(calc.rows.find((x) => x.itemId === vol).cumQ, '20');
  assert.equal(calc.rows.find((x) => x.itemId === vol).q_sub, '20.5708');
});

test('editing a reduced row re-opens the decision as pending (not counted until decided)', () => {
  const { api, c, vol } = setup();
  const r = row(api, c, vol, { shape: 'מלבן', d1: '10', d2: '1', t: '1' });
  api.setMeasApproval(r, { status: 'reduced', value: '8' });
  api.saveMeas(r, { d1: '12' });
  assert.equal(api.meas(r).approval.status, 'pending');
  const b = api.createBill(c, { month: '2026-01' }); api.saveBill(b, { basis: 'appr' });
  const calc = api.calc(b);
  assert.equal(calc.rows.find((x) => x.itemId === vol).cumQ, '0');
  assert.ok(calc.warnings.some((w) => w.type === 'meas-pending'));
});

test('approval stamps history and freezes rows; later corrections show as correction; cancelled rows are kept', () => {
  const { api, c, vol } = setup();
  const a = row(api, c, vol, { shape: 'מלבן', d1: '10', d2: '1', t: '1' });   // 10
  const b1 = api.createBill(c, { month: '2026-01' }); api.approveBill(b1);
  assert.equal(api.meas(a).history[0].action, 'created');
  assert.equal(api.bill(b1).snap.frozen.measurements[0].value, 10);
  assert.equal(api.bill(b1).snap.rows.find((x) => x.itemId === vol).cumQ, '10');
  const b2 = api.createBill(c, { month: '2026-02' });
  api.saveMeas(a, { d1: '12' });                                                 // correction +2
  const n = row(api, c, vol, { shape: 'מלבן', d1: '5', d2: '1', t: '1' });       // addition +5
  assert.equal(api.calc(b2).rows.find((x) => x.itemId === vol).curQ, '7');
  assert.equal(api.deleteMeas(a), 'cancelled');                                   // has history → cancelled, not deleted
  assert.equal(api.calc(b2).rows.find((x) => x.itemId === vol).cumQ, '5');
  api.restoreMeas(a);
  api.approveBill(b2);
  assert.deepEqual(api.meas(a).history.map((h) => h.action), ['created', 'corrected']);
  assert.equal(api.bill(b1).snap.frozen.measurements.find((m) => m.id === a).value, 10); // b1 stays frozen
  void n;
});

test('validation blocks approval: volume row without thickness', () => {
  const { api, c, vol } = setup();
  row(api, c, vol, { shape: 'מלבן', d1: '10', d2: '2' });
  const b = api.createBill(c, { month: '2026-01' });
  assert.throws(() => api.approveBill(b), /חסרה עובי/);
});

test('submitted bill: geometry locked, reviewer decisions allowed; reopen removes the bill history', () => {
  const { api, c, vol } = setup();
  const a = row(api, c, vol, { shape: 'מלבן', d1: '10', d2: '1', t: '1' });
  const b = api.createBill(c, { month: '2026-01' }); api.submitBill(b);
  assert.throws(() => api.saveMeas(a, { d1: '11' }), /הוגש/);
  api.setMeasApproval(a, { status: 'reduced', value: '9' });
  api.approveBill(b);
  api.reopenBill(b, 'בדיקה');
  assert.equal(api.meas(a).history.length, 0);
});

test('periodic contract: bill quantity = sheet total minus previous approved', () => {
  const { api, c, area } = setup('periodic');
  row(api, c, area, { shape: 'מלבן', d1: '5', d2: '4' });     // 20 m²
  const b1 = api.createBill(c, { month: '2026-01' }); api.approveBill(b1);
  row(api, c, area, { shape: 'משולש', d1: '4', d2: '3' });     // +6
  const b2 = api.createBill(c, { month: '2026-02' });
  const r = api.calc(b2).rows.find((x) => x.itemId === area);
  assert.equal(r.curQ, '6'); assert.equal(r.cumQ, '26');
});
