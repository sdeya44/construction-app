import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';

const mono = () => {
  const p = newProject('t', defaultBuilding());
  Object.assign(p.building, { roofType: 'mono', width: 14800, eaveLeft: 5000, eaveRight: 6480 });
  p.building.purlins.left.first = 0;
  return p;
};

describe('חיבורי המשך אוטומטיים (ברירת מחדל)', () => {
  it('קורת גג ארוכה מ-12 מ\': מוט מלא מקצה המרזב + השלמה; חיבור פלטות קצה מוברג; אין אזהרת חומר גלם', () => {
    const d = generate(mono());
    const parts = d.parts.filter((x) => x.memberId === 'F1.RAF');
    expect(parts.length).toBe(2);
    expect(parts.every((x) => x.length <= 12000)).toBe(true);
    expect(parts[0].length).toBeGreaterThan(11500); // מוט כמעט מלא, התפר לפני תומך פטה
    expect(d.issues.some((i) => i.code === 'PART_STOCK' && /RAF/.test(i.elementId ?? ''))).toBe(false);
    expect(parts[1].t0 - parts[0].t1).toBeCloseTo(24, 6); // שתי פלטות 12 בתפר
    const c = d.connections.find((x) => x.id === 'C.RS.F1.RAF.1')!;
    expect(c.type).toBe('beam-splice');
    expect(c.bolts.length).toBe(8);
    expect(c.bolts.every((b) => b.d === 16 && b.location === 'site')).toBe(true);
    expect(c.welds.every((w) => w.location === 'shop')).toBe(true);
    expect(d.byId.get('C.RS.F1.RAF.1.PL1')!.profile).toBe('PL150x12');
    // התפר אינו על תומך פטה
    const t = d.splices.find((s) => s.memberId === 'F1.RAF')!.t;
    const raf = d.byId.get('F1.RAF')!;
    const L = Math.hypot(raf.end.x - raf.start.x, raf.end.z - raf.start.z);
    const sup = d.supports.filter((s) => s.rafterId === 'F1.RAF').map((s) => ((s.p.x - raf.start.x) * (raf.end.x - raf.start.x) + (s.p.z - raf.start.z) * (raf.end.z - raf.start.z)) / L);
    expect(Math.min(...sup.map((x) => Math.abs(x - t)))).toBeGreaterThanOrEqual(160);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
    expect(d.issues.some((i) => i.code === 'AUTO_SPLICE')).toBe(true);
  });
  it('פטות 30 מ\' מחולקות אוטומטית מעל תומכים; כיבוי — חלק אחד ואזהרה; מיקום ידני גובר', () => {
    const p = newProject('t', defaultBuilding());
    let d = generate(p);
    expect(d.parts.filter((x) => x.memberId === 'PL.L.03').every((x) => x.length <= 12000)).toBe(true);
    p.settings.autoSplice = false;
    d = generate(p);
    expect(d.parts.filter((x) => x.memberId === 'PL.L.03').length).toBe(1);
    expect(d.issues.some((i) => i.code === 'PART_STOCK')).toBe(true);
    p.settings.autoSplice = true;
    p.splices['PL.L.03'] = [];
    d = generate(p);
    expect(d.parts.filter((x) => x.memberId === 'PL.L.03').length).toBe(1); // רשימה ריקה מפורשת = ללא חיבור
  });
});

describe('אופציות חלוקה וקושרות ארוכות', () => {
  it('חלקים שווים; פלטות חיזוק בחיבור ההמשך; קושרות גג ארוכות מחולקות לפנלים; שורת קשירה מחולקת', () => {
    const p = mono();
    let d = generate(p);
    // קושרות X: אלכסון ≤ 12 מ' — שני פנלים לאורך השיפוע
    expect(d.members.filter((m) => /^BR\.R1\.M\.[12]\.[12]$/.test(m.id)).length).toBe(4);
    expect(d.issues.filter((i) => i.code === 'PART_STOCK')).toEqual([]);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
    p.settings.spliceMode = 'equal';
    p.settings.spliceStiffeners = true;
    d = generate(p);
    const parts = d.parts.filter((x) => x.memberId === 'F1.RAF');
    expect(Math.abs(parts[0].length - parts[1].length)).toBeLessThan(400); // חלקים שווים (פחות הסטה מתומך)
    const c = d.connById.get('C.RS.F1.RAF.1')!;
    expect(c.parts.filter((x) => /\.ST[TB]$/.test(x)).length).toBe(4);
    expect(c.bolts.every((b) => b.holesIn.length === 2)).toBe(true);
    expect(d.issues.filter((i) => i.code === 'CLASH')).toEqual([]);
  });
});
