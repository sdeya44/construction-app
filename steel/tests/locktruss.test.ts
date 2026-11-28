import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { aabb, aabbOverlap, clash } from '../src/geometry/clash';
import { defaultLockTruss } from '../src/geometry/lockTruss';
import { computeFabrication } from '../src/fab/marks';
import { numberParts } from '../src/commands/commands';
import type { Member } from '../src/model/types';

const clashes = (d: ReturnType<typeof generate>, pick: (m: Member) => boolean) => {
  const parts = d.members.filter(pick);
  const others = d.members.filter((m) => ['rafter', 'column', 'purlin', 'cleat', 'plate', 'brace', 'beam'].includes(m.kind));
  const bad: string[] = [];
  const welded = new Set<string>();
  for (const c of d.connections) for (const w of c.welds) welded.add([...w.between].sort().join('|'));
  for (const a of parts) for (const o of others) {
    if (a.id === o.id || /\.B\d+\.S$/.test(a.id) || !aabbOverlap(aabb(a), aabb(o))) continue;
    if (welded.has([a.id, o.id].sort().join('|'))) continue;
    const k = clash(a, o);
    if (k && k.depth > 0.5) bad.push(`${a.id} ↔ ${o.id} ${k.depth.toFixed(1)}`);
  }
  return [...new Set(bad)];
};

describe('נעילה אופקית — מסבך + סיב רציף (תוכנית 130)', () => {
  for (const [conn, pos, col] of [['plate', 'above', 'RHS120x120x5'], ['plate', 'below', 'HEA200'], ['tongue', 'above', 'RHS120x120x5'], ['tongue', 'below', 'HEA200']] as const) {
    it(`${conn} / ${pos} / ${col}`, () => {
      const b = defaultBuilding();
      b.columnProfile = col;
      b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss', truss: { ...defaultLockTruss(), conn, position: pos } };
      const p = newProject('lt', b);
      const d = generate(p);
      expect(d.issues.filter((i) => i.severity === 'error').map((i) => i.message)).toEqual([]);
      const lt = d.members.filter((m) => m.id.startsWith('LT.'));
      expect(lt.some((m) => m.id.endsWith('.S'))).toBe(true);
      expect(lt.some((m) => /\.D\d+$/.test(m.id))).toBe(true);
      // סיב בכל מפתח
      const nb = b.frames.length - 1;
      expect(lt.filter((m) => m.id.endsWith('.C')).length).toBe(2 * nb);
      expect(clashes(d, (m) => m.id.startsWith('LT.') || m.id.startsWith('C.LT.'))).toEqual([]);
      const fab = computeFabrication(numberParts().run(p), d);
      // המסבך: מכלול אחד (סיב + חגורה + אלכסונים)
      const a = fab.parts.find((x) => x.memberId.startsWith('LT.') && x.memberId.endsWith('.S'))!;
      const asm = fab.assemblies.find((x) => x.id === a.assembly)!;
      expect(asm.parts.filter((id) => id.startsWith('LT.')).length).toBeGreaterThan(3);
    }, 60000); // ~5 שניות: ברירת המחדל של vitest 4 (5 שניות) אינה מספיקה
  }
});
