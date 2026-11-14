import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, uniformFrames } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { computeFabrication } from '../src/fab/marks';
import { computeBom, cutPlans } from '../src/fab/bom';

/** מבנה בדיקת עומס: 26×245 מ', 50 מסגרות — כ-10,000 אלמנטים (כולל ברגים). */
export function bigProject() {
  const b = defaultBuilding();
  Object.assign(b, { width: 26000, ridgeX: 13000, frames: uniformFrames(50, 245000) });
  b.bracing.roof.bays = [0, 9, 19, 29, -1];
  return newProject('עומס', b);
}

describe('ביצועים (M6)', () => {
  it('גזירת מודל של כ-10,000 אלמנטים, כולל חיבורים והתנגשויות', () => {
    const p = bigProject();
    const t0 = performance.now();
    const d = generate(p);
    const t1 = performance.now();
    const fab = computeFabrication(p, d);
    const bom = computeBom(d, fab);
    cutPlans(fab, p);
    const t2 = performance.now();
    console.log(`members=${d.members.length} parts=${d.parts.length} generate=${(t1 - t0).toFixed(0)}ms fab+bom=${(t2 - t1).toFixed(0)}ms weight=${bom.totalWeight.toFixed(0)}`);
    expect(d.members.length).toBeGreaterThan(9000);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(t1 - t0).toBeLessThan(15000);
  }, 60000);
});
