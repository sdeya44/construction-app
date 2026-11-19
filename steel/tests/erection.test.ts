import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { buildSheet, drawingCatalog, LABELS_PER } from '../src/drawing/views';
import { assemblyLocations, memberLocation } from '../src/fab/location';
import { boltsByNodeTable } from '../src/fab/export';

describe('הרכבה בשטח (1.36): תוכנית הרכבה, תוויות, ברגים לפי צומת', () => {
  const p = newProject('t', defaultBuilding());
  const d = generate(p);
  const fab = computeFabrication(p, d);
  const bom = computeBom(d, fab);
  it('מיקום קריא לכל מכלול: עמוד = "ציר n / א"', () => {
    const col = d.members.find((m) => m.id === 'F2.COL.L')!;
    expect(memberLocation(col, p, d)).toBe('ציר 2 / א');
    const loc = assemblyLocations(p, d, fab);
    expect(loc.size).toBe(fab.assemblies.length);
    expect([...loc.values()].every((s) => s.length > 0)).toBe(true);
  });
  it('גיליון תוכנית הרכבה: כל סימון עמוד/קורה מופיע בשרטוט ובטבלה', () => {
    const cat = drawingCatalog(p, d, fab);
    const def = cat.find((x) => x.type === 'erection')!;
    expect(def.number).toBe('G-02');
    const sh = buildSheet(def, p, d, fab, bom);
    const texts = sh.ents.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s);
    for (const a of fab.assemblies.filter((x) => /^[CR]\d/.test(x.mark))) expect(texts).toContain(a.mark);
    expect(texts.some((t) => t.includes('ציר 1 / א'))).toBe(true);
  });
  it('תוויות: מדבקה לכל מופע מכלול, 24 בגיליון', () => {
    const cat = drawingCatalog(p, d, fab).filter((x) => x.type === 'labels');
    expect(cat.length).toBe(Math.ceil(fab.assemblies.length / LABELS_PER));
    const sh = buildSheet(cat[0], p, d, fab, bom);
    expect(sh.ents.filter((e) => e.k === 'poly').length).toBeGreaterThanOrEqual(LABELS_PER);
  });
  it('ברגים לפי צומת: שורה לכל חיבור עם ברגי שטח, עם מיקום', () => {
    const t = boltsByNodeTable(p, d);
    const n = d.connections.filter((c) => c.bolts.some((b) => b.location === 'site')).length;
    expect(t.rows.length).toBe(n);
    expect(t.rows.some((r) => String(r[0]).startsWith('ציר'))).toBe(true);
  });
});
