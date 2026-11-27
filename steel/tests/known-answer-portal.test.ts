/**
 * KAT — בדיקת תשובה ידועה: מסגרת פורטל אחת (2 עמודי IPE200 גובה 4000, קורה IPE200 מפתח 6000, S235), לוחות בסיס 200×200×12 ו-(שלב ב')
 * לוחות ראש עמוד 300×150×10 עם 4 ברגי M16 לכל אחד. החישוב הידני בקובץ זה בלבד — בלתי תלוי באפליקציה.
 *
 * שני בניות:
 *  A. "דרך פקודות האפליקציה" (`setBuilding`, `setConnectionDefault`, `deleteMembers`, `numberParts`) — כך שהאפליקציה מוסיפה בעצמה חיתוכים, אוברהנג וחלקים נלווים.
 *     אין באפליקציה פקודה ליצירת אלמנט באורך מדויק (רק `copyMembers`/הזזה/סיבוב/שיקוף), ולכן A אינה יכולה לתת 6000 מדויק.
 *  B. "ייחוס": אותם אלמנטים בגיאומטריה מדויקת, בהזנה ישירה של `manualMembers` (נתונים, לא פקודה) — בודק רק את חשבון כתב הכמויות והמשקלים.
 * הערכים שאינם מוגדרים בקלט (מרווחי ברגים) הם הנחה: gauge 90, pitch 200. אין שינוי בקוד האפליקציה.
 * בכל ריצה נכתב דוח: e2e-results/evidence/known-answer-portal.md. סטיות מתועדות מקובעות כ"ידועות" — שינוי באפליקציה שמשנה אותן ייכשל כאן בכוונה.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { boltsByNodeTable } from '../src/fab/export';
import { drawingCatalog } from '../src/drawing/views';
import { deleteMembers, numberParts, setBuilding, setConnectionDefault } from '../src/commands/commands';
import { massPerMeter, getProfile } from '../src/profiles/library';
import type { Project } from '../src/model/types';

// ---------------- חישוב ידני (בלתי תלוי באפליקציה) ----------------
const RHO = 7850; // ק"ג/מ"ק
const KGM_IPE200 = 22.4; // ק"ג/מ' — ערך תקני לפי הנחיה
const plateKg = (a: number, b: number, t: number) => (a / 1000) * (b / 1000) * (t / 1000) * RHO;
const EXP = {
  members: 3, lenC1: 4000, lenC2: 4000, lenB1: 6000, lenTotal: 14000,
  ipeKg: (14000 / 1000) * KGM_IPE200,           // 313.6
  bpEach: plateKg(200, 200, 12), bpTotal: 2 * plateKg(200, 200, 12),   // 3.768 / 7.536
  epEach: plateKg(300, 150, 10), epTotal: 2 * plateKg(300, 150, 10),   // 3.5325 / 7.065
  bolts: 8,
  get totalNoB() { return this.ipeKg + this.bpTotal; },               // 321.136
  get totalWithB() { return this.ipeKg + this.bpTotal + this.epTotal; }, // 328.201
};

interface Row { item: string; expected: number | null; actual: number | null; note?: string }
const pct = (r: Row) => (r.expected && r.actual !== null ? ((r.actual - r.expected) / r.expected) * 100 : null);
const near = (a: number, b: number, tolPct = 0.5) => Math.abs(a - b) <= Math.abs(b) * (tolPct / 100);

const B16 = { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 };

/** A: דרך פקודות האפליקציה. מסגרת 2 (נדרשות ≥ 2 מסגרות) ושאר האלמנטים הנגזרים נמחקים; נשארת מסגרת 1 עם חיבוריה. */
function buildViaCommands(): Project {
  let p = newProject('KAT-A', defaultBuilding());
  p = setBuilding({ roofType: 'mono', width: 6000, eaveLeft: 4000, eaveRight: 4000, slopeLeftPct: 0, frames: [{ id: 'F1', y: 0 }, { id: 'F2', y: 6000 }], columnProfile: 'IPE200', rafterProfile: 'IPE200', rafterOverhangLeft: 0, rafterOverhangRight: 0 }).run(p);
  p = setConnectionDefault('base', { t: 12, w: 200, l: 200 }).run(p); // מבוטנת: פני הפלטה במפלס 0
  p = setConnectionDefault('eave', { t: 10, w: 150, l: 300, cols: 2, rows: 2, split: false, bolt: B16, gauge: 90, pitch: 200 }).run(p);
  const keep = new Set(['F1.COL.L', 'F1.COL.R', 'F1.RAF']);
  const d0 = generate(p);
  p = deleteMembers(d0.members.filter((m) => !m.id.startsWith('C.') && !keep.has(m.id)).map((m) => m.id)).run(p);
  return numberParts().run(p);
}

