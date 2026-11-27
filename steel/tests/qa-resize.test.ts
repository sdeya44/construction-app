/**
 * QA-RESIZE (בדיקה אוטומטית במנוע — לא בדיקת ממשק): שינוי מידות מבנה שכבר כולל מחברים וחיזוקים, הגדלה/הקטנה/חזרה לערך המקורי.
 * לכל שלב: אין מזהים כפולים, אין NaN, כל הפניות הברגים/ריתוכים לחלקים קיימים, ואחרי החזרה — חתימת המודל זהה לראשונית (אין גיאומטריה ישנה).
 * שגיאות מנוע (CLASH וכד') נספרות ומודפסות לדוח; אינן נחסמות כאן — מטרתן תיעוד (ראו docs/qa-report-195.md).
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, uniformFrames } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultPortal } from '../src/geometry/portal';
import { defaultRafterStruts } from '../src/geometry/rafterStruts';
import type { BuildingParams, DerivedModel, Project } from '../src/model/types';

function rich(): BuildingParams {
  const b = defaultBuilding();
  b.kneeBraces = { ...defaultKneeBraces(), enabled: true, profile: 'RHS80x80x4' };
  b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'portal', portal: { ...defaultPortal() } };
  b.bracing.rafterStruts = { ...defaultRafterStruts(), rows: [{ id: 'r1', from: 'L', toward: 'R', dist: 3000 }] };
  return b;
}
const sig = (d: DerivedModel) => {
  const q = (n: number) => Math.round(n * 10) / 10;
  const mem = d.members.map((m) => `${m.id}|${m.profile}|${q(m.start.x)},${q(m.start.y)},${q(m.start.z)}|${q(m.end.x)},${q(m.end.y)},${q(m.end.z)}`).sort().join(';');
  const con = d.connections.map((c) => `${c.id}|${c.bolts.length}|${c.welds.length}|${c.parts.length}`).sort().join(';');
  return `${d.members.length}/${d.connections.length}/${d.parts.length}#${mem.length}#${hash(mem)}#${hash(con)}`;
};
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
const integrity = (d: DerivedModel, label: string) => {
  const ids = d.members.map((m) => m.id); expect(new Set(ids).size, `${label}: מזהים כפולים`).toBe(ids.length);
  const bad = d.members.filter((m) => ![m.start.x, m.start.y, m.start.z, m.end.x, m.end.y, m.end.z].every(Number.isFinite)); expect(bad.map((m) => m.id), `${label}: NaN`).toEqual([]);
  const byId = new Set(ids);
  const miss: string[] = [];
  for (const c of d.connections) { for (const b of c.bolts) for (const h of b.holesIn) if (h && !byId.has(h)) miss.push(`${c.id}:${b.id}→${h}`); for (const w of c.welds) for (const x of w.between) if (x && !byId.has(x)) miss.push(`${c.id}:${w.id}→${x}`); }
  expect(miss.slice(0, 5), `${label}: הפניות חסרות`).toEqual([]);
};
const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error');
const apply = (name: string, mut: (b: BuildingParams) => void) => ({ name, mut });
const STEPS = [
  apply('רוחב 18→24', (b) => { b.width = 24000; b.ridgeX = 12000; }),
  apply('רוחב 24→12', (b) => { b.width = 12000; b.ridgeX = 6000; }),
  apply('רוחב 12→18 (חזרה)', (b) => { b.width = 18000; b.ridgeX = 9000; }),
  apply('גובה כרכוב 6→7.5', (b) => { b.eaveLeft = 7500; b.eaveRight = 7500; }),
  apply('גובה כרכוב 7.5→5', (b) => { b.eaveLeft = 5000; b.eaveRight = 5000; }),
  apply('גובה כרכוב 5→6 (חזרה)', (b) => { b.eaveLeft = 6000; b.eaveRight = 6000; }),
  apply('שיפוע 10→20%', (b) => { b.slopeLeftPct = 20; }),
  apply('שיפוע 20→10% (חזרה)', (b) => { b.slopeLeftPct = 10; }),
  apply('אורך 30→42 מ׳ (8 מסגרות)', (b) => { b.frames = uniformFrames(8, 42000); }),
  apply('אורך 42→18 מ׳ (4 מסגרות)', (b) => { b.frames = uniformFrames(4, 18000); }),
  apply('אורך 18→30 מ׳ (חזרה, 6 מסגרות)', (b) => { b.frames = uniformFrames(6, 30000); }),
];

describe('QA-RESIZE שינוי מידות במבנה עשיר (מחברים + אלכסונים + אגד B + תמוכות)', () => {
  it('בסיס: מבנה עשיר נבנה, ללא שגיאות', () => {
    const d = generate(newProject('qa', rich()));
    integrity(d, 'בסיס');
    console.log('QA-RESIZE בסיס', d.members.length, 'חברים', d.connections.length, 'חיבורים, שגיאות', errs(d).length);
    expect(errs(d).map((i) => `${i.code} ${i.message}`)).toEqual([]);
  });
  it('סדרת שינויים — שלמות בכל שלב, וחתימה זהה בחזרה לערך המקורי', () => {
    const b0 = rich(); const base = sig(generate(newProject('qa', structuredClone(b0))));
    let b = structuredClone(b0);
    const rows: string[] = [];
    for (const st of STEPS) {
      st.mut(b);
      const p: Project = newProject('qa', structuredClone(b)); const d = generate(p);
      integrity(d, st.name);
      const e = errs(d); const codes = [...new Set(e.map((i) => i.code))].join('+') || '-';
      rows.push(`${st.name}: חברים ${d.members.length}, חיבורים ${d.connections.length}, שגיאות ${e.length} (${codes})`);
      if (st.name.includes('חזרה')) {
        // חזרה מלאה ל-b0: משווים רק כשכל הפרמטרים חזרו (אחרי שלב חזרה של כל קבוצה)
        if (st.name.startsWith('אורך 18→30')) expect(sig(d), `${st.name}: חתימה שונה מהמקור — גיאומטריה ישנה`).toBe(base);
      }
    }
    console.log('QA-RESIZE\n' + rows.join('\n'));
  }, 180000);
  it('הוספה ומחיקה של מסגרת; חזרה', () => {
    const b = rich(); const base = sig(generate(newProject('qa', structuredClone(b))));
    const extra = structuredClone(b); extra.frames = [...extra.frames, { ...extra.frames[extra.frames.length - 1]!, id: 'FX', y: extra.frames[extra.frames.length - 1]!.y + 5000 } as never];
    const d1 = generate(newProject('qa', extra)); integrity(d1, 'מסגרת נוספת');
    const d2 = generate(newProject('qa', structuredClone(b))); expect(sig(d2)).toBe(base);
    const less = structuredClone(b); less.frames = less.frames.slice(0, -1);
    const d3 = generate(newProject('qa', less)); integrity(d3, 'מסגרת פחות');
    console.log('QA-RESIZE מסגרות: +1', d1.members.length, ' בסיס', d2.members.length, ' −1', d3.members.length, 'שגיאות', errs(d1).length, errs(d3).length);
    expect(d1.members.length).toBeGreaterThan(d2.members.length); expect(d3.members.length).toBeLessThan(d2.members.length);
  });
});

import { assignDetail } from '../src/commands/commands';
import { detailPresets } from '../src/geometry/detail';
describe('QA-RESIZE-CD שינוי מבנה כשיש פרט מותאם מושם לאלכסונים', () => {
  it('הקטנת מסגרות/רוחב ← החזרה: ללא שגיאות; השמות יתומות לא פוגעות; חתימה זהה בחזרה', () => {
    const b0 = rich(); const p0 = newProject('qa', structuredClone(b0)); const d0 = generate(p0);
    const dt = structuredClone(detailPresets().find((x) => x.id === 'preset-plate-plate-cham')!);
    const keys = d0.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
    const withCd = assignDetail(keys, dt).run({ ...p0, customDetails: [dt] });
    const base = sig(generate(withCd));
    const step = (mut: (b: BuildingParams) => void) => { const b = structuredClone(withCd.building); mut(b); const p = { ...withCd, building: b }; const d = generate(p); integrity(d, 'cd'); return { p, d }; };
    const small = step((b) => { b.frames = uniformFrames(4, 18000); });
    const live = new Set(small.d.members.map((m) => m.id));
    const orphans = Object.keys(small.p.detailAssign ?? {}).filter((k) => !live.has(k.split('|')[0]!));
    console.log('QA-RESIZE-CD אחרי הקטנה: שגיאות', errs(small.d).length, 'השמות יתומות', orphans.length, 'חיבורים מותאמים', small.d.connections.filter((c) => c.custom).length);
    expect(errs(small.d).map((i) => `${i.code} ${i.message}`)).toEqual([]);
    for (const c of small.d.connections.filter((c) => c.custom)) expect(live.has(c.custom!.site.split('|')[0]!), `חיבור מותאם ${c.id} מצביע על אלמנט שאינו קיים`).toBe(true);
    const narrow = step((b) => { b.width = 12000; b.ridgeX = 6000; });
    expect(errs(narrow.d).map((i) => `${i.code} ${i.message}`)).toEqual([]);
    const back = step((b) => { b.frames = uniformFrames(6, 30000); b.width = 18000; b.ridgeX = 9000; });
    expect(sig(back.d)).toBe(base);
  }, 180000);
});

import { removeFrame } from '../src/commands/commands';
describe('QA-F1 מחיקת מסגרת בפקודה — הפניות למסגרת שנמחקה לא נשארות בפרויקט', () => {
  it('detailAssign / detailParams / connectionOverrides של המסגרת נמחקים; של שאר המסגרות נשמרים; F1 לא פוגע ב-F10', () => {
    const b0 = rich(); const p0 = newProject('qa', structuredClone(b0)); const d0 = generate(p0);
    const dt = structuredClone(detailPresets().find((x) => x.id === 'preset-plate-plate-cham')!);
    const keys = d0.members.filter((m) => m.id.startsWith('KB.')).flatMap((m) => [`${m.id}|start`, `${m.id}|end`]);
    let p = assignDetail(keys, dt).run({ ...p0, customDetails: [dt] });
    p = { ...p, detailParams: { [keys[0]!]: { ch: 30 }, [keys.find((k) => k.includes('.F2.'))!]: { ch: 25 } }, connectionOverrides: { 'C.EAVE.F1.L': { t: 14 }, 'C.EAVE.F2.L': { t: 14 } } as never };
    const n = removeFrame('F1').run(p);
    const all = [...Object.keys(n.detailAssign ?? {}), ...Object.keys(n.detailParams ?? {}), ...Object.keys(n.connectionOverrides)];
    expect(all.filter((k) => /(^|[.|:])F1([.|:]|$)/.test(k))).toEqual([]);
    expect(Object.keys(n.detailAssign ?? {}).length).toBeLessThan(Object.keys(p.detailAssign ?? {}).length);
    expect(Object.keys(n.detailAssign ?? {}).some((k) => k.includes('.F2.'))).toBe(true); // שאר המסגרות נשמרות
    expect(n.detailParams![keys.find((k) => k.includes('.F2.'))!]).toEqual({ ch: 25 });
    expect(n.connectionOverrides['C.EAVE.F2.L']).toBeTruthy();
    expect(errs(generate(n)).map((i) => i.message)).toEqual([]);
  });
});

import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
describe('QA-PROFILE החלפת חתכים במבנה עשיר (מנוע בלבד)', () => {
  const CASES: [string, (b: BuildingParams, v: string) => void, string[]][] = [
    ['עמוד', (b, v) => { b.columnProfile = v; }, ['HEA200', 'HEB240', 'IPE300', 'RHS200x200x8', 'UPN200']],
    ['קורת גג', (b, v) => { b.rafterProfile = v; }, ['IPE300', 'IPE400', 'HEA240', 'IPE200']],
    ['אלכסון עמוד-קורה', (b, v) => { b.kneeBraces = { ...b.kneeBraces!, profile: v }; }, ['RHS80x80x4', 'RHS100x100x5', 'SHS60x60x4', 'L50x5', 'L70x7']],
  ];
  it('לכל חתך: נבנה, שלמות, ייצור וכתב כמויות מחושבים; דוח שגיאות/אזהרות', () => {
    const rows: string[] = [];
    for (const [what, set, vals] of CASES) for (const v of vals) {
      const b = rich(); set(b, v);
      let line = `${what} ${v}: `;
      try {
        const p = newProject('qa', b), d = generate(p); integrity(d, line);
        const fab = computeFabrication(p, d), bom = computeBom(d, fab);
        const e = errs(d), w = d.issues.filter((i) => i.severity === 'warning');
        const codes = (xs: typeof e) => [...new Set(xs.map((i) => i.code))].join('+') || '-';
        expect(fab.parts.every((x) => Number.isFinite(x.length) && x.length > 0 && Number.isFinite(x.weight)), `${line} אורכים/משקלים`).toBe(true);
        line += `שגיאות ${e.length} (${codes(e)}), אזהרות ${w.length} (${codes(w)}), חלקים ${fab.parts.length}, משקל ${Math.round(bom.totalWeight ?? 0)}`;
      } catch (err) { line += `חריגה: ${String(err).slice(0, 100)}`; }
      rows.push(line);
    }
    console.log('QA-PROFILE\n' + rows.join('\n'));
    expect(rows.filter((r) => r.includes('חריגה'))).toEqual([]);
  }, 300000);
  it('שם חתך לא קיים — נחסם/מוסבר (שגיאת ולידציה או חריגה מפורשת), לא שינוי שקט', () => {
    const b = rich(); b.columnProfile = 'FOO999';
    let msg = '';
    try { const d = generate(newProject('qa', b)); msg = d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`).join(' | '); if (!msg) msg = 'SILENT'; } catch (e) { msg = 'THROW ' + String(e).slice(0, 100); }
    console.log('QA-PROFILE חתך לא קיים:', msg);
    expect(msg).not.toBe('SILENT');
  });
});
