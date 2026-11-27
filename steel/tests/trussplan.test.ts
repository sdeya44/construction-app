/**
 * TPLAN — גיליון "תוכנית מסבך" (`drawing/truss.ts`): קטלוג, צורת חיתוך, תוכן הגיליון (מידות, פיתוח חיתוך, חיבור לעמודים, טבלאות).
 * TPLAN-01: cutShape — חיתוך ישר, חיתוך 45°, חיתוך אנטי-סימטרי. TPLAN-02: מסבך גג. TPLAN-03: מסבך נושא. TPLAN-04: מסבכים זהים — גיליון אחד.
 */
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultTrussSpec } from '../src/geometry/truss';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { cutShape, trussUnits } from '../src/drawing/truss';
import { auditSheet } from '../src/drawing/layoutAudit';
import type { Member } from '../src/model/types';

type Font = { layout: (s: string) => { advanceWidth: number }; unitsPerEm: number };
const fk = fontkit as unknown as { create: (b: Buffer) => Font };
const reg = fk.create(readFileSync('src/drawing/font/KSPSans.ttf')), bold = fk.create(readFileSync('src/drawing/font/KSPSans-Bold.ttf'));
const measure = (s: string, h: number, b?: boolean) => { const f = b ? bold : reg; return (f.layout(s).advanceWidth / f.unitsPerEm) * h; };

const m = (start: [number, number, number], end: [number, number, number], startCut?: Member['startCut'], endCut?: Member['endCut']): Member => ({
  id: 'W', kind: 'brace', label: 'W', start: { x: start[0], y: start[1], z: start[2] }, end: { x: end[0], y: end[1], z: end[2] }, profile: 'SHS80x4', material: 'S355', rollDeg: 0, mirror: false, anchor: 'center', refUp: { x: 0, y: 0, z: 1 },
  source: 'generated', manualPlacement: false, startCut, endCut,
});
const pr = (q: { x: number; y: number; z: number }) => ({ x: q.x, y: q.z });

describe('TPLAN צורת חיתוך', () => {
  it('TPLAN-01a: חיתוך ישר בשני הקצוות — ארבע צלעות שוות, זווית 0', () => {
    const s = cutShape(m([0, 0, 0], [1000, 0, 0]), pr, 80);
    expect(Math.round(s.long)).toBe(1000); expect(Math.round(s.short)).toBe(1000);
    expect(Math.round(s.angS)).toBe(0); expect(Math.round(s.angE)).toBe(0);
  });
  it('TPLAN-01b: חיתוך 45° בקצה אחד — הפרש הצלעות = הרוחב, זווית 45°', () => {
    const n = Math.SQRT1_2;
    const s = cutShape(m([0, 0, 0], [1000, 0, 0], undefined, { point: { x: 1000, y: 0, z: 0 }, normal: { x: n, y: 0, z: n } }), pr, 80);
    expect(Math.round(s.long - s.short)).toBe(80);
    expect(Math.round(s.angE)).toBe(45); expect(Math.round(s.angS)).toBe(0);
  });
  it('TPLAN-01c: אלכסון 45° בין חגורות אופקיות — חיתוך מקביל לחגורה בשני הקצוות: צלעות ארוכה/קצרה לפי רוחב וזווית', () => {
    // אלכסון עולה ב-45°; שני הקצוות חתוכים במישור אופקי (נורמל z)
    const s = cutShape(m([0, 0, 0], [1000, 0, 1000], { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }, { point: { x: 1000, y: 0, z: 1000 }, normal: { x: 0, y: 0, z: 1 } }), pr, 80);
    expect(Math.round(s.angS)).toBe(45); expect(Math.round(s.angE)).toBe(45);
    expect(Math.round(s.long - s.short)).toBe(0); // חיתוכים מקבילים — מקבילית
    expect(s.axisLen).toBeCloseTo(1000 * Math.SQRT2, 3);
  });
});

function sheetOf(b: ReturnType<typeof defaultBuilding>) {
  const p = numberParts().run(newProject('tplan', b)); const d = generate(p); const fab = computeFabrication(p, d); const bom = computeBom(d, fab);
  return { p, d, fab, bom, defs: drawingCatalog(p, d, fab).filter((x) => x.type === 'truss-unit') };
}
const texts = (sh: ReturnType<typeof buildSheet>) => sh.ents.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s);