/** B: ייחוס בגיאומטריה מדויקת (הזנת נתונים ישירה). */
function buildReference(stageB: boolean): Project {
  let p = newProject('KAT-B', defaultBuilding());
  p = deleteMembers(generate(p).members.filter((m) => !m.id.startsWith('C.')).map((m) => m.id)).run(p);
  const base = { material: 'S235', rollDeg: 0, mirror: false, refUp: { x: 1, y: 0, z: 0 }, anchor: 'center' as const };
  const v = (x: number, z: number) => ({ x, y: 0, z });
  p.manualMembers.push(
    { id: 'C1', kind: 'column', start: v(0, 0), end: v(0, 4000), profile: 'IPE200', ...base },
    { id: 'C2', kind: 'column', start: v(6000, 0), end: v(6000, 4000), profile: 'IPE200', ...base },
    { id: 'B1', kind: 'beam', start: v(0, 4000), end: v(6000, 4000), profile: 'IPE200', ...base },
    { id: 'BP1', kind: 'plate', start: v(-100, 0), end: v(100, 0), profile: 'PL200x12', ...base },
    { id: 'BP2', kind: 'plate', start: v(5900, 0), end: v(6100, 0), profile: 'PL200x12', ...base },
  );
  if (stageB) p.manualMembers.push(
    { id: 'EP1', kind: 'plate', start: v(-150, 3800), end: v(150, 3800), profile: 'PL150x10', ...base },
    { id: 'EP2', kind: 'plate', start: v(5850, 3800), end: v(6150, 3800), profile: 'PL150x10', ...base },
  );
  return numberParts().run(p);
}

function results(p: Project) {
  const d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab);
  const len = (m: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }) => Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
  const ipeMembers = d.members.filter((m) => m.profile === 'IPE200');
  const row = (pr: string) => bom.profiles.find((x) => x.profile === pr);
  const plates = (pr: string) => ({ count: row(pr)?.count ?? 0, kg: row(pr)?.weight ?? 0 });
  const catalog = drawingCatalog(p, d, fab);
  return {
    d, fab, bom, ipeMembers, axisLen: Object.fromEntries(ipeMembers.map((m) => [m.id, len(m)])) as Record<string, number>,
    ipe: row('IPE200'), bp: plates('PL200x12'), ep: plates('PL150x10'), anchors: row('RD20'),
    bolts: bom.bolts.reduce((s, b) => s + b.qty, 0), boltRows: bom.bolts.map((b) => `${b.desc} ×${b.qty}`),
    boltTable: boltsByNodeTable(p, d).rows.length,
    partSheets: catalog.filter((c) => c.type === 'part').length, plateSheets: catalog.filter((c) => c.type === 'plates').length, sheets: catalog.length,
    marks: bom.parts.map((x) => `${x.mark}:${x.profile}×${x.qty}@${Math.round(x.length)}`),
  };
}

