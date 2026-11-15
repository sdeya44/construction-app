import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { proposeSplicesFor, setSplices } from '../src/commands/commands';
import { computeFabrication } from '../src/fab/marks';

const geo = () => newProject('t', defaultBuilding());

describe('חיבור המשך פטה — פלטה ו-4 ברגים (2 בכל פטה)', () => {
  it('תפר מעל תומך: פלטה בצד הפנימי של הווב, 4 ברגים מחוץ לרוחב הזוויתן, ברגי התומך עוברים גם בפלטה', () => {
    const p = proposeSplicesFor(['PL.L.03']).run(geo());
    const d = generate(p);
    const ts = p.splices['PL.L.03'];
    expect(ts.length).toBeGreaterThanOrEqual(2);
    const sp = d.splices.filter((s) => s.memberId === 'PL.L.03');
    expect(sp.every((s) => s.status === 'bolted')).toBe(true);
    const c = d.connById.get('C.PS.PL.L.03.1')!;
    expect(c.type).toBe('purlin-splice');
    expect(c.bolts.length).toBe(4);
    const tj = ts[0];
    const left = c.bolts.filter((b) => b.p.y - d.byId.get('PL.L.03')!.start.y < tj).length;
    expect(left).toBe(2);
    expect(c.bolts.every((b) => b.d === 12 && b.location === 'site' && b.grip === 3 + 6)).toBe(true);
    // מעל תומך: עמודת הברגים במרחק ≥ חצי רוחב הזוויתן + שפה
    const off = Math.min(...c.bolts.map((b) => Math.abs(b.p.y - d.byId.get('PL.L.03')!.start.y - tj)));
    expect(off).toBeGreaterThanOrEqual(50 + 30);
    const plate = d.byId.get('C.PS.PL.L.03.1.PL')!;
    expect(plate.profile).toBe('PL160x6');
    // בורג התומך בתפר עובר בפלטה: אחיזה מוגדלת ושלושה חלקים
    const sup = d.supports.find((s) => s.purlinId === 'PL.L.03' && Math.abs(s.p.y - d.byId.get('PL.L.03')!.start.y - tj) < 1)!;
    const cc = d.connById.get(`C.PC.PL.L.03.${sup.frameId}`)!;
    expect(cc.bolts.every((b) => b.holesIn.includes('C.PS.PL.L.03.1.PL') && b.grip === 8 + 3 + 6)).toBe(true);
    expect(d.issues.filter((i) => i.code === 'CLASH' || (i.severity !== 'info' && i.elementId?.startsWith('C.PS')))).toEqual([]);
  });
  it('תפר באמצע מפתח: עמודת ברגים במרחק ברירת המחדל; חורים בשני חלקי הפטה', () => {
    const p = setSplices('PL.R.02', [10000]).run(geo());
    const d = generate(p);
    const c = d.connById.get('C.PS.PL.R.02.1')!;
    const s0 = d.byId.get('PL.R.02')!.start.y;
    expect(c.bolts.map((b) => Math.round(Math.abs(b.p.y - s0 - 10000))).sort()).toEqual([60, 60, 60, 60]);
    const fab = computeFabrication(p, d);
    const parts = fab.parts.filter((x) => x.memberId === 'PL.R.02');
    expect(parts.length).toBe(2);
    for (const pt of parts) expect(pt.holes.filter((h) => h.boltId.startsWith('C.PS.')).length).toBe(2);
    expect(d.issues.filter((i) => i.code === 'SPLICE_DESIGN')).toEqual([]);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });
});
