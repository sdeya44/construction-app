/**
 * NEST — ניסטינג ללייזר לפלטות (`fab/nesting.ts`).
 * NEST-01: קונטור אמיתי לכל סימון (קיטום 20×20 ⇒ שטח = מלבן − 800).
 * NEST-02: תקינות גיאומטרית בלתי תלויה: אין חפיפה בין חלקים, הכול בתוך השוליים, החורים בתוך החלק, דטרמיניזם.
 * NEST-03: קרף — מרחק מינימלי בין חלקים; סיבוב 90°; חלק גדול מהלוח.
 * NEST-04: DXF ודוחות.
 */
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { detailPresets } from '../src/geometry/detail';
import { assignDetail, numberParts } from '../src/commands/commands';
import { computeFabrication } from '../src/fab/marks';
import { DEFAULT_NEST, nestParts, nestPlates, nestSheetDxf, nestTables, nestZip, type NestOptions, type NestPart, type NestResult, type Pt } from '../src/fab/nesting';
import type { CustomDetail, Project } from '../src/model/types';

const base = (cham: boolean) => {
  const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true, profile: 'RHS80x80x4' };
  let p = numberParts().run(newProject('nest', b));
  if (cham) {
    const d0 = generate(p), dt = structuredClone(detailPresets().find((x) => x.id === 'preset-plate-plate-cham')!) as CustomDetail;
    const keys = d0.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
    p = numberParts().run(assignDetail(keys, dt).run({ ...p, customDetails: [...(p.customDetails ?? []), dt] }));
  }
  const d = generate(p), fab = computeFabrication(p, d);
  return { p, d, fab, parts: nestParts(d, fab) };
};

// גיאומטריה עצמאית לבדיקה
const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const properCross = (a: Pt, b: Pt, c: Pt, d: Pt) => { const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d); return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) && ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6)); };
const inside = (p: Pt, poly: Pt[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i]!, b = poly[j]!; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
const segDist = (p: Pt, a: Pt, b: Pt) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0; return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
const polyDist = (A: Pt[], B: Pt[]) => { let m = Infinity; for (const p of A) for (let i = 0; i < B.length; i++) m = Math.min(m, segDist(p, B[i]!, B[(i + 1) % B.length]!)); for (const p of B) for (let i = 0; i < A.length; i++) m = Math.min(m, segDist(p, A[i]!, A[(i + 1) % A.length]!)); return m; };
const overlap = (A: Pt[], B: Pt[]) => {
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (properCross(A[i]!, A[(i + 1) % A.length]!, B[j]!, B[(j + 1) % B.length]!)) return true;
  const cen = (P: Pt[]) => ({ x: P.reduce((a, q) => a + q.x, 0) / P.length, y: P.reduce((a, q) => a + q.y, 0) / P.length });
  return (inside(cen(A), B) && polyDist(A, B) > 1e-6) || (inside(cen(B), A) && polyDist(A, B) > 1e-6) || (inside(cen(A), B) && inside(cen(B), A));
};
const rect = (mark: string, w: number, h: number, qty = 1, t = 10): NestPart => ({ mark, desc: mark, qty, material: 'S235JR', t, poly: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], holes: [], area: w * h });
const check = (r: NestResult) => {
  const o = r.opts;
  for (const s of r.sheets) {
    for (const it of s.items) {
      for (const q of it.poly) { expect(q.x).toBeGreaterThanOrEqual(o.margin - 1e-6); expect(q.y).toBeGreaterThanOrEqual(o.margin - 1e-6); expect(q.x).toBeLessThanOrEqual(s.w - o.margin + 1e-6); expect(q.y).toBeLessThanOrEqual(s.h - o.margin + 1e-6); }
      for (const h of it.holes) expect(inside({ x: h.x, y: h.y }, it.poly), `חור ${it.mark}`).toBe(true);
    }
    for (let i = 0; i < s.items.length; i++) for (let j = i + 1; j < s.items.length; j++) expect(overlap(s.items[i]!.poly, s.items[j]!.poly), `חפיפה ${s.items[i]!.mark}#${s.items[i]!.copy} / ${s.items[j]!.mark}#${s.items[j]!.copy} בלוח ${s.id}`).toBe(false);
  }
};