describe('KAT מסגרת פורטל — תשובה ידועה', () => {
  const A = results(buildViaCommands());
  const Rb = results(buildReference(true));
  const Rn = results(buildReference(false));
  const kgmApp = A.ipe!.weight / (A.ipe!.length / 1000);

  it('KAT-00: חישוב ידני פנימי עקבי עם הנתונים בהנחיה', () => {
    expect(EXP.ipeKg).toBeCloseTo(313.6, 6); expect(EXP.bpEach).toBeCloseTo(3.768, 6); expect(EXP.epEach).toBeCloseTo(3.5325, 6);
    expect(EXP.totalNoB).toBeCloseTo(321.136, 6); expect(EXP.totalWithB).toBeCloseTo(328.201, 6);
  });

  it('KAT-B: ייחוס בגיאומטריה מדויקת — כתב הכמויות והמשקלים תואמים את החישוב הידני בתוך 0.5%', () => {
    for (const [R, withB] of [[Rn, false], [Rb, true]] as const) {
      expect(R.ipeMembers).toHaveLength(EXP.members);
      expect(R.axisLen).toEqual({ C1: 4000, C2: 4000, B1: 6000 });
      expect(R.ipe!.length).toBeCloseTo(EXP.lenTotal, 6);
      expect(near(R.ipe!.weight, EXP.ipeKg)).toBe(true);
      expect(R.bp.count).toBe(2); expect(near(R.bp.kg, EXP.bpTotal)).toBe(true);
      expect(R.ep.count).toBe(withB ? 2 : 0); if (withB) expect(near(R.ep.kg, EXP.epTotal)).toBe(true);
      expect(near(R.bom.totalWeight, withB ? EXP.totalWithB : EXP.totalNoB)).toBe(true);
    }
  });

  it('KAT-A: דרך פקודות האפליקציה — 3 אלמנטי IPE200, לוחות וברגים לפי הקלט; משקל למטר = 22.4 (כמו בחישוב)', () => {
    expect(A.ipeMembers).toHaveLength(EXP.members);
    expect(near(kgmApp, KGM_IPE200, 0.01)).toBe(true); // 22.4 ק"ג/מ' בקטלוג
    expect(near(massPerMeter(getProfile('IPE200'), RHO), KGM_IPE200, 0.5)).toBe(true);
    expect(A.bp.count).toBe(2); expect(A.bp.kg).toBeCloseTo(EXP.bpTotal, 6);   // 7.536 בדיוק
    expect(A.ep.count).toBe(2); expect(A.ep.kg).toBeCloseTo(EXP.epTotal, 6);   // 7.065 בדיוק
    expect(A.bolts).toBe(EXP.bolts); expect(A.boltRows).toEqual(['M16×45 ×8']);
  });

  it('KAT-A-DEV: סטיות מתועדות של האפליקציה מול הקלט (מקובעות — שינוי באפליקציה ייכשל כאן בכוונה)', () => {
    // אורך הקורה: האפליקציה מאריכה את הקורה מעבר לציר העמוד לפחות עד חצי אורך פלטת ראש העמוד (l/2 = 150 לכל צד) — אין פרמטר שמבטל זאת
    expect(A.axisLen['F1.RAF']).toBeCloseTo(6300, 6);
    expect(A.axisLen['F1.COL.L']).toBeCloseTo(4000, 6); expect(A.axisLen['F1.COL.R']).toBeCloseTo(4000, 6);
    // חלקי הייצור: העמודים נחתכים בעובי הפלטות (3790), הקורה — כמות שהיא
    const parts = Object.fromEntries(A.bom.parts.map((x) => [x.profile + x.mark, x]));
    expect(A.marks.filter((m) => m.startsWith('c1:') || m.startsWith('r1:'))).toEqual(['c1:IPE200×2@3790', 'r1:IPE200×1@6300']);
    expect(Object.keys(parts).length).toBeGreaterThan(0);
    expect(A.ipe!.length).toBeCloseTo(2 * 3790 + 6300, 6);                    // 13880 מול 14000 (−0.86%)
    expect(A.ipe!.weight).toBeCloseTo((2 * 3790 + 6300) / 1000 * KGM_IPE200, 6); // 310.912
    expect(near(A.ipe!.weight, EXP.ipeKg)).toBe(false);                         // מעל 0.5% סטייה
    expect(near(A.axisLen['F1.RAF']!, EXP.lenB1)).toBe(false);
    // תוספות שלא בקלט: 16 מוטות עיגון RD20 (8 לכל בסיס), ריתוכים, אזהרות
    expect(A.anchors!.count).toBe(16); expect(A.anchors!.length).toBeCloseTo(16 * 812, 6); expect(A.anchors!.weight).toBeCloseTo(31.223, 3);
    expect(A.bom.welds.reduce((s, w) => s + w.count, 0)).toBe(20);
    expect(A.bom.profiles.map((x) => x.profile).sort()).toEqual(['IPE200', 'PL150x10', 'PL200x12', 'RD20']);
    expect(A.bom.totalWeight).toBeCloseTo(A.ipe!.weight + A.bp.kg + A.ep.kg + A.anchors!.weight, 6); // 356.736 כולל עיגון
    expect(A.d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('KAT-DWG: כמויות שרטוט/ייצור — גיליון חלק לכל סימון פרופיל, גיליון פלטות, טבלת ברגים; נכתב דוח', () => {
    expect(A.partSheets).toBe(2);            // c1 (עמודים) ו-r1 (קורה); מוטות עיגון ופלטות — בלי גיליון חלק משלהם
    expect(A.plateSheets).toBe(1);           // pl1, pl2 בגיליון פלטות אחד
    expect(A.boltTable).toBeGreaterThan(0);
    const rows: Row[] = [
      { item: 'מספר אלמנטי IPE200', expected: EXP.members, actual: A.ipeMembers.length },
      { item: 'אורך C1 (ציר) מ"מ', expected: EXP.lenC1, actual: A.axisLen['F1.COL.L']! },
      { item: 'אורך C2 (ציר) מ"מ', expected: EXP.lenC2, actual: A.axisLen['F1.COL.R']! },
      { item: 'אורך B1 (ציר) מ"מ', expected: EXP.lenB1, actual: A.axisLen['F1.RAF']!, note: 'האפליקציה מאריכה את הקורה ל-l/2 של פלטת ראש העמוד מעבר לציר' },
      { item: 'אורך כולל IPE200 לפי חלקי ייצור מ"מ', expected: EXP.lenTotal, actual: A.ipe!.length, note: 'העמודים נחתכים ל-3790 (עובי פלטות)' },
      { item: 'משקל למטר IPE200 ק"ג/מ\'', expected: KGM_IPE200, actual: kgmApp },
      { item: 'משקל IPE200 ק"ג', expected: EXP.ipeKg, actual: A.ipe!.weight },
      { item: 'לוחות בסיס — כמות', expected: 2, actual: A.bp.count },
      { item: 'לוחות בסיס — משקל כולל ק"ג', expected: EXP.bpTotal, actual: A.bp.kg },
      { item: 'לוחות ראש עמוד (שלב ב\') — כמות', expected: 2, actual: A.ep.count },
      { item: 'לוחות ראש עמוד — משקל כולל ק"ג', expected: EXP.epTotal, actual: A.ep.kg },
      { item: 'ברגים M16', expected: EXP.bolts, actual: A.bolts },
      { item: 'סה"כ ללא שלב ב\' (IPE + בסיס) ק"ג', expected: EXP.totalNoB, actual: A.ipe!.weight + A.bp.kg },
      { item: 'סה"כ עם שלב ב\' (לפני ברגים, בלי עיגון) ק"ג', expected: EXP.totalWithB, actual: A.ipe!.weight + A.bp.kg + A.ep.kg },
      { item: 'תוספת: מוטות עיגון RD20 (16 יח\') ק"ג', expected: null, actual: A.anchors!.weight, note: 'לא בקלט — נוצרו ע"י בסיס מבוטנת' },
      { item: 'סה"כ BOM של האפליקציה ק"ג', expected: EXP.totalWithB, actual: A.bom.totalWeight, note: 'כולל עיגון' },
      { item: '[ייחוס B] IPE200 ק"ג', expected: EXP.ipeKg, actual: Rb.ipe!.weight },
      { item: '[ייחוס B] סה"כ עם שלב ב\' ק"ג', expected: EXP.totalWithB, actual: Rb.bom.totalWeight },
      { item: 'שרטוטים: גיליונות חלק / פלטות / סה"כ גיליונות', expected: null, actual: A.sheets, note: `${A.partSheets} / ${A.plateSheets} / ${A.sheets}` },
    ];
    const md = ['# KAT — מסגרת פורטל: צפוי מול בפועל', '', '| פריט | צפוי | בפועל | הפרש % | הערה |', '|---|---|---|---|---|',
      ...rows.map((r) => { const d = pct(r); return `| ${r.item} | ${r.expected ?? '—'} | ${r.actual === null ? '—' : +r.actual.toFixed(4)} | ${d === null ? '—' : d.toFixed(3)}${d !== null && Math.abs(d) > 0.5 ? ' ⚠' : ''} | ${r.note ?? ''} |`; }),
      '', `חלקים (סימון:חתך×כמות@אורך): ${A.marks.join(' · ')}`, `ברגים: ${A.boltRows.join(', ')}`,
      `ריתוכים (BOM): ${JSON.stringify(A.bom.welds)}`, `אזהרות מודל: ${[...new Set(A.d.issues.filter((i) => i.severity !== 'info').map((i) => i.code))].join(', ')}`,
      '', 'הנחה: מרווחי ברגים gauge 90 / pitch 200 (לא הוגדרו בקלט). גיאומטריה ושקילה בלבד — לא תכן חוזק.'].join('\n');
    fs.mkdirSync('e2e-results/evidence', { recursive: true });
    fs.writeFileSync('e2e-results/evidence/known-answer-portal.md', md);
    // כל סטייה מעל 0.5% מופיעה בדוח עם סימון; כאן נעגנים רק הפריטים שאמורים להתאים
    const mustMatch = new Set(['מספר אלמנטי IPE200', 'אורך C1 (ציר) מ"מ', 'אורך C2 (ציר) מ"מ', 'משקל למטר IPE200 ק"ג/מ\'', 'לוחות בסיס — כמות', 'לוחות בסיס — משקל כולל ק"ג', 'לוחות ראש עמוד (שלב ב\') — כמות', 'לוחות ראש עמוד — משקל כולל ק"ג', 'ברגים M16', '[ייחוס B] IPE200 ק"ג', '[ייחוס B] סה"כ עם שלב ב\' ק"ג']);
    for (const r of rows.filter((x) => mustMatch.has(x.item))) expect(near(r.actual!, r.expected!, 0.5), r.item).toBe(true);
    const off = rows.filter((r) => { const d = pct(r); return d !== null && Math.abs(d) > 0.5; }).map((r) => r.item);
    expect(off).toEqual(['אורך B1 (ציר) מ"מ', 'אורך כולל IPE200 לפי חלקי ייצור מ"מ', 'משקל IPE200 ק"ג', 'סה"כ ללא שלב ב\' (IPE + בסיס) ק"ג', 'סה"כ עם שלב ב\' (לפני ברגים, בלי עיגון) ק"ג', 'סה"כ BOM של האפליקציה ק"ג']);
  });
});
