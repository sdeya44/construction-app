/**
 * CONSTR — עורך אילוצים בסטודיו (`geometry/constraints.ts`): רשימת אילוצים מהפעולות הקיימות, קישור מידה, שחרור לערך קבוע.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { blankDetail, buildDetail, findSite } from '../src/geometry/detail';
import { flushElementTo, stackPlate, type MateResult } from '../src/geometry/mates';
import { constraintsOf, linkDim, unlinkDim } from '../src/geometry/constraints';
import type { CustomDetail, DetailOp } from '../src/model/types';

const site = () => { const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; const d = generate(newProject('cs', b)); return findSite(d.members, d.members.find((x) => x.id.startsWith('KB.'))!, 'start')!; };
const ok = (r: MateResult) => { expect('error' in r ? r.error : '').toBe(''); return r as Exclude<MateResult, { error: string }>; };
const plate = (id: string, w = '200', h = '150', t = '12'): DetailOp => ({ k: 'plate', id, ref: { on: 'host', face: 'hit', along: '0', across: '0' }, mode: 'flat', spin: '0', off: '0', shape: 'rect', w, h, t, ch: '0', corners: [false, false, false, false] });
const base = (): CustomDetail => ({ ...blankDetail('x'), ops: [plate('P1')] });

describe('CONSTR אילוצים', () => {
  it('CONSTR-01: פלטה בודדת עם מספרים — אין אילוצים; אחרי "פלטה זהה מעליה" ו"הצמד" — קישורי w/h/t, ישיבה וחיתוך', () => {
    expect(constraintsOf(base())).toEqual([]);
    const d1 = ok(stackPlate(base(), 'P1')).det;
    const d2 = ok(flushElementTo(d1, 'P2')).det;
    const kinds = constraintsOf(d2).map((c) => `${c.kind}:${c.id}`);
    expect(kinds).toEqual(['dim-link:P2.w', 'dim-link:P2.h', 'dim-link:P2.t', 'stack:P2.on', 'flush:C1.at']);
  });
  it('CONSTR-02: linkDim מקשר, ומונע קישור עצמי, ליעד לא קיים ומעגלי', () => {
    const det: CustomDetail = { ...base(), ops: [plate('P1'), plate('P2', '90', '80', '10')] };
    const linked = ok(linkDim(det, 'P2', 'w', 'P1')).det;
    expect((linked.ops[1] as Extract<DetailOp, { k: 'plate' }>).w).toBe('P1.w');
    expect(constraintsOf(linked).map((c) => c.id)).toEqual(['P2.w']);
    expect('error' in linkDim(det, 'P1', 'w', 'P1')).toBe(true);
    expect('error' in linkDim(det, 'P1', 'w', 'P9')).toBe(true);
    expect('error' in linkDim(linked, 'P1', 'w', 'P2')).toBe(true); // P2.w = P1.w ⇒ P1.w = P2.w מעגלי
    expect('error' in linkDim(linked, 'P1', 'h', 'P2')).toBe(false); // שדה אחר — מותר
  });
  it('CONSTR-03: unlinkDim — המידה הופכת למספר קבוע, הגיאומטריה זהה, והאילוץ נעלם', () => {
    const s = site();
    const det = ok(stackPlate(base(), 'P1')).det;
    const before = buildDetail(s, det);
    const frozen = ok(unlinkDim(det, 'P2', 'w', before.values['P2.w'])).det;
    expect((frozen.ops[1] as Extract<DetailOp, { k: 'plate' }>).w).toBe('200');
    expect(constraintsOf(frozen).some((c) => c.id === 'P2.w')).toBe(false);
    const after = buildDetail(s, frozen);
    expect(after.values['P2.w']).toBe(before.values['P2.w']);
    expect(after.issues.map((i) => i.code)).toEqual(before.issues.map((i) => i.code));
    // קישור חוזר אפשרי
    const p1w = ok(linkDim(frozen, 'P2', 'w', 'P1')).det; // קישור חוזר
    expect((p1w.ops[1] as Extract<DetailOp, { k: 'plate' }>).w).toBe('P1.w');
  });
  it('CONSTR-04: unlinkDim — מידה שכבר מספר / בלי ערך מחושב ⇒ שגיאה, בלי שינוי', () => {
    expect('error' in unlinkDim(base(), 'P1', 'w', 200)).toBe(true);
    const det = ok(stackPlate(base(), 'P1')).det;
    expect('error' in unlinkDim(det, 'P2', 'w')).toBe(true);
    expect('error' in unlinkDim(det, 'P9', 'w', 5)).toBe(true);
  });
  it('CONSTR-05: משתנה ⇒ dim-var', () => {
    const det: CustomDetail = { ...base(), vars: [{ name: 'pw', expr: '180' }], ops: [plate('P1', 'pw')] };
    expect(constraintsOf(det)).toMatchObject([{ kind: 'dim-var', op: 'P1', field: 'w', name: 'pw' }]);
  });
});
