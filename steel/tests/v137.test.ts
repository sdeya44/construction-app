import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { erectionSequence } from '../src/fab/sequence';

const proj = () => newProject('t', defaultBuilding());

describe('1.37: מפתח ארוך, סבולת מספור, סדר הקמה', () => {
  it('מפתח 15 מ\': חלוקה אוטומטית ל-3 תת־מפתחים עם תמוכות, אלכסונים בתוך חומר הגלם', () => {
    const p = proj(); const b = p.building;
    b.bracing.roof.enabled = true; b.bracing.roof.bays = [0]; b.bracing.walls.enabled = false;
    b.frames = [0, 15000, 30000].map((y, i) => ({ ...b.frames[0], id: `F${i + 1}`, y }));
    const d = generate(p);
    const struts = d.members.filter((m) => m.id.startsWith('BR.S1.'));
    expect(struts.length).toBe(2 * 2); // 2 גבולות × 2 שיפועים
    const diag = d.members.filter((m) => m.id.startsWith('BR.R1.') && m.kind === 'brace');
    expect(Math.max(...diag.map((m) => Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z)))).toBeLessThan(11900);
    expect(d.connections.some((c) => c.id.startsWith('C.BR.S1.') && c.bolts.length === 2)).toBe(true);
    expect(d.issues.filter((i) => i.code === 'PART_STOCK' || i.code === 'STRUT_CLASH' || i.severity === 'error')).toEqual([]);
    // בחירת משתמש: 2 תת־מפתחים
    b.bracing.roof.ySplit = { '0': 2 };
    expect(generate(p).members.filter((m) => m.id.startsWith('BR.S1.')).length).toBe(2);
  });
  it('מפתח רגיל: ללא שינוי (אין תמוכות)', () => {
    const p = proj(); p.building.bracing.roof.enabled = true;
    expect(generate(p).members.some((m) => m.id.startsWith('BR.S'))).toBe(false);
  });
  it('סבולת מספור: חלקים שונים ב-3 מ"מ מקבלים סימון אחד ומיוצרים כמו הנציג', () => {
    const p = proj(); const b = p.building;
    b.frames = b.frames.map((f, i) => ({ ...f, y: i * 6000 + (i >= 3 ? 3 : 0) }));
    const d = generate(p);
    const marks = (q: typeof p) => { const f = computeFabrication(q, d); return { f, n: new Set(f.parts.map((x) => x.mark)).size }; };
    const a = marks(p);
    p.settings.markTol = 5;
    const c = marks(p);
    expect(c.n).toBeLessThan(a.n);
    expect(c.f.unified!.length).toBeGreaterThan(0);
    for (const mk of new Set(c.f.parts.map((x) => x.mark))) expect(new Set(c.f.parts.filter((x) => x.mark === mk).map((x) => Math.round(x.length))).size).toBe(1);
  });
  it('סדר הקמה: כל מכלול פעם אחת, מתחיל בעמודי מפתח הייצוב, מצטבר = משקל כולל', () => {
    const p = proj(); p.building.bracing.roof.enabled = true;
    const d = generate(p); const fab = computeFabrication(p, d);
    const st = erectionSequence(p, d, fab);
    const n = st.reduce((s, x) => s + x.items.reduce((t, i) => t + i.qty, 0), 0);
    expect(n).toBe(fab.assemblies.length);
    expect(st[0].items.every((i) => /^C/.test(i.mark))).toBe(true);
    expect(st[st.length - 1].cum).toBeCloseTo(fab.assemblies.reduce((s, a) => s + a.weight, 0), 0);
    expect(st.find((x) => x.title.startsWith('השלמות'))).toBeUndefined();
  });
});

describe('1.38.2: עמוד נחתך לפי קורת הגג בפועל', () => {
  it('חריג חתך לקורה: קו הייחוס = פני עליון הקורה, החיתוך = עומק הקורה בפועל + פלטות', async () => {
    const { cutLength } = await import('../src/geometry/solid');
    for (const bp of ['IPE300', 'IPE400']) {
      const p = proj(); const b = p.building;
      b.roofType = 'mono'; b.eaveLeft = 6300; b.eaveRight = 6300; b.slopeLeftPct = 0; b.rafterProfile = bp;
      for (const m of generate(p).members.filter((m) => m.kind === 'rafter')) p.memberOverrides[m.id] = { profile: 'IPE100' };
      const d = generate(p); const c = d.byId.get('F2.COL.L')!;
      expect(Math.round(c.end.z - c.start.z)).toBe(6300);
      expect(Math.round(cutLength(c).max)).toBe(6300 - 100 - 24);
    }
  });
});