describe('TPLAN גיליון מסבך', () => {
  it('TPLAN-02: מסבך גג — גיליון עם מבט, מידות צמתים, פיתוח חיתוך, פרט חיבור לעמוד וטבלאות', () => {
    const b = defaultBuilding(); b.roofTruss = { enabled: true, frames: [b.frames[0]!.id], shape: 'flat', spec: defaultTrussSpec(8, 1000, { top: b.rafterProfile }) };
    const { p, d, fab, bom, defs } = sheetOf(b);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const sh = buildSheet(defs[0]!, p, d, fab, bom);
    const t = texts(sh);
    expect(t.some((s) => s.includes('מבט במישור המסבך'))).toBe(true);
    expect(t.some((s) => s.includes('פיתוח חיתוך'))).toBe(true);
    expect(t.some((s) => s.includes('מבט חזית'))).toBe(true);
    expect(t.some((s) => s.includes('רשימת חלקים'))).toBe(true);
    expect(t.some((s) => s.includes('פרופילים'))).toBe(true);
    expect(t.some((s) => s.includes('SHS80x4'))).toBe(true);
    expect(t.filter((s) => /^\d+$/.test(s)).length).toBeGreaterThan(8); // מידות בין צמתים וגובה
    expect(sh.ents.filter((e) => e.k === 'line').length).toBeGreaterThan(200);
  }, 120000);
  it('TPLAN-03: מסבך נושא בדילול עמודים — גיליון נבנה, כולל חיבור לעמודים', () => {
    const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
    const spec = defaultTrussSpec(8, 1200); spec.splice = [3];
    b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[4].id, removed: [f[1].id, f[2].id, f[3].id], profile: 'HEA160', support: 'A2', seat: 'B1', kind: 'truss', truss: spec }];
    const { p, d, fab, bom, defs } = sheetOf(b);
    expect(defs.length).toBe(1);
    const sh = buildSheet(defs[0]!, p, d, fab, bom);
    const t = texts(sh);
    expect(t.some((s) => s.includes('מבט במישור המסבך'))).toBe(true);
    expect(t.some((s) => s.includes('מבט חזית'))).toBe(true);
    expect(sh.ents.every((e) => e.k !== 'text' || (Number.isFinite(e.p.x) && Number.isFinite(e.p.y)))).toBe(true);
  }, 120000);
  it('TPLAN-04: מסבכים זהים בכל המסגרות — גיליון אחד עם "זהים"', () => {
    const b = defaultBuilding(); b.roofTruss = { enabled: true, frames: 'all', shape: 'flat', spec: defaultTrussSpec(8, 1000, { top: b.rafterProfile }) };
    const { d, defs } = sheetOf(b);
    const units = trussUnits(newProject('x', b), d);
    expect(units.length).toBe(defs.length);
    expect(units.length).toBeLessThan(b.frames.length);
    expect(units[0]!.refs.length).toBeGreaterThan(1);
  }, 120000);
  it('TPLAN-05: פרויקט בלי מסבך — אין גיליון מסבך', () => {
    expect(sheetOf(defaultBuilding()).defs).toEqual([]);
  });
  it('TPLAN-06: ביקורת קריאות — אין טקסט מחוץ לגיליון, חפיפות טקסט מוגבלות (תקרה)', () => {
    const roof = defaultBuilding(); roof.roofTruss = { enabled: true, frames: [roof.frames[0]!.id], shape: 'flat', spec: defaultTrussSpec(8, 1000, { top: roof.rafterProfile }) };
    const carry = defaultBuilding(); { const f = [...carry.frames].sort((x, y) => x.y - y.y); const spec = defaultTrussSpec(8, 1200); spec.splice = [3]; carry.transfers = [{ id: 'T1', lineId: 'L', from: f[0]!.id, to: f[4]!.id, removed: [f[1]!.id, f[2]!.id, f[3]!.id], profile: 'HEA160', support: 'A2', seat: 'B1', kind: 'truss', truss: spec }]; }
    for (const [b, cap] of [[roof, CAP], [carry, CAP]] as const) {
      const { p, d, fab, bom, defs } = sheetOf(b);
      const xs = auditSheet(buildSheet(defs[0]!, p, d, fab, bom), measure);
      expect(xs.filter((x) => x.kind === 'text-outside').map((x) => x.a), 'טקסט מחוץ לגיליון').toEqual([]);
      expect(xs.length, xs.map((x) => `${x.kind}: ${x.a}${x.b ? ` ↔ ${x.b}` : ''}`).join('\n')).toBeLessThanOrEqual(cap);
    }
  }, 120000);
});
const CAP = 0;
