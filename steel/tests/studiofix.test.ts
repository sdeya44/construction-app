/**
 * STUDIO-FIX — שלב ג': תיקון בלחיצה ו"הפוך לפרמטר" (`geometry/mates.ts`).
 * FIX-01: חור קרוב לשפה ⇒ ל-CD_EDGE יש `studioFix`; ההחלה מעלה את המידה הנכונה (w/h) והאזהרה נעלמת.
 * FIX-02: פלטה מקושרת (`P1.w`) — מגדילים את המקור, שתי הפלטות נשארות זהות; מידה שהיא משתנה — מגדילים את המשתנה.
 * PARAM-01: "הפוך לפרמטר" יוצר משתנה + שדה באשף, ערך המופע דורס את המידה.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { blankDetail, buildDetail, findSite } from '../src/geometry/detail';
import { growPlate, promoteToParam, stackPlate, flushElementTo, type MateResult } from '../src/geometry/mates';
import type { CustomDetail, DetailOp } from '../src/model/types';

const site = () => { const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; const d = generate(newProject('sf', b)); return findSite(d.members, d.members.find((x) => x.id.startsWith('KB.'))!, 'start')!; };
const ok = (r: MateResult) => { expect('error' in r ? r.error : '').toBe(''); return r as Exclude<MateResult, { error: string }>; };
const plate = (w: string, h: string): DetailOp => ({ k: 'plate', id: 'P1', ref: { on: 'host', face: 'hit', along: '0', across: '0' }, mode: 'flat', spin: '0', off: '0', shape: 'rect', w, h, t: '12', ch: '0', corners: [false, false, false, false] });
const withBolts = (ops: DetailOp[], px: string, py: string, plateId = 'P1'): DetailOp[] => [...ops,
  { k: 'holes', id: 'H1', ref: { on: plateId, face: 'z+', along: '0', across: '0' }, rows: '2', cols: '2', px, py, d0: 'd0' },
  { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, noMain: true, noHost: true }];
const edge = <T extends { code: string }>(iss: T[]) => iss.filter((i) => i.code === 'CD_EDGE');

describe('STUDIO-FIX תיקון בלחיצה', () => {
  it('FIX-01: חור קרוב לשפה ברוחב — הצעת תיקון על w, והאזהרה נעלמת', () => {
    const s = site();
    const det: CustomDetail = { ...blankDetail('x'), ops: withBolts([plate('300', '200')], '290', '60') }; // 5 מ"מ מהשפה לרוחב; לגובה 70
    const r = buildDetail(s, det);
    const e = edge(r.issues);
    expect(e.length).toBe(1);
    expect(e[0]).toMatchObject({ studioFix: { op: 'P1', field: 'w' } });
    const fixed = ok(growPlate(det, e[0]!.studioFix!.op, e[0]!.studioFix!.field, e[0]!.studioFix!.add)).det;
    expect(edge(buildDetail(s, fixed).issues)).toEqual([]);
    expect((fixed.ops[0] as Extract<DetailOp, { k: 'plate' }>).w).toBe(String(300 + e[0]!.studioFix!.add));
  });
  it('FIX-01b: חור קרוב לשפה בגובה — התיקון על h', () => {
    const s = site();
    const det: CustomDetail = { ...blankDetail('x'), ops: withBolts([plate('300', '200')], '100', '190') };
    const e = edge(buildDetail(s, det).issues);
    expect(e[0]).toMatchObject({ studioFix: { field: 'h' } });
  });
  it('FIX-02: פלטה מקושרת — מקור גדל ושתי הפלטות זהות; משתנה — הוא גדל', () => {
    const s = site();
    let det: CustomDetail = { ...blankDetail('x'), ops: [plate('300', '200')] };
    det = ok(stackPlate(det, 'P1')).det;
    det = { ...det, ops: withBolts(det.ops, '290', '60', 'P2') };
    const e = edge(buildDetail(s, det).issues);
    expect(e[0]).toMatchObject({ studioFix: { field: 'w' } });
    const f = ok(growPlate(det, 'P2', 'w', e[0]!.studioFix!.add)).det; // גם אם מתקנים דרך P2 — המקור P1 גדל
    const w = (id: string) => (f.ops.find((o) => o.id === id) as Extract<DetailOp, { k: 'plate' }>).w;
    expect(w('P2')).toBe('P1.w'); expect(w('P1')).toBe(String(300 + e[0]!.studioFix!.add));
    const bv = buildDetail(s, f);
    expect(bv.values['P1.w']).toBe(bv.values['P2.w']);
    expect(edge(bv.issues)).toEqual([]);
    // משתנה
    const dv: CustomDetail = { ...blankDetail('x'), vars: [...blankDetail('x').vars, { name: 'W', expr: '300' }], ops: [plate('W', '200')] };
    expect((ok(growPlate(dv, 'P1', 'w', 10)).det.vars.find((v) => v.name === 'W')!.expr)).toBe('310');
    expect('error' in growPlate(dv, 'P9', 'w', 10)).toBe(true);
  });
  it('FIX-03: אין תיקון לפלטה ללא פעולה / לא מלבנית', () => {
    const s = site();
    const det: CustomDetail = { ...blankDetail('x'), ops: withBolts([{ ...(plate('300', '200') as Extract<DetailOp, { k: 'plate' }>), shape: 'cham', ch: '20', corners: [true, false, false, false] }], '290', '60') };
    for (const i of edge(buildDetail(s, det).issues)) expect(i.studioFix).toBeUndefined();
  });
});

describe('PARAM הפוך לפרמטר', () => {
  it('PARAM-01: משתנה + שדה באשף + דריסה בערך מופע', () => {
    const s = site();
    const det0: CustomDetail = { ...blankDetail('x'), ops: [plate('200', '150')] };
    const det = ok(promoteToParam(det0, 'P1', 'w', 200)).det;
    expect(det.vars.find((v) => v.name === 'P1w')).toMatchObject({ expr: '200' });
    expect(det.params?.find((p) => p.name === 'P1w')).toMatchObject({ kind: 'number', min: 100, max: 600, unit: 'מ"מ', group: 'פלטות' });
    expect((det.ops[0] as Extract<DetailOp, { k: 'plate' }>).w).toBe('P1w');
    expect(buildDetail(s, det).values['P1.w']).toBe(200);
    expect(buildDetail(s, det, { overrides: { P1w: 260 } }).values['P1.w']).toBe(260);
    expect('error' in promoteToParam(det, 'P1', 'w')).toBe(true); // כבר פרמטר
    const det2 = ok(promoteToParam(det, 'P1', 'h', 150)).det;
    expect(det2.params?.map((p) => p.name)).toEqual(['P1w', 'P1h']);
  });
  it('PARAM-02: מידה שהיא נוסחה נשמרת כנוסחה כברירת המחדל', () => {
    const det = ok(promoteToParam({ ...blankDetail('x'), ops: [plate('max(mb, hb) + 20', '150')] }, 'P1', 'w', 220)).det;
    expect(det.vars.find((v) => v.name === 'P1w')!.expr).toBe('max(mb, hb) + 20');
  });
  it('MATE-רצף: הצמדה + תיקון + פרמטר משתלבים', () => {
    const s = site();
    let det: CustomDetail = { ...blankDetail('x'), ops: [plate('300', '200')] };
    det = ok(promoteToParam(det, 'P1', 'w', 300)).det;
    det = ok(stackPlate(det, 'P1')).det;
    det = ok(flushElementTo(det, 'P2')).det;
    const r = buildDetail(s, det);
    expect(r.errors).toEqual({});
    expect(r.values['P2.w']).toBe(300);
  });
});

describe('ANGLE זוויתן בסטודיו', () => {
  it('ANGLE-01: פעולת זוויתן (כלי חדש) נבנית: פרופיל L, ללא שגיאות נוסחה', () => {
    const s = site();
    const det: CustomDetail = { ...blankDetail('x'), ops: [{ k: 'angle', id: 'L1', name: 'זוויתן', ref: { on: 'host', face: 'hit', along: '0', across: '0' }, H: '60', B: '60', t: '6', w: '100' }] };
    const r = buildDetail(s, det);
    expect(r.errors).toEqual({});
    const a = r.members.find((m) => m.id.endsWith('.L1'));
    expect(a).toBeTruthy();
    expect(a!.profile).toMatch(/^L60x60x6/);
  });
});
