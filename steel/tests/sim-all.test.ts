import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject, uniformFrames } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultCladding } from '../src/geometry/cladding';
import { defaultTrussSpec } from '../src/geometry/truss';
import { SECTION_TEMPLATES } from '../src/model/section';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { projectToIfc } from '../src/fab/ifc';
import { dstvZip } from '../src/fab/dstv';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { sheetToDxf } from '../src/drawing/dxf';
import { deleteMembers, numberParts, setConnectionDefault, setMemberProps } from '../src/commands/commands';
import { suggestEavePlate } from '../src/geometry/eavePlate';
import type { PlateConnParams } from '../src/model/types';
import type { BuildingParams, Project } from '../src/model/types';

/**
 * סימולציית עבודה רחבה: כל תבנית מבנה × רצף שינויים טיפוסיים של משתמש.
 * לכל מצב: יצירת המודל, בדיקת שגיאות ו-NaN, מספור, כתב כמויות, IFC, DSTV, ושרטוטים (כולם במצבים המלאים).
 */
const TEMPLATES: { id: string; make: () => BuildingParams }[] = [
  { id: 'classic-gable', make: () => defaultBuilding() },
  { id: 'classic-mono', make: () => ({ ...defaultBuilding(), roofType: 'mono', eaveRight: 7500, purlins: { ...defaultBuilding().purlins, left: { ...defaultBuilding().purlins.left, first: 0 } } }) },
  ...SECTION_TEMPLATES.map((t) => ({ id: t.id, make: () => ({ ...defaultBuilding(), section: t.make() }) })),
];

type Step = { name: string; full?: boolean; mut: (b: BuildingParams, d: ReturnType<typeof generate>) => void; cmd?: (p: Project, d: ReturnType<typeof generate>) => Project };
const STEPS: Step[] = [
  { name: 'בסיס', full: true, mut: () => {} },
  { name: 'אלכסונים + חיפוי מלא', full: true, mut: (b) => { b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; b.cladding = defaultCladding(); b.cladding.walls.enabled = true; b.cladding.walls.sides = { L: true, R: true, F: true, B: true }; b.cladding.posts.enabled = true; } },
  { name: 'אורך 42 / 8 מסגרות, תושבת עומדת 1.2', mut: (b) => { b.frames = uniformFrames(8, 42000); for (const s of [b.purlins.left, b.purlins.right]) { s.cleat.style = 'stand'; s.spacing = 1200; } for (const k of Object.keys(b.purlins.planes ?? {})) { b.purlins.planes![k]!.cleat.style = 'stand'; b.purlins.planes![k]!.spacing = 1200; } } },
  { name: 'תושבת פלטה + משולש', mut: (b) => { for (const s of [b.purlins.left, b.purlins.right, ...Object.values(b.purlins.planes ?? {})]) s.cleat.style = 'plate'; } },
  { name: 'מפלס תחתית לכל ציר', mut: (b, d) => { const ls = d.section?.lines ?? []; b.lineBase = Object.fromEntries(ls.map((l, i) => [l.id, [600, 300, 0, 450][i % 4]!])); } },
  { name: 'חתכים: HEB240 / IPE360', mut: (b) => { b.columnProfile = 'HEB240'; b.rafterProfile = 'IPE360'; } },
  { name: 'חריג חתך לקורה אחת + מחיקת פטה', cmd: (p, d) => { const r = d.members.find((m) => m.kind === 'rafter'); const pl = d.members.filter((m) => m.kind === 'purlin'); let n = r ? setMemberProps([r.id], { profile: 'IPE400' }).run(p) : p; if (pl.length > 4) n = deleteMembers([pl[2]!.id]).run(n); return n; }, mut: () => {} },
  { name: 'קושרות: אגד B + סבכה RHS', mut: (b) => { b.bracing.walls.enabled = true; b.bracing.walls.type = 'portal'; b.bracing.roof.type = 'rhs'; } },
  { name: 'מסבכי גג', full: true, mut: (b) => { b.roofTruss = { enabled: true, frames: 'all', shape: 'flat', spec: defaultTrussSpec(8, 1000, { top: b.rafterProfile }) }; } },
  { name: 'דילול עמוד (קורה נושאת)', full: true, mut: (b, d) => { delete b.roofTruss; const f = [...b.frames].sort((x, y) => x.y - y.y); const l = d.section?.lines[0]?.id ?? 'L'; if (f.length >= 4) b.transfers = [{ id: 'T1', lineId: l, from: f[0]!.id, to: f[2]!.id, removed: [f[1]!.id], profile: 'IPE600', support: 'A2', seat: 'B1' }]; } },
];

