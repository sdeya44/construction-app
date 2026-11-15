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

// בדיקות ה-ROOF מהאפיון מתייחסות למצב "מרווח קבוע, שארית במפתח האחרון"
const geo = () => { const p = newProject('t', defaultBuilding()); p.building.purlins.left.layout = 'fixed'; p.building.purlins.right.layout = 'fixed'; return p; };
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
    // פטה אחרונה יושבת כולה על הקורה המוארכת: פני האגף (78.5 מ"מ מציר הווב, פתיחה לכיוון המרזב) בקצה הקורה
    expect(L[L.length - 1].purlin!.sSlope).toBeCloseTo(Math.hypot(9170, 917) - 78.5, 6);
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
    expect(L[L.length - 1].purlin!.sSlope).toBeCloseTo(Ls - 78.5, 6); // פני הפטה בקצה החיצוני של הקונזולה
    const spans = L.slice(1).map((m) => m.purlin!.spanBefore);
    for (const s of spans.slice(0, -1)) expect(s).toBeCloseTo(1500, 9);
    expect(spans[spans.length - 1]).toBeCloseTo(Ls - 78.5 - 300 - 1500 * (spans.length - 1), 6);
    expect(spans[spans.length - 1]).toBeLessThanOrEqual(1500);
  });
  it('ROOF-04: שארית זעירה מדווחת כאזהרה', () => {
    const r = layoutPositions(300 + 1500 * 3 + 100, 1, { ...defaultPurlinSide(), layout: 'fixed', first: 300, spacing: 1500 }, 'x');
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
        // הפטה הראשונה והאחרונה יושבות כולן על הקורה (חתך + תומך בתוך הקורה)
        expect(M[0].purlin!.sSlope).toBeGreaterThan(0);
        expect(M[0].purlin!.sSlope).toBeLessThanOrEqual(90);
        expect(M[M.length - 1].purlin!.sSlope).toBeGreaterThanOrEqual(L - 90);
        expect(generate(p).issues.filter((i) => i.code === 'PURLIN_OVERHANG')).toEqual([]);
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
  it('מרחק ראשון קטן מדי ליד הרכס — תיקון אוטומטי למזערי והצעת תיקון (לא נחסם)', () => {
    // פתיחה למרזב: רגל הבסיס של התומך (80 + 1.5) פונה לרכס ⇒ מזערי 95 (מעוגל ל-5, +10 מרווח)
    const p1 = setPurlinSide('left', { first: 20 }).run(geo());
    const d1 = generate(p1);
    const w = d1.issues.find((i) => i.code === 'PURLIN_FIRST_AUTO')!;
    expect(w.fix).toEqual({ label: 'קבע 95 מ"מ', purlinKey: 'left', patch: { first: 95 } });
    expect(purl(p1, 'L')[0].purlin!.sSlope).toBe(95);
    expect(d1.issues.some((i) => i.code === 'PURLIN_RIDGE')).toBe(false);
    // פתיחה לרכס: אגפי הפטה (78.5) פונים לרכס ⇒ מזערי 90
    const up = setPurlinSide('left', { opening: 'up' }).run(geo());
    const d2 = generate(setPurlinSide('left', { first: 70 }).run(up));
    expect(d2.issues.find((i) => i.code === 'PURLIN_FIRST_AUTO')!.fix!.patch).toEqual({ first: 90 });
    // החלת ההצעה מעלימה את האזהרה
    const p3 = setPurlinSide('left', w.fix!.patch).run(p1);
    expect(generate(p3).issues.some((i) => i.code === 'PURLIN_FIRST_AUTO')).toBe(false);
  });
  it('חלוקה אוטומטית שווה: מרווחים שווים ≤ המרבי, בלי שארית קטנה', () => {
    const p = setPurlinSide('left', { layout: 'even' }).run(geo());
    const L = purl(p, 'L');
    const spans = L.slice(1).map((m) => m.purlin!.spanBefore);
    for (const sp of spans) { expect(sp).toBeLessThanOrEqual(1500 + 1e-6); expect(sp).toBeCloseTo(spans[0], 6); }
    expect(generate(p).issues.some((i) => i.code === 'PURLIN_REMAINDER')).toBe(false);
  });
  it('תיקון שיפוע אחד אינו נחסם בגלל בעיה קיימת בשיפוע אחר', () => {
    const p = geo();
    p.building.purlins.right.manualPositions = [5000, 5000]; // שגיאה קיימת בימין
    expect(() => setPurlinSide('left', { spacing: 1400 }).run(p)).not.toThrow();
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
    expect(m.start.y).toBe(-50); expect(m.end.y).toBe(30050);
    const parts = d.parts.filter((x) => x.memberId === 'PL.L.03');
    // קו 30.1 מ'; תומך ב-12.05 — התפר בסוף מוט 12 מ', 50 מ"מ לפני התומך (ניצול מלא)
    expect(parts.map((x) => Math.round(x.length))).toEqual([12000, 12000, 6100]);
    expect(parts.every((x) => x.length <= 12000)).toBe(true);
    // פטה C: חיבור המשך מוברג (פלטה + 4 ברגים) — החלטת משתמש 15.11.2026
    expect(d.splices.filter((s) => s.memberId === 'PL.L.03').every((s) => s.status === 'bolted')).toBe(true);
    expect(d.issues.some((i) => i.code === 'SPLICE_DESIGN')).toBe(false);
  });
  it('SPL-01: בלי חיבורים — חלק אחד של 30 מ\' ואזהרה על חומר גלם', () => {
    const d = generate(geo());
    expect(d.parts.filter((x) => x.memberId === 'PL.L.03').map((x) => x.length)).toEqual([30100]);
    expect(d.issues.some((i) => i.code === 'PART_STOCK' && i.elementId === 'PL.L.03')).toBe(true);
  });
  it('SPL-02: הזזת חיבור למיקום שאינו מסגרת — מותר, חלקים מתעדכנים', () => {
    const p = setSplices('PL.L.03', [9000, 21000]).run(geo());
    const d = generate(p);
    expect(d.parts.filter((x) => x.memberId === 'PL.L.03').map((x) => x.length)).toEqual([9000, 12000, 9100]);
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
    expect(m.schemaVersion).toBe(8);
    expect(m.marks.parts).toEqual({});
    expect(m.settings.kerf).toBe(3);
    expect(m.building.bracing.roof.enabled).toBe(true);
    expect(m.building.purlins.left.spacing).toBe(1500);
    expect(m.splices).toEqual({});
    expect(() => fromFileJson('{"schemaVersion":99}')).toThrow();
  });
});
