import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { defaultKneeBraces } from '../src/geometry/knee';
import { generate } from '../src/geometry/generate';

describe('אלכסוני עמוד-קורה — לפי מסגרת', () => {
  it('KB-U1: offCells מבטל אלכסון במסגרת אחת בלבד, עם הפלטות שלו', () => {
    const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
    const d0 = generate(newProject('x', b));
    const f2 = [...b.frames].sort((x, y) => x.y - y.y)[1].id;
    b.kneeBraces = { ...b.kneeBraces, offCells: [`${f2}|L.L.R`] };
    const d1 = generate(newProject('x', b));
    const kb = (d: typeof d0) => d.members.filter((m) => m.id.startsWith('KB.')).map((m) => m.id);
    expect(kb(d1).length).toBe(kb(d0).length - 1);
    expect(kb(d1)).not.toContain(`KB.${f2}.L.L.R`);
    expect(d1.members.some((m) => m.id.startsWith(`C.KB.${f2}.L.L.R`))).toBe(false);
    expect(d1.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