const hasNaN = (d: ReturnType<typeof generate>) => d.members.some((m) => [m.start.x, m.start.y, m.start.z, m.end.x, m.end.y, m.end.z].some((v) => !Number.isFinite(v)));

describe('סימולציה רחבה — כל התבניות × שינויים', () => {
  const report: string[] = [];
  const problems: string[] = [];
  for (const t of TEMPLATES) {
    it(`SIM ${t.id}`, () => {
      let b = t.make();
      let p = newProject(t.id, structuredClone(b));
      let d = generate(p);
      for (const st of STEPS) {
        const tag = `${t.id} › ${st.name}`;
        try {
          b = structuredClone(p.building);
          st.mut(b, d);
          p = { ...p, building: b };
          if (st.cmd) p = st.cmd(p, d);
          d = generate(p);
          // כמו המשתמש: חלון "בדיקת פלטה" נפתח — מאשרים את ההצעה לכל חיבורי ראש העמוד
          for (let k = 0; k < 3; k++) {
            const e = d.issues.find((i) => i.code === 'EAVE_FIT' && i.severity === 'error');
            const c = e?.elementId ? d.connById.get(e.elementId) : undefined;
            if (!c) break;
            const col = d.byId.get(c.members[0]!), raf = d.byId.get(c.members[1]!);
            if (!col || !raf) break;
            const o = p.connectionOverrides[c.id] ?? {}; const base = p.connectionDefaults.eave;
            const prm = { ...base, ...o, bolt: { ...base.bolt, ...(o.bolt ?? {}) } } as PlateConnParams;
            const cos = Math.abs(raf.end.x - raf.start.x) / Math.hypot(raf.end.x - raf.start.x, raf.end.z - raf.start.z) || 1;
            const sug = { ...prm, ...suggestEavePlate(prm, raf.profile, col.profile, cos) };
            p = setConnectionDefault('eave', { w: sug.w, l: sug.l, gauge: sug.gauge, pitch: sug.pitch, cols: sug.cols, rows: sug.rows }).run(p);
            d = generate(p);
          }
          const errs = d.issues.filter((i) => i.severity === 'error');
          const warns = d.issues.filter((i) => i.severity === 'warning');
          if (hasNaN(d)) problems.push(`${tag}: NaN בקואורדינטות`);
          if (errs.length) problems.push(`${tag}: ${errs.length} שגיאות — ${[...new Set(errs.map((e) => `${e.code}: ${e.message.slice(0, 90)}`))].slice(0, 4).join(' | ')}`);
          const pn = numberParts().run(p);
          const fab = computeFabrication(pn, d);
          const bom = computeBom(d, fab);
          projectToIfc(pn, d, fab);
          dstvZip(pn, d, fab);
          const cat = drawingCatalog(pn, d, fab);
          const defs = st.full ? cat : cat.filter((c) => ['roof-plan', 'frame', 'anchor-plan', 'side'].includes(c.type)).slice(0, 4);
          let sheets = 0;
          for (const def of defs) {
            try { const sh = buildSheet(def, pn, d, fab, bom); sheetToDxf(sh); sheets++; } catch (e) { problems.push(`${tag}: שרטוט ${def.number} נכשל — ${String(e).slice(0, 120)}`); }
          }
          report.push(`${tag}: ${d.members.length} אלמנטים, ${errs.length} שגיאות, ${warns.length} אזהרות [${[...new Set(warns.map((w) => w.code))].join(',')}], ${sheets} גיליונות`);
        } catch (e) {
          problems.push(`${tag}: חריגה — ${String(e).split('\n')[0]!.slice(0, 160)}`);
        }
      }
    }, 240000);
  }
  it('סיכום', () => {
    console.log(['', '=== דוח סימולציה ===', ...report, '', '=== בעיות ===', ...(problems.length ? problems : ['אין'])].join('\n'));
    expect(problems).toEqual([]);
  });
});