describe('NEST-01 קונטורים', () => {
  it('פרויקט ברירת מחדל: פלטות עם קונטור וחורים; שטח > 0', () => {
    const { parts } = base(false);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) { expect(p.area, p.mark).toBeGreaterThan(0); expect(p.t, p.mark).toBeGreaterThan(0); expect(Math.min(...p.poly.map((q) => q.x))).toBe(0); }
    expect(parts.some((p) => p.holes.length > 0)).toBe(true);
  });
  it('פלטות עם קיטום 20×20: שטח = מלבן תוחם − 4·(20·20/2) = −800', () => {
    const { parts } = base(true);
    const cut = parts.filter((p) => p.poly.length === 8);
    expect(cut.length).toBeGreaterThan(2);
    for (const p of cut) {
      const w = Math.max(...p.poly.map((q) => q.x)), h = Math.max(...p.poly.map((q) => q.y));
      expect(p.area, p.mark).toBeCloseTo(w * h - 800, 0);
    }
  });
});

describe('NEST-02 תקינות הניסטינג', () => {
  for (const cham of [false, true]) it(`${cham ? 'עם קיטומים' : 'ברירת מחדל'}: הכול ממוקם, בלי חפיפה, בתוך השוליים, חורים בתוך החלק; דטרמיניסטי`, () => {
    const { parts } = base(cham);
    const r = nestPlates(parts, DEFAULT_NEST), r2 = nestPlates(parts, DEFAULT_NEST);
    expect(r.unplaced).toEqual([]);
    const need = parts.reduce((a, p) => a + p.qty, 0), got = r.sheets.reduce((a, s) => a + s.items.length, 0);
    expect(got).toBe(need);
    check(r);
    expect(JSON.stringify(r.sheets.map((s) => s.items.map((i) => [i.mark, i.copy, i.x, i.y, i.rot])))).toBe(JSON.stringify(r2.sheets.map((s) => s.items.map((i) => [i.mark, i.copy, i.x, i.y, i.rot]))));
    for (const s of r.sheets) { expect(s.util).toBeGreaterThan(0); expect(s.util).toBeLessThanOrEqual(1); }
  });
  it('חלקים צמודים בקרף 0: ארבעה 500×250 על לוח 1000×500 (בלי שוליים) — לוח אחד, ניצולת 100%', () => {
    const o: NestOptions = { ...DEFAULT_NEST, sheetW: 1000, sheetH: 500, margin: 0, kerf: 0, rotate: false };
    const r = nestPlates([rect('A', 500, 250, 4)], o);
    expect(r.sheets.length).toBe(1); expect(r.sheets[0]!.util).toBeCloseTo(1, 5); check(r);
  });
});

