/**
 * TCHORD — חגורה תחתונה של מסבך גג (1.114, החלטת בעלים 28.11.2026): חיבור ההמשך של קורת הגג (החגורה העליונה) אינו חותך את החגורה התחתונה;
 * היא נחתכת רק ברכס (גג דו-שיפועי) ובאורך מוט. גיאומטריה בלבד.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, framesFromSpacings } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultTrussSpec } from '../src/geometry/truss';
import { setBuilding } from '../src/commands/commands';
import type { BuildingParams } from '../src/model/types';

const roof = (patch: Partial<BuildingParams>, frames: string[] = ['F3']) => {
  const b = defaultBuilding();
  const p = setBuilding({ ...patch, roofTruss: { enabled: true, frames, shape: 'flat', spec: defaultTrussSpec(6, 1000, { top: 'IPE300' }) } } as Partial<BuildingParams>).run(newProject('tc', b));
  return generate(p);
};
const bc = (d: ReturnType<typeof roof>, fid: string) => d.members.filter((m) => new RegExp(`^${fid}(\\.S\\d+)?\\.BC\\.\\d+$`).test(m.id)).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
const len = (m: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }) => Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);

describe('TCHORD חגורה תחתונה של מסבך', () => {
  it('TCHORD-01: קורת גג מפוצלת (12,401 > מוט) והחגורה התחתונה (11,780 ≤ מוט) — חלק אחד, בלי חיבור המשך בחגורה', () => {
    const d = roof({ roofType: 'mono', width: 12000, eaveLeft: 5000, eaveRight: 6200, slopeLeftPct: 10, frames: framesFromSpacings([6000, 6000, 6000, 6000]) });
    expect(d.connections.some((c) => c.id.startsWith('C.RS.F3.RAF'))).toBe(true); // הקורה העליונה אכן מפוצלת
    const b = bc(d, 'F3');
    expect(b).toHaveLength(1);
    expect(Math.round(len(b[0]!))).toBe(11780);
    expect(d.connections.filter((c) => c.id.startsWith('C.TRS.F3')).length).toBe(0);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('TCHORD-02: גג דו-שיפועי — החגורה עדיין נחתכת ברכס (שני חלקים) עם חיבור המשך אחד', () => {
    const d = roof({}, ['F2']);
    const b = bc(d, 'F2');
    expect(b).toHaveLength(2);
    expect(d.connections.filter((c) => c.id.startsWith('C.TRS.F2')).length).toBe(1);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('TCHORD-03: חגורה ארוכה מהמוט — נחתכת באורך מוט (כל חלק ≤ 11,970), ללא תלות בקורת הגג', () => {
    const d = roof({ roofType: 'mono', width: 30000, eaveLeft: 5000, eaveRight: 8000, slopeLeftPct: 10, frames: framesFromSpacings([6000, 6000, 6000, 6000]) });
    const b = bc(d, 'F3');
    expect(b.length).toBeGreaterThanOrEqual(3);
    for (const m of b) expect(len(m)).toBeLessThanOrEqual(11970 + 1);
    expect(d.connections.filter((c) => c.id.startsWith('C.TRS.F3')).length).toBe(b.length - 1);
  });
});
