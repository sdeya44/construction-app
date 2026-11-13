// Undo / redo of committed changes, ranked Dekel search, reopened status.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Store } from '../js/store.js';
import { Api } from '../js/api.js';
import { Dekel } from '../js/dekel.js';

const require = createRequire(import.meta.url);
const SQL = await require('../vendor/sql-wasm.js')({ locateFile: (f) => fileURLToPath(new URL(`../vendor/${f}`, import.meta.url)) });

test('undo / redo restore the whole database step by step', () => {
  let saved = null;
  const store = new Store(SQL, null, (b) => { saved = b; });
  const api = new Api(store);
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'quote', name: 'q' });
  const i = api.saveItem({ contract_id: c, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '10', price: '5', description: 'x' });
  api.saveItem({ ...api.item(i), qty: '20' });
  assert.equal(store.undoLabel, 'עריכת סעיף 01.01.01.0010');
  assert.equal(store.undo(), 'עריכת סעיף 01.01.01.0010');
  assert.equal(api.item(i).qty, '10');
  assert.ok(saved);                                  // the restored state is persisted
  store.undo();                                      // the item itself
  assert.equal(api.items(c).length, 0);
  store.redo(); store.redo();
  assert.equal(api.item(i).qty, '20');
  api.saveItem({ ...api.item(i), qty: '30' });       // a new change clears the redo stack
  assert.equal(store.canRedo, false);
});

test('Dekel search ranks the best match first', () => {
  const db = new SQL.Database();
  db.run(`CREATE TABLE chapters (code TEXT, name TEXT); CREATE TABLE subchapters (code TEXT, name TEXT);
    CREATE TABLE items (code TEXT, chapter_code TEXT, subchapter_code TEXT, description TEXT, unit TEXT, price REAL);
    INSERT INTO items VALUES ('40.054.0010','40','054','ריצוף באבן משתלבת, מעל שכבת חול, כולל אבן שפה בצבע אפור ופינוי חומרים','מ"ר',120);
    INSERT INTO items VALUES ('40.054.0100','40','054','אבן שפה טרומית 100/25/15','מ"א',95);
    INSERT INTO items VALUES ('40.054.0110','40','054','אבן שפה טרומית 100/25/15 בצבע','מ"א',99);`);
  const dk = new Dekel(SQL, db.export());
  const r = dk.search('אבן שפה');
  assert.equal(r[0].code, '40.054.0100');           // phrase at the start, short description
  assert.equal(r.at(-1).code, '40.054.0010');       // phrase buried in a long description
  assert.equal(dk.search('40.054.0110')[0].code, '40.054.0110');
});

test('a reopened bill is labelled as reopened, not as resubmitted', () => {
  const api = new Api(new Store(SQL, null));
  const p = api.saveProject({ name: 'p' });
  const c = api.saveContract({ project_id: p, kind: 'client', name: 'c', vat_rate: '0' });
  const i = api.saveItem({ contract_id: c, chapter: '01', sub: '01', num: 10, unit: 'מ"ק', qty: '10', price: '5', description: 'x' });
  const b = api.createBill(c, { month: '2026-01' });
  api.setLine(b, i, { q_sub: '5' });
  api.approveBill(b);
  api.reopenBill(b, 'טעות בכמות');
  assert.equal(api.bill(b).reopened, true);
  assert.ok(api.attention().some((a) => a.text === 'נפתח מחדש לתיקון'));
});

test('smart Dekel search: Hebrew roots, Latin abbreviations, families of variants', async () => {
  const { rootKeys, normText } = await import('../js/dekel.js');
  const k = (w) => rootKeys(normText(w));
  for (const w of ['רצפות', 'רצפה', 'רצפת', 'ריצוף', 'מרצפות']) assert.ok(k('מרצפים').some((x) => k(w).includes(x)), w);
  assert.ok(!k('בטון').some((x) => k('טון').includes(x)));          // "בטון" is not "טון"
  assert.equal(normText('H.D.P.E'), 'hdpe');
  assert.equal(normText('h d p e'), 'hdpe');
  const db = new SQL.Database();
  db.run(`CREATE TABLE chapters (code TEXT, name TEXT); CREATE TABLE subchapters (code TEXT, name TEXT);
    CREATE TABLE items (code TEXT, chapter_code TEXT, subchapter_code TEXT, description TEXT, unit TEXT, price REAL);
    INSERT INTO items VALUES ('02.050.0010','02','050','מרצפי בטון ב-30 יצוקים על מצע בעובי 10 ס"מ','מ"ר',120);
    INSERT INTO items VALUES ('02.050.0020','02','050','מרצפי בטון ב-30 יצוקים על מצע בעובי 15 ס"מ','מ"ר',150);
    INSERT INTO items VALUES ('02.050.0030','02','050','מרצפי בטון ב-30 יצוקים על מצע בעובי 20 ס"מ','מ"ר',185);
    INSERT INTO items VALUES ('40.053.0600','40','053','ריצוף באבנים משתלבות בעובי 6 ס"מ','מ"ר',95);
    INSERT INTO items VALUES ('57.012.0410','57','012','צינורות H.D.P.E קוטר 110 מ"מ בעומק עד 2 מ''','מ''',150);
    INSERT INTO items VALUES ('57.012.0420','57','012','צינורות H.D.P.E קוטר 160 מ"מ בעומק עד 2 מ''','מ''',190);
    INSERT INTO items VALUES ('57.012.0430','57','012','צינורות H.D.P.E קוטר 110 מ"מ בעומק עד 4 מ''','מ''',175);`);
  const dk = new Dekel(SQL, db.export());
  const codes = dk.search('מרצפים').map((x) => x.code);
  assert.ok(codes.includes('40.053.0600'));                         // ריצוף found by root
  assert.equal(dk.search('HDPE').length, 3);
  assert.equal(dk.search('h d p e').length, 3);
  const g = dk.searchGrouped('מרצפי בטון');
  assert.equal(g.length, 1);                                       // three thicknesses → one card
  assert.equal(g[0].family.items.length, 3);
  assert.deepEqual(g[0].family.slots.map((s) => [s.label, s.values]), [['עובי', ['10', '15', '20']]]);
  const pipes = dk.family('57.012.0410');
  assert.deepEqual(pipes.slots.map((s) => s.label), ['קוטר', 'עומק עד']);
  assert.equal(dk.variantLabel(pipes, dk.get('57.012.0430')), 'קוטר 110 · עומק עד 4');
});
