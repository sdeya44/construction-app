import test from 'node:test';
import assert from 'node:assert/strict';
import { calcBill, discountTotals, indexation } from '../js/engine.js';
import { lineCents, pct, fixed, cents } from '../js/money.js';

const C = (o = {}) => ({ mode: 'cumulative', vat_rate: '18', retention_rate: '0', general_discount: '0', opening_cents: 0,
  advance_cents: 0, advance_rate: '0', index_rule: 'none', index_series: 'residential', index_lag: 0, ...o });
const item = (id, o) => ({ id, struct: '01', chapter: '01', sub: '01', num: id, unit: 'מ"ק', kind: 'contract', change_status: 'approved', qty: '100', price: '10', description: 'x', ...o });
const bill = (o = {}) => ({ basis: 'appr', month: '2026-01', adj: {}, ...o });
const lines = (obj) => new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));

test('money: exact rounding incl. negative half-cents', () => {
  assert.equal(lineCents('3', '0.335'), 101); // 1.005 → 1.01
  assert.equal(lineCents('-3', '0.335'), -101);
  assert.equal(pct(524437040, '0.5'), 2622185);
  assert.equal(fixed('1,234.5'), 12345000n);
  assert.throws(() => fixed('abc'));
});

test('account 8 (חנתון) printed totals reconcile', () => {
  const contract = C({ general_discount: '0.5', opening_cents: cents('4737554.43') });
  const items = [item(1, { qty: '1', price: '5244370.40' }), item(2, { chapter: '99', kind: 'extra', qty: '1', price: '219098' })];
  const r = calcBill({ contract, sections: [], items, bill: bill(), lines: lines({ 1: { q_appr: '1' }, 2: { q_appr: '1' } }), prev: null });
  assert.equal(r.totals.eligible, 524437040);
  assert.equal(r.totals.general, 2622185);
  assert.equal(r.totals.exempt, 21909800);
  assert.equal(r.cumNet, 543724655);
  assert.equal(r.periodNet, 69969212);
  assert.equal(r.vat, 12594458);
  assert.equal(r.due, 82563670);
  assert.equal(r.totals.cat.contract + r.totals.cat.over + r.totals.cat.extra, r.cumNet);
  assert.equal(r.totals.cat.extra, 21909800);
});

test('chapter discount precedes general discount (1,462,607.75 − 3% − 0.5%)', () => {
  const d = discountTotals([{ struct: '04', chapter: '02', sub: '01', amount: 146260775, cat: { contract: 146260775, over: 0, extra: 0 } }],
    () => ({ discount: '3', exempt: 0 }), '0.5');
  assert.equal(d.groups[0].discount, 4387823);
  assert.equal(d.groups[0].net, 141872952);
  assert.equal(d.general, 709365);
  assert.equal(d.net, 141163587);
});

test('cumulative: period = cumulative − previous; untouched line keeps previous cumulative', () => {
  const contract = C();
  const items = [item(1), item(2)];
  const b1 = calcBill({ contract, sections: [], items, bill: bill(), lines: lines({ 1: { q_appr: '40' }, 2: { q_appr: '10' } }), prev: null });
  assert.equal(b1.periodNet, 50000);
  const b2 = calcBill({ contract, sections: [], items, bill: bill({ month: '2026-02' }), lines: lines({ 1: { q_appr: '70' } }), prev: b1 });
  assert.equal(b2.rows[0].curQ, '30');
  assert.equal(b2.rows[1].cumQ, '10'); // not credited back to 0
  assert.equal(b2.periodNet, 30000);
});

test('over-contract quantity is classified separately', () => {
  const r = calcBill({ contract: C(), sections: [], items: [item(1)], bill: bill(), lines: lines({ 1: { q_appr: '120' } }), prev: null });
  assert.equal(r.totals.cat.contract, 100000);
  assert.equal(r.totals.cat.over, 20000);
  assert.ok(r.warnings.some((w) => w.type === 'overrun'));
});

test('periodic: historical prices retained, cumulative sums periods', () => {
  const contract = C({ mode: 'periodic' });
  const b1 = calcBill({ contract, sections: [], items: [item(1)], bill: bill(), lines: lines({ 1: { q_appr: '10' } }), prev: null });
  const b2 = calcBill({ contract, sections: [], items: [item(1, { price: '12' })], bill: bill(), lines: lines({ 1: { q_appr: '10' } }), prev: b1 });
  assert.equal(b2.periodNet, 12000);
  assert.equal(b2.cumNet, 22000);
  assert.equal(b2.rows[0].cumQ, '20');
});

test('indexation rules: full / threshold / partial', () => {
  assert.equal(indexation(100000, 'full', '100', '105'), 5000);
  assert.equal(indexation(100000, 'threshold', '100', '105', { threshold: '4' }), 1000);
  assert.equal(indexation(100000, 'threshold', '100', '103', { threshold: '4' }), 0);
  assert.equal(indexation(100000, 'partial', '100', '105', { share: '75' }), 3750);
});

test('indexation uses execution month with lag; missing index warns, no amount', () => {
  const idx = { 'residential|2025-06': '130.0', 'residential|2025-12': '133.9' };
  const contract = C({ index_rule: 'full', index_base_month: '2025-06', index_lag: 1 });
  const r = calcBill({ contract, sections: [], items: [item(1)], bill: bill({ month: '2026-01' }), lines: lines({ 1: { q_appr: '100' } }), prev: null,
    indexValue: (s, m) => idx[`${s}|${m}`] ?? null });
  assert.equal(r.indexation.month, '2025-12');
  assert.equal(r.indexation.amount, 3000); // 1000 × 3.9/130
  const r2 = calcBill({ contract, sections: [], items: [item(1)], bill: bill({ month: '2026-03' }), lines: lines({ 1: { q_appr: '100' } }), prev: null,
    indexValue: (s, m) => idx[`${s}|${m}`] ?? null });
  assert.equal(r2.indexation.amount, 0);
  assert.ok(r2.warnings.some((w) => w.type === 'index'));
});

test('retention, advance recovery capped, VAT', () => {
  const contract = C({ retention_rate: '5', advance_cents: 30000, advance_rate: '10' });
  const r = calcBill({ contract, sections: [], items: [item(1, { price: '1000' })], bill: bill(), lines: lines({ 1: { q_appr: '5' } }), prev: null });
  // period 5,000.00; retention 250; advance 10% = 500 capped at 300
  assert.equal(r.retention, 25000);
  assert.equal(r.advance, 30000);
  assert.equal(r.beforeVat, 500000 - 25000 - 30000);
  assert.equal(r.vat, pct(r.beforeVat, '18'));
  const r2 = calcBill({ contract, sections: [], items: [item(1, { price: '1000' })], bill: bill(), lines: lines({ 1: { q_appr: '10' } }), prev: r });
  assert.equal(r2.advance, 0); // fully recovered
});

test('pending change item is not billed; notes ignored', () => {
  const items = [item(1), item(2, { kind: 'extra', change_status: 'pending' }), item(3, { kind: 'note' })];
  const r = calcBill({ contract: C(), sections: [], items, bill: bill(), lines: lines({ 1: { q_appr: '1' }, 2: { q_appr: '5' } }), prev: null });
  assert.equal(r.rows.length, 1);
});
