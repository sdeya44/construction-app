import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { defaultBuilding, newProject, uniformFrames } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultCladding } from '../src/geometry/cladding';
import { defaultTrussSpec } from '../src/geometry/truss';
import { defaultWing } from '../src/geometry/wing';
import { suggestEavePlate } from '../src/geometry/eavePlate';
import { SECTION_TEMPLATES } from '../src/model/section';
import { auditContacts } from '../src/geometry/audit';
import { computeFabrication } from '../src/fab/marks';
import { computeBom } from '../src/fab/bom';
import { projectToIfc } from '../src/fab/ifc';
import { dstvZip } from '../src/fab/dstv';
import { buildSheet, drawingCatalog } from '../src/drawing/views';
import { sheetToDxf } from '../src/drawing/dxf';
import { applySizingSuggestion, numberParts, setConnectionDefault } from '../src/commands/commands';
import type { BuildingParams, PlateConnParams, Project } from '../src/model/types';

/**
 * 50 סככות לפי טיפוסים ומידות ממקורות ציבוריים (מדריכי SCI/ArcelorMittal, יצרני סככות, חניות סולאריות, מבני חקלאות וספורט).
 * לכל סככה: האם אפשר לייצג אותה, ייצור מלא (מודל, התאמת חתכים, מספור, כתב כמויות, כל השרטוטים, DXF, DSTV, IFC),
 * ומה חסר כדי לייצג אותה במדויק. לא תכן — בדיקת יכולת התוכנה.
 */
type Fit = 'full' | 'approx' | 'no';
interface Case { n: number; name: string; cat: string; src: string; fit: Fit; missing?: string; make: () => BuildingParams; knee?: boolean; clad?: 'none' | 'roof' | 'all' }

const pct = (deg: number) => Math.round(Math.tan((deg * Math.PI) / 180) * 1000) / 10;
function gable(w: number, L: number, bay: number, eave: number, slope: number): BuildingParams {
  const b = defaultBuilding();
  return { ...b, width: w, ridgeX: w / 2, eaveLeft: eave, eaveRight: eave, slopeLeftPct: slope, frames: uniformFrames(Math.round(L / bay) + 1, L) };
}
function mono(w: number, L: number, bay: number, low: number, slope: number): BuildingParams {
  const b = defaultBuilding();
  return { ...b, roofType: 'mono', width: w, eaveLeft: low, eaveRight: low + (slope / 100) * w, frames: uniformFrames(Math.round(L / bay) + 1, L), purlins: { ...b.purlins, left: { ...b.purlins.left, first: 0 } } };
}
/** תבנית חתך מודולרי בקנה מידה: רוחב כולל w, גובה מרזב eave, אותם שיפועים */
function tpl(id: string, w: number, L: number, bay: number, eave: number, slope?: number): BuildingParams {
  const t = SECTION_TEMPLATES.find((x) => x.id === id)!.make();
  // רוחב התבנית: בין הצירים, ובתבנית עם ציר אחד (קונזולה, T) — לפי קצוות מישורי הגג
  const xs = t.lines.map((l) => l.x), px = t.planes.flatMap((p) => [p.x0, p.x1]);
  const W0 = xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : Math.max(...px) - Math.min(...px);
  const sx = w / W0, k = (slope ?? 10) / 10;
  // הנקודה הנמוכה בגג = גובה המרזב המבוקש
  const zLow = Math.min(...t.planes.flatMap((p) => [p.z0, p.z1]));
  const sec = { ...t, lines: t.lines.map((l) => ({ ...l, x: l.x * sx })), planes: t.planes.map((p) => ({ ...p, x0: p.x0 * sx, x1: p.x1 * sx, z0: eave + (p.z0 - zLow) * sx * k, z1: eave + (p.z1 - zLow) * sx * k })) };
  return { ...defaultBuilding(), section: sec, frames: uniformFrames(Math.round(L / bay) + 1, L) };
}

