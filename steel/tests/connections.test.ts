import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { memberSolid } from '../src/geometry/solid';
import { localFrame } from '../src/geometry/frame';
import { boltLength } from '../src/geometry/connections';
import { applyTemplate, saveTemplate, setBuilding, setCleat, setConnection, setPurlinSide } from '../src/commands/commands';
import { dot, norm, sub, v3 } from '../src/core/vec';
import { getProfile } from '../src/profiles/library';
import type { Member, Project } from '../src/model/types';

const geo = () => newProject('t', defaultBuilding());
const errs = (p: Project) => generate(p).issues.filter((i) => i.severity === 'error');
const allPts = (m: Member) => { const s = memberSolid(m); return [...s.startRing, ...s.endRing]; };

/** בודק מגע 0 מ"מ ומיקום רגלי הזוויתן מול ווב הפטה והאגף התחתון שלה. */
function checkCleat(p: Project, purlinId: string, frameId: string) {
  const d = generate(p);
  const pur = d.byId.get(purlinId)!, cl = d.byId.get(`CL.${purlinId}.${frameId}`)!;
  expect(cl).toBeTruthy();
  const pf = localFrame(pur);
  const pp = getProfile(pur.profile);
  // כיוון האגף התחתון של הפטה (במרחב), יחסית לקו הפטה
  const sp = memberSolid(pur);
  const bottom = sp.startRing.filter((q) => dot(sub(q, pur.start), pf.v) < pp.dims.t + 1e-6);
  // RHS סימטרי: "צד הפתיחה" הוא +u המקומי, והזוויתן בדופן הנגדית
  const flangeDir = pp.family === 'RHS' ? 1 : Math.sign(bottom.reduce((s, q) => s + dot(sub(q, pur.start), pf.u), 0));
  const cleatPts = allPts(cl);
  const cs = cleatPts.map((q) => dot(sub(q, pur.start), pf.u) * flangeDir); // קואורדינטה לכיוון האגף התחתון
  // כל הזוויתן בצד הנגדי לאגף התחתון (הבסיס פונה הרחק ממנו)
  // רגל ניצבת צמודה לפני הווב החיצוניים: 0 מ"מ
  const webFace = pp.family === 'RHS' ? pp.props.b / 2 : pp.dims.t / 2;
  expect(Math.max(...cs)).toBeCloseTo(-webFace, 6);
  // רגל הבסיס על מישור הגג (מגע 0 מ"מ עם הקורה)
  const hs = cleatPts.map((q) => dot(sub(q, pur.start), pf.v));
  expect(Math.min(...hs)).toBeCloseTo(0, 6);
  return { d, cl, hs };
}

