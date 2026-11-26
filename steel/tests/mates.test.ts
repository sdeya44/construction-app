/**
 * MATE — הצמדות בסטודיו הפרטים (שלב ב', `geometry/mates.ts`): פלטה על פלטה + הצמדת קצה האלמנט לפלטה.
 * MATE-01: מפרט ריק ← P1 על המארח ← "פלטה זהה מעליה" ← "הצמד קצה" ← חורים/ברגים/ריתוכים: נבנה כמו הפרט המוכן (אותו מיקום פלטה 2 והקצה), ללא שגיאות.
 * MATE-02: שגיאות ברורות (פלטה לא על המארח; פלטה לא קיימת); חיתוך קיים מתעדכן ולא מוכפל.
 * MATE-03: מידות הפלטה השנייה מקושרות למקור.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { blankDetail, buildDetail, detailPresets, findSite } from '../src/geometry/detail';
import { flushElementTo, stackPlate, type MateResult } from '../src/geometry/mates';
import type { CustomDetail, DetailOp } from '../src/model/types';

const proj = () => { const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; return newProject('mt', b); };
const site = () => { const d = generate(proj()); const m = d.members.find((x) => x.id.startsWith('KB.'))!; return { d, s: findSite(d.members, m, 'start')! }; };
const p1 = (): DetailOp => ({ k: 'plate', id: 'P1', ref: { on: 'host', face: 'hit', along: '0', across: '0' }, mode: 'flat', spin: '0', off: '0', shape: 'rect', w: 'max(mb, hb) + 100', h: 'mh/sin(ang)', t: '12', ch: '0', corners: [false, false, false, false] });
const ok = (r: MateResult) => { expect('error' in r ? r.error : '').toBe(''); return r as Exclude<MateResult, { error: string }>; };

describe('MATE הצמדות', () => {
  it('MATE-01: בנייה בהצמדות = הפרט המוכן (מיקום פלטה 2, קצה האלמנט), ללא שגיאות', () => {
    const { s } = site();
    let det: CustomDetail = { ...blankDetail('בדיקה'), ops: [p1()] };
    det = ok(stackPlate(det, 'P1')).det;
    det = ok(flushElementTo(det, 'P2')).det;
    expect(det.ops.find((o) => o.k === 'cut')).toMatchObject({ kind: 'host', at: 'P1.t + P2.t' });
    det = { ...det, ops: [...det.ops,
      { k: 'holes', id: 'H1', ref: { on: 'P2', face: 'z+', along: '0', across: '0' }, rows: '2', cols: '2', px: '240', py: '50', d0: 'd0' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, noMain: true, noHost: true },
      { k: 'weld', id: 'W1', part: 'P1', a: '5', site: false, to: 'host' }, { k: 'weld', id: 'W2', part: 'P2', a: '5', site: false, to: 'main' }] };
    const r = buildDetail(s, det);
    expect(r.issues.filter((i) => i.severity === 'error' || i.code === 'CD_BOLT').map((i) => `${i.code} ${i.message}`)).toEqual([]);
    expect(r.errors).toEqual({});
    for (const b of r.conn.bolts) expect(b.holesIn.length).toBe(2);
    // אותו מיקום כמו בפרט המוכן עם אותן מידות: P2 ואחר כך קצה האלמנט נצמד לפניה החיצוניות
    const pre = structuredClone(detailPresets().find((x) => x.id === 'preset-plate-plate')!) as CustomDetail;
    pre.vars.find((v) => v.name === 'W')!.expr = 'max(mb, hb) + 100'; pre.vars.find((v) => v.name === 't')!.expr = '12';
    const q = buildDetail(s, pre);
    const a = r.members.find((m) => m.id.endsWith('.P2'))!, b = q.members.find((m) => m.id.endsWith('.P2'))!;
    expect(Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y, a.start.z - b.start.z)).toBeLessThan(0.5);
    expect(Math.hypot(r.main.end.x - q.main.end.x, r.main.end.y - q.main.end.y, r.main.end.z - q.main.end.z) + Math.hypot(r.main.start.x - q.main.start.x, r.main.start.y - q.main.start.y, r.main.start.z - q.main.start.z)).toBeLessThan(0.5);
  });
  it('MATE-02: שגיאות ברורות; חיתוך קיים מתעדכן', () => {
    const base: CustomDetail = { ...blankDetail('x'), ops: [p1()] };
    expect(stackPlate(base, 'P9')).toEqual({ error: 'בחרו פלטה' });
    const onMain: CustomDetail = { ...base, ops: [{ ...(p1() as Extract<DetailOp, { k: 'plate' }>), ref: { on: 'main', face: 'a+', along: '0', across: '0' } }] };
    expect('error' in flushElementTo(onMain, 'P1')).toBe(true);
    const onOpp: CustomDetail = { ...base, ops: [{ ...(p1() as Extract<DetailOp, { k: 'plate' }>), ref: { on: 'host', face: 'opp', along: '0', across: '0' } }] };
    expect('error' in flushElementTo(onOpp, 'P1')).toBe(true);
    const withCut: CustomDetail = { ...base, ops: [...base.ops, { k: 'cut', id: 'C1', kind: 'perp', at: '50' }] };
    const r = ok(flushElementTo(withCut, 'P1'));
    expect(r.det.ops.filter((o) => o.k === 'cut').length).toBe(1);
    expect(r.det.ops.find((o) => o.k === 'cut')).toMatchObject({ kind: 'host', at: 'P1.t' });
    // שרשרת של שלוש
    let d3 = ok(stackPlate(ok(stackPlate(base, 'P1')).det, 'P2')).det;
    expect(ok(flushElementTo(d3, 'P3')).det.ops.find((o) => o.k === 'cut')).toMatchObject({ at: 'P1.t + P2.t + P3.t' });
  });
  it('MATE-03: מידות הפלטה השנייה מקושרות למקור', () => {
    const { s } = site();
    const det = ok(stackPlate({ ...blankDetail('x'), ops: [p1()] }, 'P1')).det;
    const w = (o: CustomDetail) => buildDetail(s, o).values;
    const a = w(det);
    expect(a['P2.w']).toBe(a['P1.w']); expect(a['P2.h']).toBe(a['P1.h']); expect(a['P2.t']).toBe(a['P1.t']);
    const det2 = { ...det, ops: det.ops.map((o) => (o.id === 'P1' && o.k === 'plate' ? { ...o, t: '20', w: '300' } : o)) } as CustomDetail;
    const b = w(det2);
    expect(b['P2.w']).toBe(300); expect(b['P2.t']).toBe(20);
  });
});
