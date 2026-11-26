/**
 * G9-WIZ: אשף החיבורים נפתח גם מחיבורי המשך והצטלבות קושרות שנבנו ממתכון (אתר אמצע / עוגן), והחלפת הפרט עובדת.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { applyDetail, candidates, familyOf, readCurrent, situationOf } from '../src/model/connRegistry';
import type { Project } from '../src/model/types';

const base = () => { const p = newProject('c', defaultBuilding()); p.settings.autoSplice = false; p.splices['PL.L.03'] = [7000]; p.splices['F1.RAF.L'] = [3500]; p.splices['F3.COL.R'] = [3000]; return p; };
const on = (p: Project) => { p.building.purlins.splice = { ...p.building.purlins.splice, engine: 'recipe' }; p.settings.spliceEngine = 'recipe'; p.building.bracing.conn = { ...p.building.bracing.conn, engine: 'recipe' }; return p; };

describe('G9-WIZ אשף מחיבורי מתכון', () => {
  it('משפחה ומצב לכל חיבור שהוסב', () => {
    const p = on(base()), d = generate(p);
    for (const [re, fam, title] of [[/^C\.PS\./, 'psplice', 'חיבור המשך פטה'], [/^C\.RS\./, 'bsplice', 'חיבור המשך קורה / עמוד'], [/^C\.BR\.R.*\.X$/, 'roofx', 'קושרת גג X']] as const) {
      const cs = d.connections.filter((c) => c.type === 'custom' && re.test(c.id));
      expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) {
        expect(familyOf(c)).toBe(fam);
        const s = situationOf(p, d, c.id);
        expect(s?.family).toBe(fam); expect(s!.title).toBe(title);
        expect(candidates(p, s!).length).toBeGreaterThan(0);
        expect(readCurrent(p, s!).detail.startsWith(`${fam}.`)).toBe(true);
      }
    }
    // פרט מותאם של המשתמש (C.CD.*) — עדיין בלי משפחה
    expect(familyOf({ id: 'C.CD.X', type: 'custom', custom: { detailId: 'x', site: 'A|start' } })).toBeNull();
  });
  it('החלפת חיבור המשך קורה למרותך מהאשף — נבנה מחדש ממתכון המרותך', () => {
    const p0 = on(base()), d0 = generate(p0);
    const c = d0.connections.find((x) => x.type === 'custom' && /^C\.RS\.F1\.RAF\.L\./.test(x.id))!;
    const s = situationOf(p0, d0, c.id)!;
    expect(readCurrent(p0, s).detail).toBe('bsplice.bolted');
    const p1 = applyDetail(p0, s, 'bsplice.welded', {}, 'all');
    const d1 = generate(p1);
    const ws = d1.connections.filter((x) => /^C\.WS\.F1\.RAF\.L\./.test(x.id));
    expect(ws.length).toBeGreaterThan(0);
    expect(ws.every((x) => x.type === 'custom' && x.custom!.detailId === 'conv-beam-splice-welded-i')).toBe(true);
    expect(d1.connections.some((x) => /^C\.RS\.F1\.RAF\.L\./.test(x.id))).toBe(false);
  });
});