describe('CLEAT – תומכי זוויתן', () => {
  it('CLEAT-01: נקודת תמיכה ותומך בכל מפגש פטה-מסגרת', () => {
    const d = generate(geo());
    const cleats = d.members.filter((m) => m.kind === 'cleat');
    expect(cleats.length).toBe(d.supports.length);
    expect(d.supports.length).toBe(84);
    for (const sp of d.supports) expect(d.byId.has(`CL.${sp.purlinId}.${sp.frameId}`)).toBe(true);
    expect(d.connections.filter((c) => c.type === 'purlin-cleat').length).toBe(84);
  });
  it('CLEAT-02: C, Z, RHS — רגל ניצבת צמודה לווב, בסיס הרחק מהאגף התחתון, ללא התנגשות', () => {
    for (const [side, pid] of [['left', 'PL.L.03'], ['right', 'PL.R.03']] as const) {
      for (const opening of ['down', 'up'] as const) {
        const p = setPurlinSide(side, { opening }).run(geo());
        checkCleat(p, pid, 'F2');
        expect(errs(p)).toEqual([]);
      }
      for (const prof of ['RHS200x100x5', 'Z200x70x20x2.5']) {
        let p = setPurlinSide(side, { profile: prof }).run(geo());
        if (prof.startsWith('Z')) {
          // Z: הזוויתן בצד האגף העליון — הגובה האוטומטי נעצר מתחת לאגף (200 − 2.5 − r − 5 ⇒ 185), ללא התנגשות
          const d0 = generate(p);
          expect(d0.byId.get(`CL.${pid}.F2`)!.profile.startsWith('L185x')).toBe(true);
          expect(d0.issues.some((i) => i.code === 'CLASH' && i.message.includes(`CL.${pid}`))).toBe(false);
          // גובה ידני מלא — מדווח עם הצעת תיקון
          const pm = setCleat(side, { height: 200 }).run(p);
          const iss = generate(pm).issues.find((i) => i.code === 'CLASH' && i.message.includes(`CL.${pid}`))!;
          expect(iss.cleatFix?.patch).toEqual({ height: null });
          void pm;
        }
        checkCleat(p, pid, 'F2');
        expect(errs(p)).toEqual([]);
      }
    }
  });
  it('CLEAT-03: גובה תומך ברירת מחדל עוקב אחרי גובה הפטה, אלא אם שונה ידנית', () => {
    let p = setPurlinSide('left', { profile: 'C250x80x20x3' }).run(geo());
    let { hs } = checkCleat(p, 'PL.L.02', 'F1');
    expect(Math.max(...hs)).toBeCloseTo(250, 6);
    p = setCleat('left', { height: 180 }).run(p);
    p = setPurlinSide('left', { profile: 'C300x80x20x3' }).run(p);
    ({ hs } = checkCleat(p, 'PL.L.02', 'F1'));
    expect(Math.max(...hs)).toBeCloseTo(180, 6);
    expect(generate(p).issues.some((i) => i.code === 'CLEAT_MANUAL')).toBe(true);
    // שינוי לתומך בודד בלבד
    const p2 = setCleat('left', { height: 150 }, 'CL.PL.L.02.F3').run(geo());
    const d2 = generate(p2);
    const h3 = Math.max(...allPts(d2.byId.get('CL.PL.L.02.F3')!).map((q) => q.z)) - Math.min(...allPts(d2.byId.get('CL.PL.L.02.F3')!).map((q) => q.z));
    const h4 = Math.max(...allPts(d2.byId.get('CL.PL.L.02.F4')!).map((q) => q.z)) - Math.min(...allPts(d2.byId.get('CL.PL.L.02.F4')!).map((q) => q.z));
    expect(h3).toBeLessThan(h4);
  });
  it('CLEAT-04: שינוי שיפוע/כיוון — התומך מתעדכן, אין התנגשות לא מדווחת', () => {
    for (const slope of [5, 20, 35]) {
      const p = setBuilding({ slopeLeftPct: slope }).run(geo());
      const d = generate(p);
      const cl = d.byId.get('CL.PL.L.04.F2')!;
      const n = norm(v3(-slope / 100, 0, 1));
      expect(Math.abs(dot(localFrame(cl).v, n) - 1)).toBeLessThan(1e-12); // ניצב לגג
      checkCleat(p, 'PL.L.04', 'F2');
      expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
    }
  });
  it('ברגים: 2×M12 בשורה, חור 14, אורך תקני, בשטח; ריתוך במסגריה', () => {
    const d = generate(geo());
    const c = d.connById.get('C.PC.PL.L.03.F2')!;
    expect(c.bolts.length).toBe(2);
    expect(c.bolts.every((b) => b.d === 12 && b.hole === 14 && b.location === 'site' && b.grade === '8.8')).toBe(true);
    expect(c.bolts[0].grip).toBe(11); // 8 זוויתן + 3 ווב
    expect(c.bolts[0].length).toBe(35);
    expect(boltLength(12, 11)).toBe(35);
    expect(c.welds.every((w) => w.location === 'shop')).toBe(true);
    expect(Math.abs(c.bolts[0].p.y - c.bolts[1].p.y)).toBeCloseTo(50, 6);
    expect(d.issues.filter((i) => i.code === 'SITE_WELD')).toEqual([]);
  });
});