const C: Case[] = [
  // ---- חניות וחניות סולאריות
  { n: 1, cat: 'חניה', name: 'חניה זוגית בקונזולה, עמודים כל 3.6, קורה מתחדדת 420→160', src: 'cadcrowd', fit: 'approx', missing: 'קורה מתחדדת (tapered) — מיוצגת כחתך קבוע', make: () => tpl('cantilever', 4800, 7200, 3600, 2300, 10) },
  { n: 2, cat: 'חניה', name: 'סככת קונזולה חד-שיפועית, עמוד 2.5, מסגרות כל 3, 7.6°', src: 'structville', fit: 'full', make: () => tpl('cantilever', 5000, 15000, 3000, 2500, pct(7.6)) },
  { n: 3, cat: 'חניה', name: 'חניה סולארית Y, 4.2×5.4, 2.4/3.5, 5°', src: 'polysolar', fit: 'approx', missing: 'מוטות Y משופעים מהעמוד לקורה — מיוצג כ-T עם אלכסונים', make: () => tpl('t-canopy', 4200, 5400, 5400, 2400, pct(5)), knee: true },
  { n: 4, cat: 'חניה', name: 'חניה סולארית T 3+3 — 11.6 מ\', עמודים כל 8.2', src: 'solarelectricsupply', fit: 'full', make: () => tpl('t-canopy', 11600, 32800, 8200, 3000, 5), knee: true },
  { n: 5, cat: 'חניה', name: 'חניה סולארית T 4+4 — 16.2 מ\'', src: 'solarelectricsupply', fit: 'full', make: () => tpl('t-canopy', 16200, 41000, 8200, 3200, 5), knee: true },
  { n: 6, cat: 'חניה', name: 'חניה סולארית V (פרפר) 15 מ\'', src: 'mbtenergy', fit: 'full', make: () => tpl('butterfly', 15000, 30000, 7500, 3000, 5) },
  { n: 7, cat: 'חניה', name: 'חניה כפולה דו-שיפועית 6×6, מרזב 2.4, 15%', src: 'gov.il (שיפוע מינ\' לפח)', fit: 'full', make: () => gable(6000, 6000, 3000, 2400, 15) },
  { n: 8, cat: 'חניה', name: 'שורת חניה חד-שיפועית 5×30, 2.5/3.0', src: 'כללי', fit: 'full', make: () => mono(5000, 30000, 5000, 2500, 10) },
  { n: 9, cat: 'חניה', name: 'סככת אוטובוס/בית ספר T 4×20', src: 'כללי', fit: 'full', make: () => tpl('t-canopy', 4000, 20000, 5000, 2800, 5) },
  { n: 10, cat: 'חניה', name: 'גגון תחנת דלק 20×30 שטוח על עמודים מרכזיים', src: 'כללי', fit: 'approx', missing: 'גג שטוח עם קורות שתי-כיווניות ותקרת פח (fascia) — מיוצג כחד-שיפועי רב-מפתחי בשיפוע 2%', make: () => tpl('mono-multi', 20000, 30000, 7500, 5500, 2) },
  // ---- חקלאות
  { n: 11, cat: 'חקלאות', name: 'מתבן קטן 7.3×9.1, 3:12, מרזב 4.3, פתוח', src: 'uspatriotsteel', fit: 'full', make: () => gable(7300, 9100, 3033, 4300, 25), clad: 'roof' },
  { n: 12, cat: 'חקלאות', name: 'מתבן רחב 30 מ\', 25%, מרזב 6', src: 'americansteelspan', fit: 'full', make: () => gable(30000, 48000, 6000, 6000, 25), clad: 'roof', knee: true },
  { n: 13, cat: 'חקלאות', name: 'רפת 24 מ\' שיפוע 1:10 עם רכס מאוורר (מוניטור)', src: 'havitsteelstructure', fit: 'approx', missing: 'גג מוניטור (רכס מוגבה לאוורור) — מיוצג כדו-שיפועי', make: () => gable(24000, 60000, 6000, 5000, 10), clad: 'roof', knee: true },
  { n: 14, cat: 'חקלאות', name: 'רפת 18 מ\' עם אגפים נמוכים בשני הצדדים', src: 'sunwardsteel', fit: 'approx', missing: 'תבנית "אסם" (שני אגפים) — מיוצג כגג מדורג לצד אחד', make: () => tpl('stepped', 24000, 48000, 6000, 4000) },
  { n: 15, cat: 'חקלאות', name: 'אורווה 12×24, 33%, מרזב 3.5', src: 'carport.com', fit: 'full', make: () => gable(12000, 24000, 4000, 3500, 33), clad: 'all' },
  { n: 16, cat: 'חקלאות', name: 'סככת כלים חד-שיפועית 9×36, 5/6', src: 'universalsteel', fit: 'full', make: () => mono(9000, 36000, 6000, 5000, 11), clad: 'roof' },
  { n: 17, cat: 'חקלאות', name: 'סככה צמודה לקיר מבנה קיים 6×24', src: 'armstrongsteel (lean-to)', fit: 'no', missing: 'ציר "קיר קיים" בלי עמודים (קורות מעוגנות לקיר) — מיוצג כחד-שיפועי חופשי', make: () => mono(6000, 24000, 6000, 3500, 10) },
  { n: 18, cat: 'חקלאות', name: 'לול 12×80, 25%, מרזב 2.5', src: 'כללי', fit: 'full', make: () => gable(12000, 80000, 5000, 2500, 25), clad: 'all' },
  { n: 19, cat: 'חקלאות', name: 'חממה/מנהרה קשתית 9.6×30', src: 'fordingbridge', fit: 'no', missing: 'קורות מעוקלות (קשת) — מיוצג כדו-שיפועי', make: () => gable(9600, 30000, 3000, 3000, 30), clad: 'roof' },
  { n: 20, cat: 'חקלאות', name: 'מתבן 18×36 עם כנף 12×12 (L)', src: 'hansenpolebuildings', fit: 'full', make: () => { const b = gable(18000, 36000, 6000, 6000, 10); b.wing = defaultWing(b, 'gable'); return b; }, clad: 'roof' },
  // ---- תעשייה ומחסנים
  { n: 21, cat: 'תעשייה', name: 'מחסן 25×60, מרזב 8, 6°, מסגרות כל 6', src: 'steelconstruction.info', fit: 'full', make: () => gable(25000, 60000, 6000, 8000, pct(6)), clad: 'all' },
  { n: 22, cat: 'תעשייה', name: 'מחסן 35×80, מרזב 10, 6°, מסגרות כל 8', src: 'steelconstruction.info', fit: 'full', make: () => gable(35000, 80000, 8000, 10000, pct(6)), clad: 'all' },
  { n: 23, cat: 'תעשייה', name: 'מחסן לוגיסטי דו-מפתחי 2×40', src: 'arcelormittal', fit: 'full', make: () => tpl('twin-gable', 80000, 96000, 8000, 10000, pct(6)), clad: 'all' },
  { n: 24, cat: 'תעשייה', name: 'מפתח 50 מ\' (גבול כלכלי), מרזב 12', src: 'msbgroupuk', fit: 'approx', missing: 'מכפל (haunch) בראש העמוד וברכס — חיוני במפתח כזה; ללא בדיקת חוזק', make: () => gable(50000, 64000, 8000, 12000, pct(6)), clad: 'all' },
  { n: 25, cat: 'תעשייה', name: 'בית מלאכה 20×30, מרזב 5', src: 'qdsteelbuilding', fit: 'full', make: () => gable(20000, 30000, 6000, 5000, 10), clad: 'all' },
  { n: 26, cat: 'תעשייה', name: 'בית מלאכה 18×36 עם עגורן גשר 5 ט\'', src: 'SCI P399', fit: 'no', missing: 'קונזולות/קורות מסילה לעגורן, עמוד מדורג — חסר', make: () => gable(18000, 36000, 6000, 7000, 10), clad: 'all' },
  { n: 27, cat: 'תעשייה', name: 'מחסן עם גגון רציף טעינה 22.5 מ\' (45°)', src: 'arcelormittal', fit: 'approx', missing: 'גגון בשיפוע 45° מחובר למסגרת — מיוצג כקונזולה בשיפוע הגג', make: () => tpl('gable-cant', 40000, 48000, 8000, 10000), clad: 'roof' },
  { n: 28, cat: 'תעשייה', name: 'מחסן עם יציע (mezzanine) פנימי', src: 'arcelormittal', fit: 'no', missing: 'רצפת ביניים: קורות, עמודים, פח רצפה — חסר', make: () => gable(30000, 48000, 8000, 9000, pct(6)), clad: 'all' },
  { n: 29, cat: 'תעשייה', name: 'דוגמת SP40: מפתח 18, מרזב 6', src: 'is.sp.40', fit: 'full', make: () => gable(18000, 36000, 6000, 6000, 20), clad: 'all' },
  { n: 30, cat: 'תעשייה', name: 'מחשבון פורטל: 12×4.5', src: 'structuralsteelcomponents', fit: 'full', make: () => gable(12000, 24000, 6000, 4500, 10), clad: 'all' },
  { n: 31, cat: 'תעשייה', name: 'דו-מפתחי עם עמוד פנימי 2×15', src: 'americansteelspan', fit: 'full', make: () => tpl('gable-center', 30000, 48000, 6000, 6000), clad: 'all' },
  { n: 32, cat: 'תעשייה', name: 'מפעל שן-מסור 3×12', src: 'כללי', fit: 'full', make: () => tpl('sawtooth', 36000, 36000, 6000, 6000), clad: 'roof' },
  { n: 33, cat: 'תעשייה', name: 'מחסן מדורג: אולם גבוה + נמוך', src: 'כללי', fit: 'full', make: () => tpl('stepped', 32000, 48000, 6000, 7000), clad: 'all' },
  { n: 34, cat: 'תעשייה', name: 'חדר קירור 24×48, מרזב 9, חיפוי מלא', src: 'כללי', fit: 'full', make: () => gable(24000, 48000, 6000, 9000, 8), clad: 'all' },
  { n: 35, cat: 'תעשייה', name: 'מרלו"ג 30×90, מרזב 11, מסגרות כל 7.5', src: 'kafafab', fit: 'full', make: () => gable(30000, 90000, 7500, 11000, pct(6)), clad: 'all' },
  // ---- ספורט וחינוך
  { n: 36, cat: 'ספורט', name: 'קירוי מגרש רב-תכליתי 37×18 קשתי', src: 'thenbs (Motiva MUGA)', fit: 'no', missing: 'גג קשתי — מיוצג כדו-שיפועי', make: () => gable(18000, 37000, 6200, 5000, 15) },
  { n: 37, cat: 'חינוך', name: 'גגון בית ספר דו-שיפועי 12×24, מרזב 3.5, פתוח', src: 'fordingbridge', fit: 'full', make: () => gable(12000, 24000, 6000, 3500, 15), clad: 'roof' },
  { n: 38, cat: 'חינוך', name: 'גגון בית ספר חד-שיפועי 6×30, 2.8/3.4', src: 'aandslandscape', fit: 'full', make: () => mono(6000, 30000, 6000, 2800, 10), clad: 'roof' },
  { n: 39, cat: 'ספורט', name: 'קירוי מגרש כדורסל 30×45, מרזב 8, אלכסונים', src: 'centralbuild', fit: 'full', make: () => gable(30000, 45000, 7500, 8000, 10), clad: 'roof', knee: true },
  { n: 40, cat: 'ספורט', name: 'קירוי יציע בקונזולה 8 מ\' × 40', src: 'panel built', fit: 'full', make: () => tpl('cantilever', 8000, 40000, 6700, 6000, 8) },
  { n: 41, cat: 'חינוך', name: 'הצללה מרובעת 8×8 (4 שיפועים)', src: 'landscapestructures', fit: 'no', missing: 'גג ארבעה שיפועים (hip) — מיוצג כדו-שיפועי', make: () => gable(8000, 8000, 4000, 3000, 25) },
  { n: 42, cat: 'חינוך', name: 'מעבר מקורה 3×50, 20%', src: 'כללי', fit: 'full', make: () => gable(3000, 50000, 5000, 2700, 20) },
  // ---- מיוחדים
  { n: 43, cat: 'מסחר', name: 'שוק מקורה 24×48 בגג פרפר', src: 'כללי', fit: 'full', make: () => tpl('butterfly', 24000, 48000, 6000, 6000, 8), clad: 'roof' },
  { n: 44, cat: 'חקלאות', name: 'סככה חקלאית דו-מפתחית 2×18', src: 'americansteelspan', fit: 'full', make: () => tpl('twin-gable', 36000, 54000, 6000, 5500), clad: 'roof' },
  { n: 45, cat: 'תעשייה', name: 'בית מלאכה L: 18×36 + כנף 12×18', src: 'hansenpolebuildings', fit: 'full', make: () => { const b = gable(18000, 36000, 6000, 7000, 10); b.wing = { ...defaultWing(b, 'gable'), bays: 2, length: 18000, frames: 4 }; return b; }, clad: 'all' },
  { n: 46, cat: 'חקלאות', name: 'סככה חד-שיפועית עם כנף נשענת (L)', src: 'carport.com', fit: 'full', make: () => { const b = mono(12000, 36000, 6000, 5500, 10); b.wing = defaultWing(b, 'mono'); return b; }, clad: 'roof' },
  { n: 47, cat: 'מסחר', name: 'שטיפת רכב 8×20, מרזב 4', src: 'כללי', fit: 'full', make: () => gable(8000, 20000, 5000, 4000, 15), clad: 'roof' },
  { n: 48, cat: 'תעשייה', name: 'סככת אחסון 15×40 עם דילול עמוד לכניסת משאיות', src: 'כללי', fit: 'full', make: () => { const b = mono(15000, 40000, 5000, 5500, 8); const f = b.frames; b.transfers = [{ id: 'T1', lineId: 'L', from: f[2]!.id, to: f[4]!.id, removed: [f[3]!.id], profile: 'IPE600', support: 'A2', seat: 'B1' }]; return b; } },
  { n: 49, cat: 'תעשייה', name: 'מפתח 36 מ\' במסבכי גג', src: 'steelconstruction.info', fit: 'full', make: () => { const b = gable(36000, 48000, 6000, 8000, 10); b.roofTruss = { enabled: true, frames: 'all', shape: 'flat', spec: defaultTrussSpec(12, 1800, { top: 'IPE300' }) }; return b; }, clad: 'roof' },
  { n: 50, cat: 'מסחר', name: 'סככה במגרש לא מלבני (טרפז)', src: 'כללי', fit: 'no', missing: 'מסגרות לא מקבילות / תוכנית לא מלבנית — מיוצג כמלבן חוסם', make: () => gable(20000, 40000, 5000, 6000, 10) },
];

