/**
 * WASH-01: דיסקית (טבעת) מתחת לאום בכל בורג — צמודה לחלק האחרון, והאום צמוד אליה (בלי חדירה ובלי רווח).
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { SECTION_TEMPLATES } from '../src/model/section';
import { clash } from '../src/geometry/clash';
import { hw } from '../src/geometry/connections';
import type { Project } from '../src/model/types';

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const CFGS: [string, (p: Project) => void][] = [
  ['ברירת מחדל', () => {}],
  ['גג מדורג (חיבור צד)', (p) => { p.building.section = SECTION_TEMPLATES.find((t) => t.id === 'stepped')!.make(); }],
  ['בסיס עם ברגי עוגן', (p) => { p.connectionDefaults.base = { ...p.connectionDefaults.base, mode: 'bolted' }; }],
  ['ממתכונים', (p) => { p.building.purlins.engine = 'recipe'; p.building.baseEngine = 'recipe'; p.building.sideEngine = 'recipe'; p.building.section = SECTION_TEMPLATES.find((t) => t.id === 'stepped')!.make(); }],
];

describe('WASH-01 דיסקית מתחת לאום', () => {
  for (const [name, mod] of CFGS) it(name, () => {
    const p = newProject('w', defaultBuilding()); mod(p);
    const d = generate(p);
    const bolts = d.connections.flatMap((c) => c.bolts);
    expect(bolts.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const b of bolts) {
      const W = d.byId.get(`${b.id}.W`), N = d.byId.get(`${b.id}.N`), h = hw(b.d);
      if (!W || !N) { bad.push(`${b.id}: חסרה דיסקית/אום`); continue; }
      if (!/^CHS/.test(W.profile)) bad.push(`${b.id}: פרופיל דיסקית ${W.profile}`);
      if (Math.abs(dist(W.start, W.end) - h.w) > 0.01) bad.push(`${b.id}: עובי דיסקית`);
      if (dist(W.end, N.start) > 0.01) bad.push(`${b.id}: האום לא צמוד לדיסקית`);
      for (const pid of b.holesIn) {
        const part = d.byId.get(pid);
        const c = part && part.kind !== 'bolt' ? clash(W, part) : null;
        if (c && c.depth > 0.5) bad.push(`${b.id}: דיסקית חודרת ל-${pid} ב-${c.depth.toFixed(1)} מ"מ`);
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});
