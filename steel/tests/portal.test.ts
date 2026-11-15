import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultPortal } from '../src/geometry/portal';

describe('אגד B — קשיחות לאורך בקיר', () => {
  const mk = () => {
    const b = defaultBuilding();
    b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'portal', portal: defaultPortal() };
    return generate(newProject('t', b));
  };
  it('קורה + 2 אלכסונים בכל מפתח קיר, במקום X', () => {
    const d = mk();
    const beams = d.members.filter((m) => m.id.startsWith('BB.') && !m.id.includes('.K'));
    const kb = d.members.filter((m) => /^BB\..*\.K[12]$/.test(m.id));
    expect(beams.length).toBe(4); // 2 מפתחים × 2 קירות
    expect(kb.length).toBe(8);
    expect(d.members.some((m) => m.id.startsWith('BR.W'))).toBe(false);
    const bm = beams[0];
    expect(bm.start.z).toBeCloseTo(bm.end.z, 6); // אופקית
    expect(bm.start.x).toBeCloseTo(bm.end.x, 6); // במישור ציר העמודים
  });
  it('אלכסון ב-45°, 4 ברגי שטח בכל חיבור, ללא התנגשויות', () => {
    const d = mk();
    const k = d.members.find((m) => /^BB\..*\.K1$/.test(m.id))!;
    const dy = Math.abs(k.end.y - k.start.y), dz = Math.abs(k.end.z - k.start.z);
    expect(Math.atan2(dz, dy) * 180 / Math.PI).toBeGreaterThan(38);
    expect(Math.atan2(dz, dy) * 180 / Math.PI).toBeLessThan(52);
    const cs = d.connections.filter((c) => c.id.startsWith('C.BB.'));
    expect(cs.length).toBe(4 * 6); // 2 קצוות קורה + 2×(עמוד, קורה) לאלכסונים
    expect(cs.every((c) => c.bolts.length === 4 && c.bolts.every((b) => b.location === 'site'))).toBe(true);
    expect(cs.every((c) => c.welds.every((w) => w.location === 'shop'))).toBe(true);
    expect(d.issues.filter((i) => i.code === 'CLASH' && /BB\./.test(i.message + (i.elementId ?? '')))).toEqual([]);
  });
});
