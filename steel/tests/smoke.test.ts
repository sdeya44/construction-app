/**
 * SMK-01: בדיקת עשן — מבנה אחד מכל צורה עם רכיבים נפוצים: בלי שגיאות, בלי NaN, ייצור וכמויות ושרטוט ראשון.
 * רצה בסוף כל סבב (npm run test:smoke). ההרצה המלאה (test:full) מכסה את כל השילובים.
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { SECTION_TEMPLATES } from '../src/model/section';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultCladding } from '../src/geometry/cladding';
import { defaultWing } from '../src/geometry/wing';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import type { BuildingParams } from '../src/model/types';

const full = (b: BuildingParams) => { b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; b.cladding = defaultCladding(); b.bracing.walls.enabled = true; return b; };
const mono = () => ({ ...defaultBuilding(), roofType: 'mono' as const, eaveRight: 7000, purlins: { ...defaultBuilding().purlins, left: { ...defaultBuilding().purlins.left, first: 0 } } });
const SHAPES: [string, () => BuildingParams][] = [
  ['דו-שיפועי', () => full(defaultBuilding())],
  ['חד-שיפועי', () => full(mono())],
  ...SECTION_TEMPLATES.map((t) => [t.id, () => full({ ...defaultBuilding(), section: t.make() })] as [string, () => BuildingParams]),
  ['L', () => { const b = full(defaultBuilding()); b.wing = defaultWing(b, 'gable'); return b; }],
  ['L חד-שיפועי', () => { const b = full(mono()); b.wing = defaultWing(b, 'mono'); return b; }],
];

describe('SMK-01 עשן — כל צורה', () => {
  for (const [id, make] of SHAPES) it(id, () => {
    const p = newProject(id, make());
    const d = generate(p);
    expect(d.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`)).toEqual([]);
    expect(d.members.some((m) => [m.start, m.end].some((q) => !Number.isFinite(q.x + q.y + q.z)))).toBe(false);
    const pn = numberParts().run(p);
    const fab = computeFabrication(pn, d);
    const bom = computeBom(d, fab);
    expect(fab.parts.length).toBeGreaterThan(10);
    const cat = drawingCatalog(pn, d, fab);
    expect(cat.length).toBeGreaterThan(0);
    buildSheet(cat[0]!, pn, d, fab, bom);
  }, 60000);
});
