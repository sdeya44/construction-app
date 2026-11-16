import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { SECTION_TEMPLATES } from '../src/model/section';
import { planOmissions, setTransfers } from '../src/commands/commands';
import { defaultKneeBraces } from '../src/geometry/knee';
import type { TbSeat, TbSupport } from '../src/model/types';

const SUPS: TbSupport[] = ['A1', 'A2', 'A3', 'A4', 'A5'];
const errs = (d: ReturnType<typeof generate>) => d.issues.filter((i) => i.severity === 'error');

describe('דילול עמודים — קורה נושאת', () => {
  it('TB-U1: ציר קצה — כל צירופי A1–A5 × B1–B4 ללא שגיאות, העמודים הוסרו', () => {
    for (const sup of SUPS) for (const seat of ['B1', 'B2', 'B3', 'B4'] as TbSeat[]) {
      const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
      b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[3].id, removed: [f[1].id, f[2].id], profile: 'IPE600', support: sup, seat }];
      const d = generate(newProject('x', b));
      expect(errs(d).map((e) => `${sup}/${seat} ${e.code}`)).toEqual([]);
      expect(d.members.some((m) => m.id === `${f[1].id}.COL.L`)).toBe(false);
      expect(d.members.find((m) => m.id === 'TB.T1')).toBeTruthy();
      expect(d.connections.filter((c) => c.type === 'tb-support').length).toBe(2);
    }
  });
  it('TB-U2: ציר פנימי (רכס ומונו רב־מפתחי) — A1–A5 × B1–B3 ללא שגיאות', () => {
    const secs = [
      { lines: [{ id: 'A', x: 0 }, { id: 'B', x: 7000 }, { id: 'C', x: 14000 }], planes: [{ id: 'P1', x0: -300, z0: 5970, x1: 7000, z1: 6700, start: 'x1' }, { id: 'P2', x0: 7000, z0: 6700, x1: 14300, z1: 5970, start: 'x0' }] },
      SECTION_TEMPLATES.find((t) => t.id === 'mono-multi')!.make(),
    ];
    for (const sec of secs) for (const sup of SUPS) for (const seat of ['B1', 'B2', 'B3'] as TbSeat[]) {
      const b = defaultBuilding(); b.section = sec as any;
      b.transfers = [{ id: 'T1', lineId: 'B', from: b.frames[1].id, to: b.frames[3].id, removed: [b.frames[2].id], profile: 'IPE360', support: sup, seat }];
      const d = generate(newProject('x', b));
      expect(errs(d).map((e) => `${sup}/${seat} ${e.code}`)).toEqual([]);
    }
  });
  it('TB-U3: A1 מקצר את העמודים התומכים; B4 עם תמיכה צדית עובר ל־B1', () => {
    const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
    b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[2].id, removed: [f[1].id], profile: 'IPE450', support: 'A1', seat: 'B1' }];
    const base = generate(newProject('x', defaultBuilding()));
    const d = generate(newProject('x', b));
    const top = (dd: typeof d, id: string) => Math.max(dd.members.find((m) => m.id === id)!.start.z, dd.members.find((m) => m.id === id)!.end.z);
    expect(top(d, `${f[0].id}.COL.L`)).toBeLessThan(top(base, `${f[0].id}.COL.L`) - 400);
    b.transfers[0] = { ...b.transfers[0], support: 'A2', seat: 'B4' };
    const d2 = generate(newProject('x', b));
    expect(errs(d2)).toEqual([]);
  });
  it('TB-U4: planOmissions — עמוד פינה נדחה, רצף עמודים מאוחד לקורה אחת עם חתך מוצע', () => {
    const p = newProject('x', defaultBuilding()); const f = [...p.building.frames].sort((x, y) => x.y - y.y);
    const corner = planOmissions(p, [`${f[0].id}.COL.L`]);
    expect(corner.defs.length).toBe(0); expect(corner.errors.length).toBeGreaterThan(0);
    const pl = planOmissions(p, [`${f[1].id}.COL.L`, `${f[2].id}.COL.L`]);
    expect(pl.defs.length).toBe(1);
    expect(pl.defs[0].from).toBe(f[0].id); expect(pl.defs[0].to).toBe(f[3].id);
    expect(pl.defs[0].profile).toMatch(/^IPE\d+/);
    const p2 = setTransfers(pl.defs).run(p);
    expect(errs(generate(p2))).toEqual([]);
  });
  it('TB-U5: אלכסוני עמוד-קורה — נמחקים רק בעמודים שבוטלו; בציר הנגדי ובעמודים המקוצרים נשארים', () => {
    for (const sup of SUPS) {
      const b = defaultBuilding(); const f = [...b.frames].sort((x, y) => x.y - y.y);
      b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
      b.transfers = [{ id: 'T1', lineId: 'L', from: f[1].id, to: f[4].id, removed: [f[2].id, f[3].id], profile: 'IPE600', support: sup, seat: 'B1' }];
      const d = generate(newProject('x', b));
      expect(errs(d).map((e) => `${sup} ${e.message}`)).toEqual([]);
      const kb = d.members.filter((m) => m.id.startsWith('KB.')).map((m) => m.id);
      expect(kb.length).toBe(2 * f.length - 2);
      for (const fr of f) expect(kb.some((id) => id.startsWith(`KB.${fr.id}.R.`))).toBe(true);
      expect(kb.some((id) => id.startsWith(`KB.${f[1].id}.L.`))).toBe(true);
      expect(kb.some((id) => id.startsWith(`KB.${f[2].id}.L.`))).toBe(false);
    }
  });
});
