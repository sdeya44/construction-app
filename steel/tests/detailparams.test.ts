/**
 * DPAR-01..07: מתכון v2 (שלב B של מערכת המחברים המאוחדת) — פרמטרים לאשף (`params`), ערכים למופע (`detailParams`),
 * פקודות, החלה דרך רישום החיבורים, ואימות קובץ ספרייה.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { applyCustomDetails, buildDetail, detailParamValues, detailPresets, paramOverrides, shownParams } from '../src/geometry/detail';
import { exportLibrary, importLibrary } from '../src/geometry/detailLibrary';
import { assignDetail, deleteDetail, resetDetailParams, setDetailParam, setDetailTemplateVar, withDetailCleared } from '../src/commands/commands';
import { applyDetail, customParamDefs, readCurrent, type Situation } from '../src/model/connRegistry';
import type { CustomDetail, Project } from '../src/model/types';
import { libSites } from './libSites';

const PRESETS = detailPresets();
const withParams = PRESETS.filter((x) => x.params?.length);
const FIN = PRESETS.find((x) => x.id === 'lib-fin-web')!;
const KEY = 'T.BEAM|end';

/** פרויקט + רשימות אלמנטים/חיבורים עם קורת בדיקה (HEA200 / IPE200) */
function setup(det: CustomDetail = FIN) {
  const { d, sites } = libSites[0]![1]();
  const p: Project = { ...newProject('dp', defaultBuilding()), customDetails: [structuredClone(det)] };
  const site = sites.find((s) => s.key === KEY)!;
  return { d, p, site };
}
const withAssign = (p: Project, det: CustomDetail = FIN): Project => assignDetail([KEY], det).run(p);
const run = (p: Project, d: ReturnType<typeof setup>['d']) => {
  const members = d.members.map((m) => ({ ...m })), connections = d.connections.map((c) => ({ ...c, parts: [...c.parts], bolts: [...c.bolts], welds: [...c.welds] }));
  const issues = applyCustomDetails(p, members, connections);
  return { members, connections, issues, conn: connections.find((c) => c.custom?.site === KEY) };
};

describe('DPAR מתכון v2 — פרמטרים וערכי מופע', () => {
  it('DPAR-01: כל פרט עם params — השמות מתאימים למשתנים, אפשרויות תקינות, והספרייה כוללת פרטים עם פרמטרים', () => {
    expect(withParams.length).toBeGreaterThanOrEqual(10);
    for (const det of withParams) {
      for (const q of det.params!) {
        expect(det.vars.some((v) => v.name === q.name), `${det.id}.${q.name}`).toBe(true);
        expect(['number', 'select', 'toggle']).toContain(q.kind);
        if (q.kind === 'select') expect(q.options?.length, `${det.id}.${q.name}`).toBeGreaterThan(0);
        if (q.min !== undefined && q.max !== undefined) expect(q.min).toBeLessThan(q.max);
      }
      expect(customParamDefs(det).length, det.id).toBe(shownParams(det).length);
    }
  });

  it('DPAR-02: בלי ערכי מופע — הפרט נבנה בדיוק כמו לפני (תאימות לאחור)', () => {
    const { site } = setup();
    const a = buildDetail(site, FIN), b = buildDetail(site, FIN, { overrides: {} }), c = buildDetail(site, FIN, { overrides: undefined });
    expect(b.values).toEqual(a.values); expect(c.values).toEqual(a.values);
    expect(b.conn.bolts.map((x) => [x.d, x.p])).toEqual(a.conn.bolts.map((x) => [x.d, x.p]));
    // פרט בלי params בכלל (קובץ ישן)
    const old: CustomDetail = { ...structuredClone(FIN), params: undefined };
    expect(shownParams(old)).toEqual([]);
    expect(buildDetail(site, old).conn.bolts.length).toBe(a.conn.bolts.length);
  });

  it('DPAR-03: ערך מופע משנה את הגיאומטריה — קוטר בורג, עובי פלטה ומרחק שפה', () => {
    const { site } = setup();
    const base = buildDetail(site, FIN);
    const o = buildDetail(site, FIN, { overrides: { d: 20, t: 16 } });
    expect(Object.keys(o.errors)).toEqual([]);
    expect(base.conn.bolts.every((x) => x.d === 16)).toBe(true);
    expect(o.conn.bolts.length).toBeGreaterThan(0);
    expect(o.conn.bolts.every((x) => x.d === 20)).toBe(true);
    expect(o.values.d0).toBe(22); // משתנה תלוי (d+2) עוקב אחרי הערך שנדרס
    const plateT = (r: ReturnType<typeof buildDetail>) => [...r.plates.values()].map((q) => q.t);
    expect(Math.max(...plateT(o))).toBeGreaterThan(Math.max(...plateT(base)));
  });

  it('DPAR-04: ערך לא תקין לא מפיל — מחוץ לטווח נחתך, NaN/לא ידוע/טקסט מתעלמים', () => {
    const det = FIN;
    const e = det.params!.find((q) => q.name === 'e')!;
    const out = paramOverrides(det, { e: 9999, t: Number.NaN, zzz: 5, d: '16' as unknown as number });
    expect(out).toEqual({ e: e.max });
    expect(paramOverrides(det, { e: -5 })).toEqual({ e: e.min });
    expect(paramOverrides(det, undefined)).toEqual({});
    const { site } = setup();
    expect(Object.keys(buildDetail(site, det, { overrides: { e: 9999, t: Number.NaN } }).errors)).toEqual([]);
  });

  it('DPAR-05: detailParamValues — ברירות מחדל מהנוסחה, וערך המופע בנפרד', () => {
    const { d } = setup();
    const r0 = detailParamValues(d.members, KEY, FIN)!;
    expect(r0.values.d).toBe(16); expect(r0.defaults.d).toBe(16);
    const r1 = detailParamValues(d.members, KEY, FIN, { d: 24 })!;
    expect(r1.values.d).toBe(24); expect(r1.defaults.d).toBe(16);
    expect(detailParamValues(d.members, 'NOPE|end', FIN)).toBeNull();
  });
});

