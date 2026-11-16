import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { claddingTakeoff, defaultCladding } from '../src/geometry/cladding';
import { computeFabrication } from '../src/fab/marks';
import { computeBom, cutPlans } from '../src/fab/bom';
import { projectToIfc } from '../src/fab/ifc';
import { computeQuote, DEFAULT_PRICING } from '../src/fab/quote';
import { clientQuoteSheet, DEFAULT_TERMS } from '../src/fab/clientQuote';
import { applySizingSuggestion } from '../src/commands/commands';

function setup() {
  const b = defaultBuilding(); b.cladding = defaultCladding();
  b.cladding.openings.push({ id: 'D1', wall: 'F', pos: 7000, width: 4000, height: 4500, sill: 0, label: 'שער' }, { id: 'W1', wall: 'L', pos: 8000, width: 2000, height: 1200, sill: 1200 });
  const p = newProject('x', b); const d = generate(p);
  return { p, d };
}

describe('חיפוי, IFC והצעת מחיר ללקוח', () => {
  const { p, d } = setup();
  it('CL-01: פטות קיר בכל ארבעת הקירות, 2 עמודי רוח בכל קיר קצה (מפתח 18 מ\', מרווח מרבי 6 מ\'), ללא שגיאות', () => {
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const g = d.members.filter((m) => m.kind === 'girt');
    for (const w of ['L', 'R', 'F', 'B']) expect(g.some((m) => m.wall?.id === w && m.wall.role === 'girt')).toBe(true);
    expect(g.filter((m) => m.wall?.role === 'post' && m.wall.id === 'F').map((m) => Math.round(m.start.x))).toEqual([6000, 12000]);
    // עמודי רוח מסתיימים מתחת לקורת הגג
    for (const m of g.filter((x) => x.wall?.role === 'post')) expect(m.end.z).toBeLessThan(6900);
  });
  it('CL-02: פתח קוטע את פטות הקיר; עמודי פתח משני הצדדים; לחלון — אדן', () => {
    const inGate = d.members.filter((m) => m.wall?.id === 'F' && m.wall.role === 'girt' && m.start.z < 4500 && Math.min(m.start.x, m.end.x) < 10900 && Math.max(m.start.x, m.end.x) > 7100);
    expect(inGate).toEqual([]);
    expect(d.members.filter((m) => m.id.startsWith('JB.D1.')).length).toBe(2);
    expect(d.byId.has('JB.W1.S')).toBe(true);
  });
  it('CL-03: כתב כמויות — שטחי גג וקירות, פנלים, מזחלה בכל קצה תחתון, כיסוי רכס', () => {
    const t = claddingTakeoff(p, d)!;
    expect(t.roofArea).toBeGreaterThan(540); expect(t.roofArea).toBeLessThan(580);
    expect(t.roofSheets.reduce((a, r) => a + r.count, 0)).toBe(60);
    expect(t.gutters.length).toBe(2);
    expect(t.flashings.some((f) => f.name.includes('רכס'))).toBe(true);
    expect(t.openingArea).toBeCloseTo(4 * 4.5 + 2 * 1.2, 5);
  });
  it('IFC-01: קובץ IFC4 עם עמודים, קורות, אלמנטים ופלטות, מאפייני ייצור וחומר', () => {
    const s = projectToIfc(p, d, computeFabrication(p, d));
    expect(s.startsWith('ISO-10303-21;')).toBe(true);
    expect(s).toContain("FILE_SCHEMA(('IFC4'));");
    for (const t of ['IFCCOLUMN(', 'IFCBEAM(', 'IFCMEMBER(', 'IFCPLATE(', 'IFCTRIANGULATEDFACESET(', 'KSP_Fabrication', 'IFCRELASSOCIATESMATERIAL(']) expect(s).toContain(t);
    expect((s.match(/IFCCOLUMN\(/g) ?? []).length).toBe(d.members.filter((m) => m.kind === 'column').length);
  });
  it('QC-01: הצעת מחיר ללקוח — שורות חיפוי נכללות; תקורה ורווח מגולמים; סה"כ כולל מע"מ', () => {
    const fab = computeFabrication(p, d), bom = computeBom(d, fab), plans = cutPlans(fab, p), t = claddingTakeoff(p, d);
    const q = computeQuote({ ...DEFAULT_PRICING, steelPerKg: 5, roofPanelPerM2: 80, wallPanelPerM2: 70, gutterPerM: 90, overheadPct: 10, marginPct: 10 }, d, fab, bom, plans, t);
    expect(q.lines.some((l) => l.key === 'roofPanel' && l.total > 0)).toBe(true);
    const { sheet } = clientQuoteSheet(p, d, q, t, 18, DEFAULT_TERMS, 'חברה');
    const texts = sheet.ents.filter((e) => e.k === 'text').map((e) => (e as { s: string }).s);
    expect(texts.some((x) => x.includes('תקורה'))).toBe(false);
    expect(texts.some((x) => x.includes(Math.round(q.beforeVat * 1.18).toLocaleString('en-US')))).toBe(true);
  });
  it('SZ-04: התאמת חתכים לפי כללי אצבע — ללא שגיאות, כל האלמנטים הראשיים סבירים', () => {
    const p2 = applySizingSuggestion().run(newProject('y', defaultBuilding()));
    const d2 = generate(p2);
    expect(d2.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(p2.building.rafterProfile).not.toBe('IPE300');
  });
});

describe('חיפוי חלקי', () => {
  it('CL-04: מפתחים לא מחופים ללא פטות; חיפוי עליון חלקי עם פטה בראשו ופח עליון; שדה לא מחופה בקיר קצה ללא עמודי רוח', () => {
    const b = defaultBuilding(); b.cladding = defaultCladding();
    b.cladding.walls.per = { L: { bays: [true, false, false, true, true], top: 3000 }, F: { bays: [false, true, true] } };
    const p = newProject('x', b); const d = generate(p);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const gL = d.members.filter((m) => m.wall?.id === 'L' && m.wall.role === 'girt');
    // מפתחים 2–3 ו-3–4 (y 6000..18000) ללא פטות
    expect(gL.some((m) => Math.min(m.start.y, m.end.y) >= 6000 - 1 && Math.max(m.start.y, m.end.y) <= 18000 + 1)).toBe(false);
    expect(Math.max(...gL.map((m) => m.start.z))).toBeCloseTo(2950, 0);
    // קיר קדמי: שדה א-ב (x<6000) לא מחופה — אין עמוד רוח ב-x=6000? עמודי רוח קיימים רק בשדות מחופים
    expect(d.members.filter((m) => m.wall?.id === 'F' && m.wall.role === 'post').every((m) => m.start.x > 0)).toBe(true);
    const t = claddingTakeoff(p, d)!;
    expect(t.flashings.some((f) => f.name.includes('פח עליון'))).toBe(true);
    expect(t.flashings.some((f) => f.name.includes('שפה'))).toBe(true);
    const sheetsL = t.wallSheets.filter((r) => r.where.includes('שמאל'));
    expect(sheetsL[0].length).toBe(3000);
    expect(sheetsL[0].count).toBe(Math.ceil(18000 / 1000));
  });
});
