import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { memberSolid } from '../src/geometry/solid';
import { dot, norm, sub } from '../src/core/vec';
import { SECTION_TEMPLATES } from '../src/model/section';
import { setPlaneSlope } from '../src/model/section';

/** כל פטה (כולל הראשונה והאחרונה) יושבת כולה על הפנים העליונות של קורת הגג — גם בשיפוע תלול */
function checkSeats(p: ReturnType<typeof newProject>) {
  const d = generate(p);
  // EAVE_FIT בשיפוע תלול — הצעת מידות פלטה נפרדת (חלון בדיקת פלטה); כאן נבדקת ישיבת הפטות
  expect(d.issues.filter((i) => i.severity === 'error' && i.code !== 'EAVE_FIT')).toEqual([]);
  let n = 0;
  for (const pu of d.members.filter((m) => m.purlin)) {
    const sp = d.supports.find((s) => s.purlinId === pu.id);
    if (!sp) continue;
    const raf = d.byId.get(sp.rafterId)!;
    const ex = norm(sub(raf.end, raf.start));
    const nz = { x: -ex.z, y: 0, z: ex.x }, nU = nz.z > 0 ? nz : { x: -nz.x, y: 0, z: -nz.z };
    const s = memberSolid(raf), all = [...s.startRing, ...s.endRing];
    const top = Math.max(...all.map((q) => dot(sub(q, raf.start), nU)));
    const ts = all.filter((q) => Math.abs(dot(sub(q, raf.start), nU) - top) < 1).map((q) => dot(sub(q, raf.start), ex));
    const tp = memberSolid(pu).startRing.map((q) => dot(sub({ ...q, y: raf.start.y }, raf.start), ex));
    expect(Math.min(...tp)).toBeGreaterThanOrEqual(Math.min(...ts) - 0.5);
    expect(Math.max(...tp)).toBeLessThanOrEqual(Math.max(...ts) + 0.5);
    n++;
  }
  expect(n).toBeGreaterThan(4);
}

describe('שיפוע תלול: הפטה הראשונה/האחרונה על הקורה', () => {
  it('חד־שיפועי 45° (100%), C120, מרחק ראשון 0', () => {
    const p = newProject('t', defaultBuilding());
    Object.assign(p.building, { roofType: 'mono', eaveRight: 6000 + 18000 });
    p.building.purlins.left = { ...p.building.purlins.left, profile: 'C120x50x13x2', first: 0 };
    checkSeats(p);
  });
  it('דו־שיפועי 45°, ותבניות מודולריות בשיפוע 45°', () => {
    const p = newProject('t', defaultBuilding());
    p.building.slopeLeftPct = 100;
    for (const k of ['left', 'right'] as const) p.building.purlins[k] = { ...p.building.purlins[k], profile: 'C120x50x13x2', first: 0 };
    checkSeats(p);
    for (const id of ['mono-multi', 'gable-2', 'cantilever']) {
      const q = newProject('t', defaultBuilding());
      let sec = SECTION_TEMPLATES.find((t) => t.id === id)!.make();
      // נעילת הקצה הנמוך (המרזב) ושינוי השיפוע ל-45°
      sec = { ...sec, planes: sec.planes.map((pl) => ({ ...pl, fixed: pl.z0 <= pl.z1 ? 'x0' as const : 'x1' as const })) };
      for (const pl of sec.planes) sec = setPlaneSlope(sec, pl.id, (pl.z1 > pl.z0 ? 1 : -1) * 100);
      q.building.section = sec;
      checkSeats(q);
    }
  });
});