describe('DPAR פקודות ושיוך', () => {
  it('DPAR-06: setDetailParam רק לקצה משויך; איפוס; חזרה לפרט הרגיל מוחקת ערכים; פרט אחר מאפס, אותו פרט שומר', () => {
    const { p } = setup();
    // אין שיוך — אין מה לשמור
    expect(setDetailParam([KEY], 'd', 20).run(p).detailParams).toBeUndefined();
    const a = withAssign(p);
    const b = setDetailParam([KEY], 'd', 20).run(a);
    expect(b.detailParams).toEqual({ [KEY]: { d: 20 } });
    expect(setDetailParam([KEY], 'e', 50).run(b).detailParams![KEY]).toEqual({ d: 20, e: 50 });
    // null מסיר ערך; כשנשאר ריק — השדה נעלם לגמרי
    expect(setDetailParam([KEY], 'd', null).run(b).detailParams).toBeUndefined();
    expect(resetDetailParams([KEY]).run(b).detailParams).toBeUndefined();
    expect(() => setDetailParam([KEY], 'd', Number.NaN).run(a)).toThrow();
    // שיוך מחדש של אותו פרט — הערכים נשארים; פרט אחר / חזרה לרגיל — מתאפסים
    expect(assignDetail([KEY], FIN).run(b).detailParams).toEqual({ [KEY]: { d: 20 } });
    const other = PRESETS.find((x) => x.id === 'lib-flush-end')!;
    expect(assignDetail([KEY], other).run(b).detailParams).toBeUndefined();
    expect(assignDetail([KEY], null).run(b).detailParams).toBeUndefined();
    expect(withDetailCleared([KEY], null, 'x').run(b).detailParams).toBeUndefined();
    // מחיקת הפרט מהספרייה משחררת גם את הערכים
    expect(deleteDetail(FIN.id).run(b).detailParams).toBeUndefined();
  });

  it('DPAR-07: setDetailTemplateVar משנה את ברירת המחדל של הפרט בספרייה — אתר בלי ערך משלו מקבל אותה, אתר עם ערך לא', () => {
    const { p, d } = setup();
    const a = setDetailParam([KEY], 'e', 60).run(withAssign(p));
    const t = setDetailTemplateVar(FIN.id, 'd', 20).run(a);
    expect(t.customDetails!.find((x) => x.id === FIN.id)!.vars.find((v) => v.name === 'd')!.expr).toBe('20');
    const r = run(t, d);
    expect(r.conn!.bolts.every((b) => b.d === 20)).toBe(true);
    expect(() => setDetailTemplateVar(FIN.id, 'nope', 1).run(a)).toThrow();
    // אתר עם ערך מופע שונה לא מושפע מהתבנית
    const t2 = setDetailParam([KEY], 'd', 12).run(t);
    expect(run(t2, d).conn!.bolts.every((b) => b.d === 12)).toBe(true);
  });

  it('DPAR-08: applyCustomDetails — ערכי המופע חלים על המודל; בלי ערכים — כמו הפרט הבסיסי', () => {
    const { p, d } = setup();
    const a = withAssign(p);
    const base = run(a, d);
    expect(base.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(base.conn!.bolts.every((b) => b.d === 16)).toBe(true);
    const big = run(setDetailParam([KEY], 'd', 24).run(a), d);
    expect(big.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(big.conn!.bolts.every((b) => b.d === 24)).toBe(true);
    expect(big.conn!.bolts.length).toBe(base.conn!.bolts.length);
  });
});

describe('DPAR אשף החיבורים (רישום)', () => {
  const sit = (key: string): Situation => ({ family: 'eave', connId: 'x', title: 't', facts: [], key: 'k', sameCount: 1, local: 'x', site: { key, ang: 90, mainFam: 'IPE', hostFam: 'HEA', similar: [key] } });

  it('DPAR-09: applyDetail לפרט מותאם עם פרמטרים — שיוך + ערכי מופע בלבד לפרמטרים שהפרט מגדיר, ו-readCurrent מחזיר אותם', () => {
    const { p } = setup();
    const n = applyDetail(p, sit(KEY), `custom:${FIN.id}`, { d: 20, e: 55, junk: 7, t: '' }, 'one');
    expect(n.detailAssign![KEY]).toBe(FIN.id);
    expect(n.detailParams).toEqual({ [KEY]: { d: 20, e: 55 } });
    expect(readCurrent(n, sit(KEY))).toMatchObject({ detail: `custom:${FIN.id}`, params: { d: 20, e: 55 } });
    // החלה חוזרת בלי ערכים — חוזרים לברירות המחדל (הערכים הישנים לא נשארים תקועים)
    const m = applyDetail(n, sit(KEY), `custom:${FIN.id}`, {}, 'one');
    expect(m.detailParams).toBeUndefined();
  });

  it('DPAR-10: מתג ובחירה — customParamDefs בונה אפשרויות לא/כן ואפשרויות הפרמטר; show:false מוסתר', () => {
    const det: CustomDetail = {
      id: 'x', name: 'x', vars: [{ name: 'a', expr: '1' }, { name: 'b', expr: '2' }, { name: 'c', expr: '3' }], ops: [],
      params: [{ name: 'a', label: 'מתג', kind: 'toggle' }, { name: 'b', label: 'בחירה', kind: 'select', options: [{ value: 2, label: 'שניים' }, { value: 4, label: 'ארבעה' }] }, { name: 'c', label: 'מוסתר', kind: 'number', show: false }, { name: 'ghost', label: 'בלי משתנה', kind: 'number' }],
    };
    const defs = customParamDefs(det);
    expect(defs.map((q) => q.key)).toEqual(['a', 'b']);
    expect(defs[0]!.toggle).toBe(true); expect(defs[0]!.options).toEqual([{ v: 0, t: 'לא' }, { v: 1, t: 'כן' }]);
    expect(defs[1]!.options).toEqual([{ v: 2, t: 'שניים' }, { v: 4, t: 'ארבעה' }]);
  });
});

describe('DPAR ייבוא/ייצוא ספרייה', () => {
  it('DPAR-11: params עוברים הלוך-חזור; פרמטר פגום / בלי משתנה / בחירה בלי אפשרויות נדחים', () => {
    const txt = exportLibrary([FIN]);
    expect(importLibrary(txt, []).added[0]!.params).toEqual(FIN.params);
    const mk = (params: unknown) => JSON.stringify([{ ...FIN, params }]);
    expect(() => importLibrary(mk('x'), [])).toThrow(/מערך/);
    expect(() => importLibrary(mk([{ name: 'd', label: 'x', kind: 'zzz' }]), [])).toThrow(/פרמטר לא תקין/);
    expect(() => importLibrary(mk([{ name: 'nope', label: 'x', kind: 'number' }]), [])).toThrow(/לא מתאים/);
    expect(() => importLibrary(mk([{ name: 'd', label: 'x', kind: 'select' }]), [])).toThrow(/אפשרויות/);
    // קובץ ישן בלי params נטען כמו קודם
    expect(importLibrary(JSON.stringify([{ ...FIN, params: undefined }]), []).added.length).toBe(1);
  });
});
