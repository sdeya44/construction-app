/** UNIT-01..03 (1.69): גיליון מכלול אגד — אגד B ואלכסוני Y בקורה נושאת; פלטה גדולה בגיליון משלה; הפניית חורים. */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { auditSheet } from '../src/drawing/layoutAudit';
import type { BuildingParams } from '../src/model/types';

function build() {
  const b: BuildingParams = defaultBuilding(); b.bracing.walls.enabled = true; b.bracing.walls.type = 'portal';
  const f = [...b.frames].sort((x, y) => x.y - y.y);
  b.transfers = [{ id: 'T1', lineId: 'L', from: f[2]!.id, to: f[4]!.id, removed: [f[3]!.id], profile: 'IPE600', support: 'A2', seat: 'B1', knee: { enabled: true, profile: 'RHS100x100x5', drop: 800, angle: 45 } }];
  const p = numberParts().run(newProject('u', b)); const d = generate(p); const fab = computeFabrication(p, d); const bom = computeBom(d, fab);
  return { p, d, fab, bom, cat: drawingCatalog(p, d, fab) };
}
const texts = (sh: { ents: { k: string; s?: string }[] }) => sh.ents.filter((e) => e.k === 'text').map((e) => e.s!);

describe('UNIT מכלול אגד', () => {
  it('UNIT-01: גיליון לאגד B ולאלכסוני Y — ריתוכים, פרטי פלטות, טבלה, בלי חריגה מהגיליון', () => {
    const { p, d, fab, bom, cat } = build();
    const units = cat.filter((x) => x.type === 'brace-unit');
    expect(units.map((x) => x.title)).toEqual([expect.stringContaining('אגד B'), expect.stringContaining('אלכסוני Y')]);
    for (const def of units) {
      const sh = buildSheet(def, p, d, fab, bom);
      const t = texts(sh);
      expect(sh.size).toBe('A3');
      expect(t.filter((s) => s === 'a5').length, def.id).toBeGreaterThanOrEqual(4); // סמלי ריתוך
      expect(t.some((s) => s.startsWith('פרט א')), def.id).toBe(true);
      expect(t.some((s) => s.includes('פרטי פלטות החיבור')), def.id).toBe(true);
      expect(t.some((s) => s.includes('רשימת חלקים')), def.id).toBe(true);
      expect(auditSheet(sh).filter((x) => x.kind === 'text-outside'), def.id).toEqual([]);
    }
  });
  it('UNIT-02: פלטה גדולה (מעל 600) בגיליון משלה; הפניה "n × Ød" בתא הפלטה', () => {
    const { p, d, fab, bom, cat } = build();
    const big = cat.filter((x) => x.id.startsWith('D-PLATE-'));
    expect(big.length).toBeGreaterThan(0);
    const inGroups = cat.filter((x) => x.id.startsWith('D-PLATES-')).flatMap((x) => x.refs ?? []);
    for (const b of big) expect(inGroups).not.toContain(b.ref);
    const sh = buildSheet(cat.find((x) => x.id.startsWith('D-PLATES-'))!, p, d, fab, bom);
    expect(texts(sh).some((s) => /^\d+ × Ø\d+$/.test(s))).toBe(true);
  });
});