describe('NEST-03 קרף, סיבוב, חלק גדול', () => {
  it('קרף 10: מרחק בין חלקים ≥ 10 מ"מ (נבדק גיאומטרית)', () => {
    const { parts } = base(true);
    const o = { ...DEFAULT_NEST, kerf: 10 };
    const r = nestPlates(parts, o); check(r);
    for (const s of r.sheets) for (let i = 0; i < s.items.length; i++) for (let j = i + 1; j < s.items.length; j++) expect(polyDist(s.items[i]!.poly, s.items[j]!.poly), `${s.items[i]!.mark}/${s.items[j]!.mark}`).toBeGreaterThanOrEqual(10 - 1e-6);
  });
  it('סיבוב 90°: 450×900 על לוח 1000×500 — בלי סיבוב לא נכנס, עם סיבוב נכנס (rot=90/270)', () => {
    const o: NestOptions = { ...DEFAULT_NEST, sheetW: 1000, sheetH: 500, margin: 10 };
    const no = nestPlates([rect('R', 450, 900)], { ...o, rotate: false });
    expect(no.sheets.length).toBe(0); expect(no.unplaced[0]!.mark).toBe('R');
    const yes = nestPlates([rect('R', 450, 900)], o);
    expect(yes.unplaced).toEqual([]); expect([90, 270]).toContain(yes.sheets[0]!.items[0]!.rot); check(yes);
  });
  it('חלק גדול מהלוח: לא מונח, עם סיבה; שאר החלקים מונחים', () => {
    const r = nestPlates([rect('BIG', 4000, 2000), rect('OK', 100, 100, 3)], DEFAULT_NEST);
    expect(r.unplaced.map((u) => u.mark)).toEqual(['BIG']); expect(r.unplaced[0]!.reason).toMatch(/גדול מהלוח/);
    expect(r.sheets[0]!.items.length).toBe(3);
  });
  it('מספר לוחות: חומר/עובי שונים — לוחות נפרדים', () => {
    const r = nestPlates([rect('T10', 100, 100, 2, 10), rect('T20', 100, 100, 2, 20)], DEFAULT_NEST);
    expect(r.sheets.length).toBe(2); expect(new Set(r.sheets.map((s) => s.t))).toEqual(new Set([10, 20]));
  });
  it('קונטור לא קמור (L): החלק הקטן נכנס בפינה הריקה (ניצולת טובה ממלבן תוחם)', () => {
    const L: NestPart = { mark: 'L', desc: 'L', qty: 1, material: 'S235JR', t: 10, poly: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 400 }, { x: 0, y: 400 }], holes: [], area: 400 * 100 + 100 * 300 };
    const o: NestOptions = { ...DEFAULT_NEST, sheetW: 410, sheetH: 410, margin: 0, rotate: false };
    const r = nestPlates([L, rect('S', 250, 250, 1)], o);
    // מלבן תוחם של L הוא 400×400 ⇒ ללא קונטור אמיתי החלק S לא היה נכנס ללוח 410×410
    expect(r.unplaced).toEqual([]);
    expect(r.sheets.length).toBe(1); check(r);
    const small = r.sheets[0]!.items.find((i) => i.mark === 'S')!, big = r.sheets[0]!.items.find((i) => i.mark === 'L')!;
    expect(small.x).toBeGreaterThanOrEqual(big.x + 100 - 1e-6); expect(small.y).toBeGreaterThanOrEqual(big.y + 100 - 1e-6); // בכיס של ה-L
  });
  it('בקרת הבדיקה: גלאי החפיפה מזהה חפיפה אמיתית וגם הכלה, ולא מזהה חלקים צמודים', () => {
    const sq = (x: number, y: number, w: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }];
    expect(overlap(sq(0, 0, 100), sq(50, 50, 100))).toBe(true);
    expect(overlap(sq(0, 0, 100), sq(20, 20, 30))).toBe(true);
    expect(overlap(sq(0, 0, 100), sq(100, 0, 100))).toBe(false);
    expect(overlap(sq(0, 0, 100), sq(150, 0, 100))).toBe(false);
  });
});

describe('NEST-04 DXF ודוחות', () => {
  it('DXF לכל לוח: מסגרת, קונטורים (CUT), חורים (HOLE), סימונים; ZIP בספירה הנכונה', () => {
    const { parts } = base(true);
    const r = nestPlates(parts, DEFAULT_NEST);
    const dxf = nestSheetDxf(r.sheets[0]!, DEFAULT_NEST.margin);
    expect(dxf).toMatch(/^0\r\nSECTION/); expect(dxf.trim().endsWith('EOF')).toBe(true);
    expect((dxf.match(/\r\nCIRCLE\r\n/g) ?? []).length).toBe(r.sheets[0]!.items.reduce((a, i) => a + i.holes.length, 0));
    expect((dxf.match(/POLYLINE/g) ?? []).length).toBeGreaterThanOrEqual(r.sheets[0]!.items.length + 1);
    const z = nestZip(r), files = unzipSync(z.zip);
    expect(z.count).toBe(r.sheets.length); expect(Object.keys(files).length).toBe(r.sheets.length);
    expect(strFromU8(Object.values(files)[0]!)).toMatch(/SECTION/);
  });
  it('טבלאות: לוחות (עם סיכום), חלקים, הערות — כולל הצהרה שאינו מאומת מול מכונה; סכום חלקים = כמות', () => {
    const { parts } = base(false);
    const r = nestPlates(parts, DEFAULT_NEST), t = nestTables(parts, r);
    expect(t.map((x) => x.name)).toEqual(['ניסטינג — לוחות', 'ניסטינג — חלקים', 'ניסטינג — הערות']);
    expect(t[0]!.rows.at(-1)![0]).toBe('סה"כ');
    expect(t[0]!.rows.at(-1)![4]).toBe(parts.reduce((a, p) => a + p.qty, 0));
    expect(JSON.stringify(t[2]!.rows)).toMatch(/אינו מאומת מול מכונה/);
    for (const row of t[1]!.rows) expect(row[4]).toBe(row[5]);
  });
});
void ({} as Project);
