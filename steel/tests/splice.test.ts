import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { proposeSplicesFor, setSplices } from '../src/commands/commands';
import { computeFabrication } from '../src/fab/marks';

// הבדיקות כאן על חיבורים ידניים — חלוקה אוטומטית כבויה
const geo = () => { const p = newProject('t', defaultBuilding()); p.settings.autoSplice = false; return p; };

describe('חיבור המשך פטה — פלטה ו-4 ברגים (2 בכל פטה)', () => {
  it('תפר סמוך לתומך (סוף מוט 12 מטר): פלטה בצד הפנימי של הווב, 4 ברגים מחוץ לרוחב הזוויתן, ברגי התומך עוברים גם בפלטה', () => {
    const p = proposeSplicesFor(['PL.L.03']).run(geo());
    const d = generate(p);
    const ts = p.splices['PL.L.03'];
    expect(ts).toEqual([12000, 24000]);
    const s0 = d.byId.get('PL.L.03')!.start.y;
    expect(d.splices.filter((s) => s.memberId === 'PL.L.03').every((s) => s.status === 'bolted')).toBe(true);
    const c = d.connById.get('C.PS.PL.L.03.1')!;
    expect(c.type).toBe('purlin-splice');
    expect(c.bolts.length).toBe(4);
    const rel = c.bolts.map((b) => Math.round(b.p.y - s0 - 12000)).sort((a, b) => a - b);
    // צד ללא תומך: 60 מהתפר; צד התומך (מרכז ב-+50, רוחב 100): מעבר לזוויתן + 35
    expect(rel).toEqual([-60, -60, 135, 135]);
    expect(c.bolts.every((b) => b.d === 12 && b.location === 'site' && b.grip === 3 + 6)).toBe(true);
    expect(d.byId.get('C.PS.PL.L.03.1.PL')!.profile).toBe('PL160x6');
    // ברגי התומך הסמוך עוברים בפלטה
    const sup = d.supports.find((s) => s.purlinId === 'PL.L.03' && Math.abs(s.p.y - s0 - 12050) < 1)!;
    const cc = d.connById.get(`C.PC.PL.L.03.${sup.frameId}`)!;
    expect(cc.bolts.every((b) => b.holesIn.includes('C.PS.PL.L.03.1.PL') && b.grip === 8 + 3 + 6)).toBe(true);
    expect(d.parts.filter((x) => x.memberId === 'PL.L.03').map((x) => Math.round(x.length))).toEqual([12000, 12000, 6100]);
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

describe('אורך קטע פטה לפי מפתחים', () => {
  it('2 מפתחים: תפר מעל מסגרות 3 ו-5', () => {
    const p0 = geo();
    p0.building.purlins.pieceBays = 2;
    const p = proposeSplicesFor(['PL.R.05']).run(p0);
    const d = generate(p);
    expect(d.parts.filter((x) => x.memberId === 'PL.R.05').map((x) => Math.round(x.length))).toEqual([12050, 12000, 6050]);
    // תפר בדיוק מעל תומך: ברגים משני צדי הזוויתן, ברגי הזוויתן עוברים בפלטה
    const c = d.connById.get('C.PS.PL.R.05.1')!;
    const s0 = d.byId.get('PL.R.05')!.start.y;
    expect(c.bolts.map((b) => Math.round(b.p.y - s0 - 12050)).sort((a, b) => a - b)).toEqual([-85, -85, 85, 85]);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });
});