const results: Record<string, unknown>[] = [];
describe('50 סככות — יכולת ייצור מלאה', () => {
  for (const c of C) {
    it(`#${c.n} ${c.name}`, () => {
      const t0 = Date.now();
      const b = c.make();
      if (c.knee) b.kneeBraces = { ...defaultKneeBraces(), enabled: true };
      if (c.clad && c.clad !== 'none') { b.cladding = defaultCladding(); if (c.clad === 'roof') { b.cladding.walls.enabled = false; b.cladding.girts.enabled = false; b.cladding.posts.enabled = false; } }
      let p: Project = newProject(`#${c.n}`, b);
      const stage: string[] = [];
      try { p = applySizingSuggestion().run(p); stage.push('גדלים'); } catch (e) { stage.push(`גדלים✕ ${String(e).slice(0, 60)}`); }
      let d = generate(p);
      // כמו המשתמש: מאשרים את הצעת "בדיקת פלטה"
      for (let k = 0; k < 3; k++) {
        const e = d.issues.find((i) => i.code === 'EAVE_FIT' && i.severity === 'error');
        const cn = e?.elementId ? d.connById.get(e.elementId) : undefined; if (!cn) break;
        const col = d.byId.get(cn.members[0]!), raf = d.byId.get(cn.members[1]!); if (!col || !raf) break;
        const base = p.connectionDefaults.eave; const prm = { ...base, bolt: { ...base.bolt } } as PlateConnParams;
        const cos = Math.abs(raf.end.x - raf.start.x) / Math.hypot(raf.end.x - raf.start.x, raf.end.z - raf.start.z) || 1;
        const sug = suggestEavePlate(prm, raf.profile, col.profile, cos);
        p = setConnectionDefault('eave', { w: sug.w, l: sug.l, gauge: sug.gauge, pitch: sug.pitch, cols: sug.cols, rows: sug.rows }).run(p);
        d = generate(p);
      }
      const errs = d.issues.filter((i) => i.severity === 'error');
      const warns = d.issues.filter((i) => i.severity === 'warning');
      p = numberParts().run(p);
      const fab = computeFabrication(p, d), bom = computeBom(d, fab);
      let sheets = 0; const sheetFail: string[] = [];
      for (const def of drawingCatalog(p, d, fab)) { try { sheetToDxf(buildSheet(def, p, d, fab, bom)); sheets++; } catch (e) { sheetFail.push(`${def.number}: ${String(e).slice(0, 80)}`); } }
      let nc = 0; try { nc = dstvZip(p, d, fab).count; } catch (e) { sheetFail.push(`DSTV: ${String(e).slice(0, 80)}`); }
      try { projectToIfc(p, d, fab); } catch (e) { sheetFail.push(`IFC: ${String(e).slice(0, 80)}`); }
      const area = (() => { const xs = d.members.filter((m) => m.kind === 'column').map((m) => m.start.x); const ys = d.members.filter((m) => m.kind === 'column').map((m) => m.start.y); return Math.max(1, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) / 1e6); })();
      const kg = fab.parts.reduce((s, x) => s + x.weight, 0);
      results.push({ n: c.n, cat: c.cat, name: c.name, src: c.src, fit: c.fit, missing: c.missing ?? '', cols: p.building.columnProfile, raf: p.building.rafterProfile, members: d.members.length, errors: errs.length, errMsgs: [...new Set(errs.map((e) => `${e.code}: ${e.message.slice(0, 80)}`))].slice(0, 3), warnings: [...new Set(warns.map((w) => w.code))], sheets, sheetFail, nc, assemblies: fab.assemblies.length, kg: Math.round(kg), kgm2: Math.round(kg / area), ms: Date.now() - t0, stage });
      expect(sheetFail).toEqual([]);
      // בקרת אורכים ומגעים: כל ריתוך — החלקים נוגעים; כל בורג — עובר בכל החלקים ברשימת החורים
      const audit = auditContacts(d);
      expect(audit.slice(0, 5).map((a) => a.message)).toEqual([]);
    }, 300000);
  }
  it('דוח', () => {
    fs.mkdirSync('e2e-results', { recursive: true });
    fs.writeFileSync('e2e-results/catalog50.json', JSON.stringify(results, null, 1));
    const bad = results.filter((r) => (r.errors as number) > 0);
    console.log(`\n${results.length} סככות · ${results.filter((r) => !(r.errors as number)).length} ללא שגיאות · גיליונות ${results.reduce((s, r) => s + (r.sheets as number), 0)}`);
    for (const r of bad) console.log(`#${r.n} ${r.name}: ${(r.errMsgs as string[]).join(' | ')}`);
    expect(bad.map((r) => `#${r.n}: ${(r.errMsgs as string[]).join(' | ')}`)).toEqual([]);
  });
});
