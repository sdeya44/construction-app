import test from 'node:test';
import assert from 'node:assert/strict';
import { pageLines, parsePdfLines } from '../js/pdfimport.js';

// Build pdf.js-like text items: one item per character, laid out right-to-left for Hebrew runs.
function line(y, cells) {
  const items = [];
  for (const [text, xRight] of cells) {
    const heb = /[֐-׿]/.test(text);
    let x = xRight;
    const chars = heb ? [...text] : [...text].reverse();
    for (const ch of chars) { x -= 6; items.push({ str: ch, width: 6, transform: [10, 0, 0, 10, x, y] }); }
  }
  return items;
}
const word = (words, xRight) => { const out = []; let x = xRight; for (const w of words) { out.push([w, x]); x -= w.length * 6 + 3; } return out; };

test('reads code, description, unit and quantities from a Binarit-style page', () => {
  const items = [
    ...line(560, word(['מבנה', '1', 'מאצרות'], 800)),
    ...line(540, word(['פרק', '01', 'עבודות', 'עפר'], 800)),
    ...line(520, word(['תת', 'פרק', '01.1', 'חפירה'], 800)),
    ...line(500, [['01.1.010', 800], ...word(['חפירה', 'כללית', 'בעומק', '2.50'], 740)]),
    // data row: unit + numbers (BOQ layout: qty, price, total), description continues
    ...line(488, [...word(['עד', '250', "מ'"], 740), ['מ"ק', 500], ['141.50', 440], ['60.00', 300], ['8,490.00', 160]]),
  ];
  const r = parsePdfLines([pageLines(items)]);
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.deepEqual([it.struct, it.chapter, it.sub, it.num], ['01', '01', '01', 10]);
  assert.equal(it.unit, 'מ"ק');
  assert.equal(it.qty, '141.50');
  assert.equal(it.price, '60.00');
  assert.match(it.description, /^חפירה כללית בעומק 2.50 עד 250 מ'$/);
  assert.equal(r.sections.find((s) => s.code === '01.01.01').name, 'חפירה');
  assert.deepEqual(r.warnings, []);
});
