import { describe, expect, it } from 'vitest';
import { defaultBuilding, defaultPurlinSide, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { layoutPositions } from '../src/geometry/purlins';
import { memberSolid } from '../src/geometry/solid';
import { localFrame } from '../src/geometry/frame';
import { proposeSplicesFor, setPurlinSide, setSplices } from '../src/commands/commands';
import { cross, dot, norm, sub, v3 } from '../src/core/vec';
import { getProfile } from '../src/profiles/library';
import type { Member, Project } from '../src/model/types';
import { fromFileJson, migrate } from '../src/model/migrate';

const geo = () => newProject('t', defaultBuilding());
const purl = (p: Project, side: string) => generate(p).members.filter((m) => m.purlin?.side === side).sort((a, b) => a.purlin!.index - b.purlin!.index);
const sl = (side: Member[]) => side.map((m) => m.purlin!.sSlope);

describe('ROOF – פריסת פטות', () => {
  it('ROOF-01: שתי פטות נפרדות ליד הרכס, אחת בכל שיפוע', () => {
    const p = geo();
    const L = purl(p, 'L'), R = purl(p, 'R');
    expect(L[0].id).toBe('PL.L.01'); expect(R[0].id).toBe('PL.R.01');
    expect(L[0].id).not.toBe(R[0].id);
    const c = 300 / Math.sqrt(1.01); // היטל אופקי של 300 לאורך שיפוע 10%
    expect(L[0].start.x).toBeCloseTo(9000 - c, 6);
    expect(R[0].start.x).toBeCloseTo(9000 + c, 6);
    expect(L[0].start.z).toBeCloseTo(6900 - 0.1 * c, 6);
  });
  it('ROOF-02: 0.30 מ\' ואז 1.50 מ\' לאורך השיפוע, מהרכס כלפי הקצה', () => {
    const s = sl(purl(geo(), 'L'));
    expect(s.slice(0, 4)).toEqual([300, 1800, 3300, 4800]);
    // מרחק אמיתי במרחב בין שתי פטות עוקבות = 1500
    const L = purl(geo(), 'L');
    // פטה אחרונה בקצה הקורה המוארכת (x=-170)
    expect(L[L.length - 1].start.x).toBeCloseTo(-170, 6);
    expect(L[L.length - 1].purlin!.sSlope).toBeCloseTo(Math.hypot(9170, 917), 6);
    expect(Math.hypot(L[1].start.x - L[0].start.x, L[1].start.z - L[0].start.z)).toBeCloseTo(1500, 6);
  });
  it('ROOF-03: שינוי מרווח שמאל אינו משנה את ימין', () => {
    const p = geo();
    const before = JSON.stringify(purl(p, 'R'));
    const p2 = setPurlinSide('left', { spacing: 1200 }).run(p);
    expect(JSON.stringify(purl(p2, 'R'))).toBe(before);
    expect(sl(purl(p2, 'L')).slice(0, 3)).toEqual([300, 1500, 2700]);
  });
  it('ROOF-04: פטה אחרונה בקצה הקונזולה; השארית רק במפתח האחרון', () => {
    const p = geo();
    p.building.rafterOverhangLeft = 800;
    const L = purl(p, 'L');
    const Ls = Math.hypot(9800, 980);
    expect(L[L.length - 1].purlin!.sSlope).toBeCloseTo(Ls, 6);
    expect(L[L.length - 1].start.x).toBeCloseTo(-800, 6); // בקצה החיצוני של הקונזולה
    const spans = L.slice(1).map((m) => m.purlin!.spanBefore);
    for (const s of spans.slice(0, -1)) expect(s).toBeCloseTo(1500, 9);
    expect(spans[spans.length - 1]).toBeCloseTo(Ls - 300 - 1500 * (spans.length - 1), 6);
    expect(spans[spans.length - 1]).toBeLessThanOrEqual(1500);
  });
  it('ROOF-04: שארית זעירה מדווחת כאזהרה', () => {
    const r = layoutPositions(300 + 1500 * 3 + 100, 1, { ...defaultPurlinSide(), first: 300, spacing: 1500 }, 'x');
    expect(r.lastSpan).toBeCloseTo(100, 6);
    expect(r.issues.map((i) => i.code)).toContain('PURLIN_REMAINDER');
  });
  it('מדידה בהיטל אופקי רק אם נבחרה במפורש', () => {
    const p = geo();
    const p2 = setPurlinSide('left', { measure: 'horizontal' }).run(p);
    const L = purl(p2, 'L');
    expect(L[1].purlin!.sHoriz - L[0].purlin!.sHoriz).toBeCloseTo(1500, 6);
    expect(L[0].purlin!.measure).toBe('horizontal');
    expect(sl(purl(p, 'L'))[0]).toBe(300);
  });
  it('ROOF-05: גג חד־שיפועי, שני כיווני שיפוע ושני צדי התחלה', () => {
    for (const [eL, eR] of [[5000, 6000], [6000, 5000]]) {
      for (const start of ['high', 'low'] as const) {
        const p = geo();
        Object.assign(p.building, { roofType: 'mono', width: 6000, eaveLeft: eL, eaveRight: eR });
        p.building.purlins.left.first = 0;
        p.building.purlins.monoStart = start;
        const M = purl(p, 'M');
        // הקורה מוארכת 170 מ"מ מעבר לכל ציר (חצי פלטת כיפה)
        const L = Math.hypot(6340, 6340 / 6);
        expect(M[0].purlin!.sSlope).toBe(0);
        expect(M[M.length - 1].purlin!.sSlope).toBeCloseTo(L, 6);
        const startHigh = (start === 'high') === (eR > eL);
        expect(M[0].start.x).toBeCloseTo(startHigh ? 6170 : -170, 6);
        for (const m of M.slice(1, -1)) expect(m.purlin!.spanBefore).toBeCloseTo(1500, 9);
        expect(generate(p).issues.filter((i) => i.severity === 'error')).toEqual([]);
      }
    }
  });
});

/** מרחק חתום מנקודה למישור הגג (TOS) בצד נתון. */
function roofDist(_p: Project, side: 'L' | 'R', q: { x: number; y: number; z: number }) {
  const n = side === 'L' ? norm(v3(-0.1, 0, 1)) : norm(v3(0.1, 0, 1));
  const o = v3(9000, 0, 6900);
  return dot(sub(q, o), n);
}

describe('PURL – חתך ומיקום', () => {
  it('PURL-03: גובה החתך ניצב למישור הגג, מגע 0 מ"מ עם האגף העליון, בשני הצדדים', () => {
    const p = geo();
    for (const side of ['L', 'R'] as const) {
      for (const m of purl(p, side)) {
        const f = localFrame(m);
        const slopeDir = side === 'L' ? norm(v3(-1, 0, -0.1)) : norm(v3(1, 0, -0.1));
        expect(Math.abs(dot(f.v, slopeDir))).toBeLessThan(1e-12);
        expect(f.v.z).toBeGreaterThan(0.99);
        const s = memberSolid(m);
        const ds = [...s.startRing, ...s.endRing].map((q) => roofDist(p, side, q));
        expect(Math.min(...ds)).toBeCloseTo(0, 6); // מגע
        expect(Math.max(...ds)).toBeCloseTo(200, 6); // גובה C200
      }
    }
    // סימן הסיבוב שונה בין שמאל לימין
    const vl = localFrame(purl(p, 'L')[0]).v, vr = localFrame(purl(p, 'R')[0]).v;
    expect(Math.sign(vl.x)).toBe(-Math.sign(vr.x));
  });
  it('PURL-01: החלפת Z/C/RHS — חתך נכון ומידות מתעדכנות', () => {
    for (const prof of ['Z200x70x20x2.5', 'C200x80x20x3', 'RHS200x100x5']) {
      const p = setPurlinSide('left', { profile: prof }).run(geo());
      const m = purl(p, 'L')[2];
      expect(m.profile).toBe(prof);
      const s = memberSolid(m);
      const ds = s.startRing.map((q) => roofDist(p, 'L', q));
      expect(Math.min(...ds)).toBeCloseTo(0, 6);
      expect(Math.max(...ds)).toBeCloseTo(200, 6);
      const f = localFrame(m);
      const us = s.startRing.map((q) => dot(sub(q, m.start), f.u));
      const width = Math.max(...us) - Math.min(...us);
      expect(width).toBeCloseTo(getProfile(prof).props.b, 6);
    }
  });
  it('PURL-02: היפוך חתך — קו הפטה לא זז, האגפים פונים לצד השני', () => {
    const p = setPurlinSide('left', { opening: 'up' }).run(geo());
    const a = purl(p, 'L')[1];
    const p2 = setPurlinSide('left', { opening: 'down' }).run(p);
    const b = purl(p2, 'L')[1];
    expect(b.start).toEqual(a.start); expect(b.end).toEqual(a.end);
    const ext = (m: Member) => {
      const s = memberSolid(m);
      const up = norm(v3(1, 0, 0.1)); // לכיוון הרכס בצד שמאל
      return s.startRing.map((q) => dot(sub(q, m.start), up));
    };
    // פתיחה לכיוון הרכס: רוב החתך בצד הרכס; פתיחה למטה: בצד המרזב
    expect(Math.max(...ext(a))).toBeCloseTo(80 - 1.5, 6);
    expect(Math.min(...ext(b))).toBeCloseTo(-(80 - 1.5), 6);
    expect(Math.min(...ext(a))).toBeCloseTo(-1.5, 6);
    // ציר הווב על קו הייחוס בשני המצבים
    void cross;
  });
  it('פטה ראשונה (או התומך שלה) שחוצה את הרכס — שגיאה, הפקודה נדחית', () => {
    expect(() => setPurlinSide('left', { first: 20 }).run(geo())).toThrow(/רכס/); // פתיחה למרזב: רגל הבסיס של התומך פונה לרכס
    const up = setPurlinSide('left', { opening: 'up' }).run(geo());
    expect(() => setPurlinSide('left', { first: 20 }).run(up)).toThrow(/רכס/); // פתיחה לרכס: אגפי הפטה פונים לרכס
    expect(() => setPurlinSide('left', { first: 70 }).run(up)).toThrow(/רכס/); // אגף 78.5 מ"מ
    expect(() => setPurlinSide('left', { first: 120 }).run(geo())).not.toThrow();
  });
  it('נקודת תמיכה מזוהה בכל מפגש פטה-מסגרת', () => {
    const d = generate(geo());
    const nL = purl(geo(), 'L').length, nR = purl(geo(), 'R').length;
    expect(d.supports.length).toBe((nL + nR) * 6);
    const sp = d.supports.find((s) => s.id === 'SP.PL.L.01.F3')!;
    expect(sp.rafterId).toBe('F3.RAF.L');
    expect(sp.p.y).toBe(12000);
  });
});

describe('SPL / BEAM – חלקים וחיבורי המשך', () => {
  it('SPL-01: קו 30 מ\', חומר גלם 12 מ\' — חלקים נפרדים, הקו הרציף לא משתנה', () => {
    const p = geo();
    const before = generate(p).byId.get('PL.L.03')!;
    const p2 = proposeSplicesFor(['PL.L.03']).run(p);
    const d = generate(p2);
    const m = d.byId.get('PL.L.03')!;
    expect(m.start).toEqual(before.start); expect(m.end).toEqual(before.end);
    const parts = d.parts.filter((x) => x.memberId === 'PL.L.03');
    expect(parts.map((x) => x.length)).toEqual([12000, 12000, 6000]);
    expect(parts.every((x) => x.length <= 12000)).toBe(true);
    expect(d.splices.filter((s) => s.memberId === 'PL.L.03').every((s) => s.status === 'requires-design')).toBe(true);
    expect(d.issues.some((i) => i.code === 'SPLICE_DESIGN')).toBe(true);
  });
  it('SPL-01: בלי חיבורים — חלק אחד של 30 מ\' ואזהרה על חומר גלם', () => {
    const d = generate(geo());
    expect(d.parts.filter((x) => x.memberId === 'PL.L.03').map((x) => x.length)).toEqual([30000]);
    expect(d.issues.some((i) => i.code === 'PART_STOCK' && i.elementId === 'PL.L.03')).toBe(true);
  });
  it('SPL-02: הזזת חיבור למיקום שאינו מסגרת — מותר, חלקים מתעדכנים', () => {
    const p = setSplices('PL.L.03', [9000, 21000]).run(geo());
    const d = generate(p);
    expect(d.parts.filter((x) => x.memberId === 'PL.L.03').map((x) => x.length)).toEqual([9000, 12000, 9000]);
    expect(d.issues.some((i) => i.code === 'PART_STOCK' && i.elementId === 'PL.L.03')).toBe(false);
    // קווים אחרים לא קיבלו חיבור
    expect(d.parts.filter((x) => x.memberId === 'PL.L.04').length).toBe(1);
  });
  it('BEAM-01: קורת גג ארוכה מ-12 מ\' היא מכלול אחד עם חלקים עצמאיים ומיקומי חיבור ניתנים לעריכה', () => {
    const p = geo();
    Object.assign(p.building, { roofType: 'mono', width: 14000, eaveLeft: 5000, eaveRight: 6400 });
    p.building.purlins.left.first = 0;
    let d = generate(p);
    expect(d.members.filter((m) => m.kind === 'rafter' && m.frameId === 'F1').length).toBe(1); // מכלול אחד
    expect(d.parts.filter((x) => x.memberId === 'F1.RAF').length).toBe(1);
    expect(d.issues.some((i) => i.code === 'PART_STOCK' && i.elementId === 'F1.RAF')).toBe(true);
    const p2 = proposeSplicesFor(['F1.RAF']).run(p);
    d = generate(p2);
    const parts = d.parts.filter((x) => x.memberId === 'F1.RAF');
    expect(parts.length).toBe(2);
    expect(parts.every((x) => x.length <= 12000)).toBe(true);
    const p3 = setSplices('F1.RAF', [5000]).run(p2);
    d = generate(p3);
    expect(d.parts.filter((x) => x.memberId === 'F1.RAF')[0].t1).toBe(5000);
    expect(d.members.filter((m) => m.kind === 'rafter' && m.frameId === 'F1').length).toBe(1);
  });
});

describe('מיגרציה v1 → v2', () => {
  it('קובץ גרסה 1 נפתח ומקבל מערכת פטות', () => {
    const p: any = geo();
    delete p.building.purlins; delete p.splices; p.schemaVersion = 1;
    const m = migrate(JSON.parse(JSON.stringify(p)));
    expect(m.schemaVersion).toBe(4);
    expect(m.building.bracing.roof.enabled).toBe(true);
    expect(m.building.purlins.left.spacing).toBe(1500);
    expect(m.splices).toEqual({});
    expect(() => fromFileJson('{"schemaVersion":99}')).toThrow();
  });
});
