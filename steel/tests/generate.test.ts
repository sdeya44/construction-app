import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, uniformFrames } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { memberSolid } from '../src/geometry/solid';
import { dot, sub } from '../src/core/vec';
import { getProfile } from '../src/profiles/library';

const geo01 = () => newProject('GEO-01', defaultBuilding());

describe('GEO-01 – סככה דו־שיפועית 18×30, 6 מסגרות, 6 מ\', 10%', () => {
  const d = generate(geo01());
  it('אין שגיאות ולידציה', () => {
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('12 עמודים, 12 קורות גג, 6 צירי מסגרת, 2 צירי אורך', () => {
    expect(d.members.filter((m) => m.kind === 'column').length).toBe(12);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
    expect(d.members.filter((m) => m.kind === 'rafter').length).toBe(12);
    expect(d.grid.filter((g) => g.dir === 'Y').map((g) => g.pos)).toEqual([0, 6000, 12000, 18000, 24000, 30000]);
    expect(d.grid.filter((g) => g.dir === 'X').map((g) => g.pos)).toEqual([0, 18000]);
  });
  it('רכס ב-6.9 מ\' (6 + 10%·9), השיפוע הימני הנגזר 10%', () => {
    expect(d.roof.ridgeZ).toBeCloseTo(6900, 6);
    expect(d.roof.slopeRight).toBeCloseTo(0.1, 9);
    const rg = d.nodes.find((n) => n.id === 'F1.N.RG')!;
    expect(rg.p).toEqual({ x: 9000, y: 0, z: 6900 });
  });
  it('Z חיובי למעלה: כל נקודות הגג מעל ראשי העמודים, ראשי העמודים מעל הבסיס', () => {
    for (const m of d.members.filter((x) => x.kind === 'rafter')) {
      const s = memberSolid(m);
      const minZ = Math.min(...s.tris.filter((_, i) => i % 3 === 2));
      // עומק אנכי של הקורה בשיפוע = h / cos(α)
      const vDepth = getProfile('IPE300').props.h / Math.cos(Math.atan(0.1));
      // הקורה מוארכת 170 מ"מ מציר העמוד (חצי פלטת כיפה) — הנקודה הנמוכה בקצה המוארך
      expect(minZ).toBeCloseTo(6000 - 0.1 * 170 - vDepth, 6);
    }
    for (const c of d.members.filter((x) => x.kind === 'column')) {
      expect(c.end.z).toBeGreaterThan(c.start.z);
    }
  });
  it('ראש העמוד חתוך בדיוק בפני התחתון של פלטת הכיפה שמתחת לקורת הגג', () => {
    const col = d.byId.get('F1.COL.L')!;
    const s = memberSolid(col);
    for (const p of s.endRing) {
      expect(Math.abs(dot(sub(p, col.endCut!.point), col.endCut!.normal))).toBeLessThan(1e-6);
    }
    // פני התחתון של הקורה: 300 מ"מ בניצב מתחת ל-TOS, ומתחתיו פלטת כיפה 15 מ"מ
    const n = col.endCut!.normal;
    expect(n.z).toBeGreaterThan(0.99);
    expect(dot(sub({ x: 0, y: 0, z: 6000 }, col.endCut!.point), n)).toBeCloseTo(324, 6); // שתי פלטות 12 מ"מ (פרט הלקוח)
  });
  it('קורת גג: פני עליון על קו הייחוס (TOS)', () => {
    const r = d.byId.get('F1.RAF.L')!;
    const s = memberSolid(r);
    const topZ = Math.max(...s.startRing.map((p) => p.z));
    // ללא קונזולה: הקורה מוארכת עד קצה פלטת הכיפה (x=-170); פני עליון שם 6000-17; בציר העמוד — 6000
    expect(r.start.x).toBeCloseTo(-170, 6);
    expect(topZ).toBeCloseTo(6000 - 17, 3);
    expect(r.start.z + 0.1 * 170).toBeCloseTo(6000, 6);
    expect(r.anchor).toBe('top');
  });
  it('דטרמיניסטי: אותו פרויקט ⇒ אותם מזהים ואותה גיאומטריה', () => {
    const p = geo01();
    const a = generate(p), b = generate(p);
    expect(a.members.map((m) => m.id)).toEqual(b.members.map((m) => m.id));
    expect(JSON.stringify(a.members)).toBe(JSON.stringify(b.members));
  });
});

describe('ולידציה ופרמטריות', () => {
  it('רכס מחוץ למפתח — שגיאה ואין גיאומטריה', () => {
    const p = geo01();
    p.building.ridgeX = 20000;
    const d = generate(p);
    expect(d.issues.some((i) => i.code === 'RIDGE_RANGE')).toBe(true);
    expect(d.members.length).toBe(0);
  });
  it('רכס לא מרכזי ועמודים בגבהים שונים: שיפוע ימני נגזר נכון', () => {
    const p = geo01();
    Object.assign(p.building, { ridgeX: 6000, eaveRight: 5000, slopeLeftPct: 15 });
    const d = generate(p);
    expect(d.roof.ridgeZ).toBeCloseTo(6900, 6);
    expect(d.roof.slopeRight).toBeCloseTo(1900 / 12000, 9);
  });
  it('גג חד־שיפועי: עמוד ימין גבוה יותר, שיפוע נגזר', () => {
    const p = geo01();
    Object.assign(p.building, { roofType: 'mono', width: 6000, eaveLeft: 5000, eaveRight: 6000 });
    const d = generate(p);
    expect(d.members.filter((m) => m.kind === 'rafter').length).toBe(6);
    expect(d.roof.slopeLeft).toBeCloseTo(1 / 6, 9);
    expect(d.byId.get('F1.COL.R')!.end.z).toBe(6000);
  });
  it('מרווחי מסגרות לא אחידים נשמרים; מזהה מסגרת יציב בהוספה', () => {
    const p = geo01();
    p.building.frames = [{ id: 'F1', y: 0 }, { id: 'F2', y: 5000 }, { id: 'F9', y: 12500 }];
    const d = generate(p);
    expect(d.byId.has('F9.COL.L')).toBe(true);
    expect(d.byId.get('F9.COL.L')!.start.y).toBe(12500);
  });
  it('קונזולות קורות: קצה הקורה ממשיך בשיפוע', () => {
    const p = geo01();
    p.building.rafterOverhangLeft = 1000;
    const d = generate(p);
    const r = d.byId.get('F1.RAF.L')!;
    expect(r.start.x).toBe(-1000); // קונזולה גדולה מהמינימום — נשמרת
    expect(r.start.z).toBeCloseTo(5900, 6);
  });
  it('התאמה ידנית שהפכה ללא תקפה מדווחת לאחר שינוי פרמטרי', () => {
    const p = geo01();
    const m = generate(p).byId.get('F1.COL.L')!;
    p.memberOverrides['F1.COL.L'] = {
      placement: { start: { ...m.start, x: 100 }, end: { ...m.end, x: 100 }, basis: '' },
    };
    // basis ריק לא תואם ⇒ STALE
    expect(generate(p).issues.some((i) => i.code === 'STALE_OVERRIDE')).toBe(true);
  });
  it('uniformFrames דורש 2 מסגרות לפחות', () => {
    expect(() => uniformFrames(1, 1000)).toThrow();
  });
});
