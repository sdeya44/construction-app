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

describe('אלכסוני עמוד-קורה — צד הקונזולה בתוכנית (1.39.2)', () => {
  it('KB-U2: עם קונזולה — עמוד קצה מופיע עם שני צדדיו, ושורת מידות לקונזולה', async () => {
    const { kneeLayout } = await import('../src/ui/SectionEditor');
    const b = defaultBuilding(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
    b.rafterOverhangLeft = 1500; b.rafterOverhangRight = 1500;
    const d = generate(newProject('x', b));
    const keys = [...new Set(d.connections.filter((c) => c.type === 'knee').map((c) => c.id.split('.').slice(3).join('.')))];
    expect(keys).toContain('L.L.L'); expect(keys).toContain('R.R.R');
    const lines = [...d.section!.lines].sort((a, x) => a.x - x.x).map((l) => l.id);
    const { cols, spans } = kneeLayout(keys, lines);
    expect(cols.map((c) => [c.left, c.right])).toEqual([['L.L.L', 'L.L.R'], ['R.R.L', 'R.R.R']]);
    expect(spans.map((s) => s.console)).toEqual([true, false, true]);
    // בלי קונזולה — עמוד קצה עם צד אחד בלבד
    const b0 = defaultBuilding(); b0.kneeBraces = { ...defaultKneeBraces(), enabled: true };
    const d0 = generate(newProject('x', b0));
    const k0 = [...new Set(d0.connections.filter((c) => c.type === 'knee').map((c) => c.id.split('.').slice(3).join('.')))];
    expect(kneeLayout(k0, lines).cols.map((c) => [c.left ?? null, c.right ?? null])).toEqual([[null, 'L.L.R'], ['R.R.L', null]]);
  });
});
