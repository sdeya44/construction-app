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
  const w = buildSkn('t', [], [{ ...base, unit: 'מטר', qty: '1.255' }]).warnings.join('\n');
  assert.match(w, /מ"א/);
  assert.match(w, /עוגלה/);
});

test('unit mapping and encodings', () => {
  assert.equal(unitCode("מ'"), '02');
  assert.equal(unitCode('מ״ר'), '03');
  assert.equal(unitCode('קומפ'), '09');
  assert.equal(decodeSkn(new Uint8Array([0x80, 0x81])), 'אב'); // cp862 fallback
});
