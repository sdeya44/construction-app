import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSkn, buildSkn, decodeSkn, unitCode } from '../js/skn.js';

const ref = readFileSync(new URL('./fixtures/ref.skn', import.meta.url));

test('parse reference SKN (verified generator output)', () => {
  const r = parseSkn(ref);
  assert.equal(r.title, 'פרויקט בדיקה');
  assert.deepEqual(r.warnings, []);
  const real = r.items.filter((i) => i.kind !== 'note');
  assert.equal(real.length, 5);
  const big = real.find((i) => i.chapter === '02' && i.num === 10);
  assert.equal(big.qty, '60');
  assert.equal(big.price, '1800');
  assert.ok(big.description.length > 150, 'line-2 text joined to line 1');
  assert.equal(r.items.find((i) => i.chapter === '99').kind, 'extra');
  assert.equal(r.sections.find((s) => s.code === '01.01').name, 'עבודות עפר');
  assert.equal(r.sections.find((s) => s.code === '01.01.01').name, 'חפירה');
});

test('round trip is byte-identical to the verified generator', () => {
  const r = parseSkn(ref);
  const out = buildSkn(r.title, r.sections, r.items);
  assert.equal(Buffer.from(out.bytes).toString('hex'), ref.toString('hex'));
  for (const l of out.text.split('\r\n').slice(0, -1)) assert.ok(l.length === 0 || l.length === 183);
});

test('export rejects what Binarit cannot read', () => {
  const base = { struct: '01', chapter: '01', sub: '01', num: 1, unit: 'מ"ק', qty: '1', price: '1', description: 'x', kind: 'contract' };
  assert.throws(() => buildSkn('t', [], [{ ...base, qty: '1000000' }]));
  assert.throws(() => buildSkn('t', [], [{ ...base, unit: 'חודש' }]));
  assert.throws(() => buildSkn('t', [], [{ ...base, qty: '-1' }]));
  const w = buildSkn('t', [], [{ ...base, unit: 'מ"א', qty: '1.255' }]).warnings.join('\n');
  assert.match(w, /מטר/);
  assert.match(w, /עוגלה/);
});

test('unit mapping and encodings', () => {
  assert.equal(unitCode("מ'"), '02');
  assert.equal(unitCode('מ״ר'), '03');
  assert.equal(unitCode('קומפ'), '09');
  assert.equal(decodeSkn(new Uint8Array([0x80, 0x81])), 'אב'); // cp862 fallback
});

test('long text uses Binarit continuation lines; notes may repeat numbers', () => {
  const long = 'א'.repeat(149) + ' ' + 'ב'.repeat(150) + 'ג'.repeat(150) + 'ד'.repeat(150) + 'ה'.repeat(20);
  const items = [
    { struct: '01', chapter: '00', sub: '01', num: 10, kind: 'note', description: long, unit: '', qty: '0', price: '0' },
    { struct: '01', chapter: '00', sub: '01', num: 10, kind: 'note', description: 'הערה שנייה', unit: '', qty: '0', price: '0' },
  ];
  const out = buildSkn('t', [{ code: '01', name: 'מבנה' }, { code: '01.00', name: 'מוקדמות' }, { code: '01.00.01', name: 'מוקדמות' }], items);
  const L = out.text.split('\r\n');
  // structure title, chapter-00 title (same code, unit 00), subchapter title
  assert.equal(L[2].slice(0, 12), '0100000000  ');
  assert.equal(L[4].slice(0, 12), '010000000000');
  assert.equal(L[8].slice(0, 12), '010001001000');
  assert.equal(L[9].slice(0, 33), ' '.repeat(33));
  assert.equal(L[10].slice(0, 33), '0100010010 0' + ' '.repeat(21));
  assert.equal(L[12].slice(0, 33), ' 1 0 1  10 0' + ' '.repeat(21));
  assert.equal(L[13], '');
  const back = parseSkn(out.bytes);
  assert.equal(back.items.length, 2);
  assert.equal(back.items[0].description, long);
  assert.equal(back.sections.find((s) => s.code === '01').name, 'מבנה');
  assert.equal(back.sections.find((s) => s.code === '01.00').name, 'מוקדמות');
});
