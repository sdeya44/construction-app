/**
 * LAY-01/02: ביקורת קריאות גיליונות (1.68) — מדדי הגופן האמיתי (KSPSans, fontkit) על מודל הגיליון.
 * LAY-01: פרויקט מלא דו-שיפועי — אין טקסט מחוץ לגיליון, אין מידה על קו, חפיפות ≤ 1 (ידוע: מכלול פטה, שרשרת מידות קצרה).
 * LAY-02: צורות נוספות — תקרה לכל צורה (המצב ב-1.68). חריגה = נסיגה בשרטוטים; ירידה — להוריד את התקרה.
 */
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultCladding } from '../src/geometry/cladding';
import { defaultWing } from '../src/geometry/wing';
import { SECTION_TEMPLATES } from '../src/model/section';
import { defaultTrussSpec } from '../src/geometry/truss';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { numberParts } from '../src/commands/commands';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { auditSheet, type AuditIssue } from '../src/drawing/layoutAudit';
import type { BuildingParams } from '../src/model/types';

type Font = { layout: (s: string) => { advanceWidth: number }; unitsPerEm: number };
const fk = fontkit as unknown as { create: (b: Buffer) => Font };
const reg = fk.create(readFileSync('src/drawing/font/KSPSans.ttf')), bold = fk.create(readFileSync('src/drawing/font/KSPSans-Bold.ttf'));
const measure = (s: string, h: number, b?: boolean) => { const f = b ? bold : reg; return (f.layout(s).advanceWidth / f.unitsPerEm) * h; };

const full = (b: BuildingParams) => { b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; b.cladding = defaultCladding(); b.bracing.walls.enabled = true; return b; };
function audit(b: BuildingParams) {
  const p = numberParts().run(newProject('lay', b)); const d = generate(p); const fab = computeFabrication(p, d); const bom = computeBom(d, fab);
  const out: (AuditIssue & { sheet: string })[] = [];
  for (const def of drawingCatalog(p, d, fab)) for (const x of auditSheet(buildSheet(def, p, d, fab, bom), measure)) out.push({ ...x, sheet: def.id });
  return out;
}
const fmt = (xs: (AuditIssue & { sheet: string })[]) => xs.map((x) => `${x.sheet} ${x.kind}: ${x.a}${x.b ? ` ↔ ${x.b}` : ''}`);

describe('LAY ביקורת קריאות גיליונות', () => {
  it('LAY-01 דו-שיפועי מלא', () => {
    const xs = audit(full(defaultBuilding()));
    expect(fmt(xs.filter((x) => x.kind !== 'text-overlap'))).toEqual([]);
    expect(xs.filter((x) => x.kind === 'text-overlap').length, fmt(xs).join('\n')).toBeLessThanOrEqual(1);
  }, 120000);
  const mono = () => full({ ...defaultBuilding(), roofType: 'mono', eaveRight: 7500, purlins: { ...defaultBuilding().purlins, left: { ...defaultBuilding().purlins.left, first: 0 } } });
  const CASES: [string, () => BuildingParams, number][] = [
    ['חד-שיפועי', mono, 2],
    ['דו-שיפועי כפול', () => full({ ...defaultBuilding(), section: SECTION_TEMPLATES.find((t) => t.id === 'twin-gable')!.make() }), 24],
    ['L', () => { const b = full(defaultBuilding()); b.wing = defaultWing(b, 'gable'); return b; }, 29],
    ['מסבכי גג', () => { const b = full(defaultBuilding()); b.roofTruss = { enabled: true, frames: 'all', shape: 'flat', spec: defaultTrussSpec(8, 1000, { top: b.rafterProfile }) }; return b; }, 61],
  ];
  for (const [id, mk, cap] of CASES) it(`LAY-02 ${id} (תקרה ${cap})`, () => {
    const xs = audit(mk());
    expect(fmt(xs.filter((x) => x.kind === 'text-outside')), 'טקסט מחוץ לגיליון').toEqual([]);
    expect(xs.length, fmt(xs).slice(0, 30).join('\n')).toBeLessThanOrEqual(cap);
  }, 120000);
});
