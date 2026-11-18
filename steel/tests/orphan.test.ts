import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { defaultKneeBraces } from '../src/geometry/knee';
import { generate } from '../src/geometry/generate';

describe('מחיקת אלמנט משני', () => {
  it('DEL-01: מחיקת אלכסון עמוד-קורה מוחקת גם את הפחים והברגים שלו — ורק שלו', () => {
    const b = defaultBuilding();
    b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
    const p = newProject('x', b);
    const d0 = generate(p);
    const kb = d0.members.find((m) => m.id.startsWith('KB.'));
    expect(kb).toBeTruthy();
    const conns = d0.connections.filter((c) => c.members.includes(kb!.id) || c.parts.includes(kb!.id));
    expect(conns.length).toBeGreaterThan(0);
    const parts = conns.flatMap((c) => c.parts);
    const d1 = generate({ ...p, deleted: [kb!.id] });
    const ids = new Set(d1.members.map((m) => m.id));
    expect(ids.has(kb!.id)).toBe(false);
    expect(parts.filter((x) => x !== kb!.id && (ids.has(x) || ids.has(`${x}.H`)))).toEqual([]);
    expect(d1.connections.some((c) => conns.some((k) => k.id === c.id))).toBe(false);
    // שאר האלכסונים וחיבוריהם נשארים
    const kbCount0 = d0.members.filter((m) => m.id.startsWith('KB.')).length;
    expect(d1.members.filter((m) => m.id.startsWith('KB.')).length).toBe(kbCount0 - 1);
    expect(d1.connections.length).toBe(d0.connections.length - conns.length);
  });
  it('DEL-02: קושרת גג שנמחקה — אין חיבור שמפנה אליה; מחיקת פלטה בודדת לא מוחקת את החיבור', () => {
    const p = newProject('x', defaultBuilding());
    const d0 = generate(p);
    const br = d0.members.find((m) => m.id.startsWith('BR.R'))!;
    const d1 = generate({ ...p, deleted: [br.id] });
    expect(d1.connections.some((c) => c.members.includes(br.id) || c.parts.includes(br.id))).toBe(false);
    expect(d1.members.length).toBeLessThan(d0.members.length - 1);
    const c = d0.connections.find((x) => x.type === 'eave')!;
    const pl = c.parts.find((x) => x.startsWith(`${c.id}.`) && d0.members.some((m) => m.id === x && m.kind === 'plate'))!;
    const d2 = generate({ ...p, deleted: [pl] });
    expect(d2.connections.some((x) => x.id === c.id)).toBe(true);
  });
});