describe('CONN – חיבורים', () => {
  it('מודל ברירת מחדל: כל החיבורים קיימים וללא התנגשויות', () => {
    const d = generate(geo());
    const t = (x: string) => d.connections.filter((c) => c.type === x).length;
    expect([t('eave'), t('ridge'), t('base')]).toEqual([12, 6, 12]);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('CONN-01: שינוי פלטה/ברגים בחיבור נשמר לאלמנט ומעדכן גיאומטריה', () => {
    const p0 = geo();
    const id = 'C.EAVE.F2.L';
    const before = generate(p0).byId.get('F2.COL.L')!.endCut!;
    const p = setConnection(id, { t: 25, cols: 2, rows: 3, pitch: 120 }).run(p0);
    const d = generate(p);
    const c = d.connById.get(id)!;
    expect(c.bolts.length).toBe(6);
    expect(c.overridden).toBe(true);
    const after = d.byId.get('F2.COL.L')!.endCut!;
    expect(dot(sub(before.point, after.point), after.normal)).toBeCloseTo(26, 6); // העמוד התקצר ב-2×13 (פלטת עמוד ופלטת קורה: 25 במקום 12)
    expect(generate(p).connById.get('C.EAVE.F3.L')!.bolts.length).toBe(4); // חיבור אחר לא השתנה
    expect(JSON.parse(JSON.stringify(p)).connectionOverrides[id].t).toBe(25);
  });
  it('פלטת בסיס מבוטנת: פני הפלטה במפלס הבסיס, 8 מוטות עיגון, ריתוך עמוד בשטח מסומן כחריג מאושר; פלטות רכס מקצרות את הקורות', () => {
    const d = generate(geo());
    const col = d.byId.get('F1.COL.L')!;
    expect(Math.min(...allPts(col).map((q) => q.z))).toBeCloseTo(0, 6);
    const c = d.connById.get('C.BASE.F1.L')!;
    expect(d.members.filter((m) => m.kind === 'anchor' && m.connId === 'C.BASE.F1.L').length).toBe(8);
    const pl = d.byId.get('C.BASE.F1.L.PL')!;
    expect(Math.max(...allPts(pl).map((q) => q.z))).toBeCloseTo(0, 6);
    expect(Math.min(...allPts(pl).map((q) => q.z))).toBeCloseTo(-20, 6);
    expect(c.welds.find((w) => w.id.endsWith('.W1'))!.location).toBe('site');
    expect(d.issues.filter((i) => i.code === 'SITE_WELD_OK').length).toBe(1); // הודעה אחת מרוכזת לכל הפלטות
    expect(d.issues.some((i) => i.code === 'SITE_WELD')).toBe(false);
    // מצב מוברג: העמוד מוגבה מעל הפלטה, ברגים בשטח, ריתוך במסגריה
    const p2 = setConnection('C.BASE.F1.L', { mode: 'bolted', cols: 2, rows: 2, gauge: 160, pitch: 160, w: 320, l: 320, bolt: { d: 20, grade: '8.8', standard: 'ISO 4017', clearance: 6 } }).run(geo());
    const d2 = generate(p2);
    expect(Math.min(...allPts(d2.byId.get('F1.COL.L')!).map((q) => q.z))).toBeCloseTo(20, 6);
    expect(d2.connById.get('C.BASE.F1.L')!.bolts.length).toBe(4);
    const rl = d.byId.get('F1.RAF.L')!;
    expect(Math.max(...allPts(rl).map((q) => q.x))).toBeCloseTo(9000 - 16, 6); // פלטת קודקוד 16
  });
  it('תבנית חיבור: שמירה והחלה על חיבור אחר', () => {
    let p = setConnection('C.BASE.F1.L', { t: 30, w: 400, l: 400, gauge: 150, pitch: 150 }).run(geo());
    const params = { ...p.connectionDefaults.base, ...p.connectionOverrides['C.BASE.F1.L'] } as any;
    p = saveTemplate('בסיס כבד', 'C.BASE.F1.L', params).run(p);
    p = applyTemplate(p.connectionTemplates[0].id, ['C.BASE.F6.R']).run(p);
    const d = generate(p);
    expect(d.byId.get('C.BASE.F6.R.PL')!.profile).toBe('PL400x30');
    expect(() => applyTemplate(p.connectionTemplates[0].id, ['C.EAVE.F1.L']).run(p)).toThrow();
  });
  it('בורג מחוץ לקורה — שגיאה מדווחת (פלטה ארוכה מקצה הקורה)', () => {
    const p = setConnection('C.EAVE.F1.L', { l: 600, pitch: 500 }).run(geo());
    expect(generate(p).issues.some((i) => i.code === 'BOLT_OUTSIDE' && i.elementId === 'C.EAVE.F1.L')).toBe(true);
    expect(generate(geo()).issues.some((i) => i.code === 'BOLT_OUTSIDE')).toBe(false);
  });
  it('מרחקי קצה קטנים מדווחים כאזהרה (לא אישור)', () => {
    const p = setConnection('C.EAVE.F1.L', { w: 120, gauge: 100 }).run(geo());
    expect(generate(p).issues.some((i) => i.code === 'BOLT_EDGE' && i.elementId === 'C.EAVE.F1.L' && i.severity === 'warning')).toBe(true);
  });
});

describe('RIDGE-PL פלטת רכס בעובי אמיתי (1.66)', () => {
  it('חתך PL רוחב×עובי, פלטה אנכית, החורים בפני הפלטה', async () => {
    const { defaultBuilding, newProject } = await import('../src/model/defaults');
    const { generate } = await import('../src/geometry/generate');
    const { computeFabrication } = await import('../src/fab/marks');
    const { numberParts } = await import('../src/commands/commands');
    const p = newProject('r', defaultBuilding());
    const d = generate(p);
    const c = d.connections.find((x) => x.type === 'ridge')!;
    const prm = p.connectionDefaults.ridge;
    for (const id of [`${c.id}.PL1`, `${c.id}.PL2`]) {
      const m = d.byId.get(id)!;
      expect(m.profile).toBe(`PL${prm.w}x${prm.t}`);
      expect(Math.abs(m.end.z - m.start.z)).toBeGreaterThan(300); // לאורך Z — גובה הפלטה
      expect(Math.abs(m.refUp.x)).toBe(1); // עובי לאורך X
    }
    const fab = computeFabrication(numberParts().run(p), d);
    const part = fab.parts.find((x) => x.memberId === `${c.id}.PL1`)!;
    expect(part.holes.length).toBe(c.bolts.length);
    expect(part.holes.every((h) => h.face === 'flange')).toBe(true);
  });
});
