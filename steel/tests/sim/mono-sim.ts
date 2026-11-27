/**
 * סימולציה מלאה: מבנה חד-שיפועי (12×24 מ', 5 מסגרות) עם אלכסוני עמוד-קורה, אגד B, מסבך גג במסגרת 3 ושינוי מחברים.
 * `calcExpected` — חישוב מקדים מגיאומטריה ופרמטרים בלבד (בלי לקרוא מהאפליקציה); `runSim` — בנייה דרך פקודות האפליקציה וקריאת התוצאות.
 * גיאומטריה ושקילה בלבד — לא תכן חוזק.
 */
import { defaultBuilding, newProject, framesFromSpacings } from '../../src/model/defaults';
import { generate } from '../../src/geometry/generate';
import { computeFabrication } from '../../src/fab/marks';
import { computeBom } from '../../src/fab/bom';
import { numberParts, setBuilding, setConnection, setConnectionDefault } from '../../src/commands/commands';
import { defaultKneeBraces } from '../../src/geometry/knee';
import { defaultPortal } from '../../src/geometry/portal';
import { defaultTrussSpec } from '../../src/geometry/truss';
import { getProfile, massPerMeter } from '../../src/profiles/library';
import type { Project } from '../../src/model/types';

export const IN = {
  W: 12000, eL: 5000, eR: 6200, bay: 6000, frames: 5, col: 'HEA200', raf: 'IPE300',
  purlin: { profile: 'C200x80x20x3', first: 300, spacing: 1500 }, trussFrame: 'F3', trussPanels: 6, trussDepth: 1000,
  knee: { profile: 'L50x5', drop: 800, angle: 45 }, portal: { beam: 'RHS100x100x5', brace: 'RHS60x60x4', gap: 150, drop: 600, angle: 45 },
  // שלב 1 = ברירות מחדל של האפליקציה; שלב 2 = שינוי מחברים
  eave1: { t: 12, w: 280, l: 340 }, base1: { t: 20, w: 230, l: 230 },
  eave2: { t: 14, w: 300, l: 360 }, base2: { t: 16, w: 250, l: 250 }, eaveOverride: { id: 'C.EAVE.F2.L', t: 18 },
  stock: 12000,
};

export type Stage = 1 | 2;
export interface Rec { cat: string; el: string; dim: string; unit: string; expected: number | string | null; actual: number | string | null; basis: string; info?: boolean }
export interface Shape { key: string; kind: 'member' | 'plate'; title: string; profile?: string; outline?: { outer: { u: number; v: number }[]; holes: { u: number; v: number }[][] }; lenMm?: number; cutA?: number; cutB?: number; w?: number; l?: number; t?: number; holes?: { c: number; t: number; d: number }[] }

const deg = (r: number) => (r * 180) / Math.PI;

/** חישוב מקדים (בלי האפליקציה). הכללים ("R") מתועדים בעמודה basis. */
export function calcExpected(stage: Stage) {
  const { W, eL, eR } = IN, s = (eR - eL) / W, th = Math.atan(s), sec = 1 / Math.cos(th), tn = Math.tan(th);
  const col = getProfile(IN.col).props, raf = getProfile(IN.raf).props;
  const hv = raf.h * sec; // עומק קורת הגג בכיוון אנכי
  const eave = stage === 1 ? IN.eave1 : IN.eave2;
  const ext = eave.l / 2; // R1: הקורה בולטת מעבר לציר העמוד לפחות חצי אורך פלטת הראש
  const rafAxis = (W + 2 * ext) * sec;
  const slopeEave = W * sec; // אורך שיפוע בין צירי העמודים
  // R6: פריסת פטות שווה, נמדדת לאורך קורת הגג כולה (כולל הבליטה): מהקצה הגבוה (monoStart=high) הפטה הראשונה ב-300, האחרונה בקצה הנמוך (edgeOffset 0)
  const span = rafAxis - IN.purlin.first, nsp = Math.ceil(span / IN.purlin.spacing - 1e-9);
  // R2 (עמוד): ראש העמוד = תחתית הקורה פחות שתי פלטות; החלק נמדד בצלע הארוכה (חיתוך משופע בזווית השיפוע)
  const colPart = (axis: number, t: number) => axis - hv - 2 * t + (col.h / 2) * tn;
  // מסבך: R3 המסבך נמתח בין פני העמודים הפנימיים; R4 מוט בין פני החגורות
  const half = col.h / 2, x0 = half, x1 = W - half, panel = (x1 - x0) / IN.trussPanels;
  const botH = getProfile('HEA140').props.h, topH = raf.h;
  const V0 = IN.trussDepth - (topH / 2) * sec - botH / 2;
  const nodes = Array.from({ length: IN.trussPanels + 1 }, (_, i) => x0 + i * panel);
  const V = nodes.map((x) => V0 + s * (x - x0));
  // אורך אלכסון בין צמתים (ציר-ציר) ומקוצר בפני החגורות
  const cell = (i: number) => {
    const left = i < IN.trussPanels / 2, k = left ? i : IN.trussPanels - 1 - i;
    const rising = (k % 2 === 0) === left; // '/' בצד שמאל לזוגיים; בצד ימין הפוך
    const xb = rising ? nodes[i]! : nodes[i + 1]!, xt = rising ? nodes[i + 1]! : nodes[i]!;
    const zb = 0, zt = IN.trussDepth + s * (xt - x0);
    const ax = Math.hypot(xt - xb, zt - zb), alpha = Math.atan2(zt - zb, Math.abs(xt - xb));
    const cut = (botH / 2 + (topH / 2) * sec) / Math.sin(alpha);
    return { axis: ax, trimmed: ax - cut, alphaDeg: deg(alpha) };
  };
  return { s, th, sec, tn, hv, ext, rafAxis, slopeEave, nsp, rows: nsp + 1, step: span / nsp, colPart, panel, nodes, V, cell, x0, x1, eave, col, raf, V0 };
}

export function runSim(stage: Stage) {
  const b = defaultBuilding();
  const patch: any = {
    roofType: 'mono', width: IN.W, eaveLeft: IN.eL, eaveRight: IN.eR, slopeLeftPct: 10, frames: framesFromSpacings(Array(IN.frames - 1).fill(IN.bay)),
    kneeBraces: { ...defaultKneeBraces(), enabled: true, profile: IN.knee.profile, detail: 'angle', drop: IN.knee.drop, angle: IN.knee.angle },
    roofTruss: { enabled: true, frames: [IN.trussFrame], shape: 'flat', spec: { ...defaultTrussSpec(IN.trussPanels, IN.trussDepth, { top: IN.raf }), ...(stage === 2 ? { nodeCheeks: { enabled: true, t: 8, h: 100 } } : {}) } },
  };
  patch.bracing = { ...b.bracing, walls: { ...b.bracing.walls, enabled: true, type: 'portal', portal: { ...defaultPortal(), ...IN.portal } } };
  let p: Project = setBuilding(patch).run(newProject(`SIM-${stage}`, b));
  if (stage === 2) {
    p = setConnectionDefault('eave', IN.eave2).run(p);
    p = setConnectionDefault('base', IN.base2).run(p);
    p = setConnection(IN.eaveOverride.id, { t: IN.eaveOverride.t }).run(p);
  }
  p = numberParts().run(p);
  const d = generate(p), fab = computeFabrication(p, d), bom = computeBom(d, fab);
  return { p, d, fab, bom };
}

export const len = (m: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }) => Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
export const catalogRows = () => [
  // [פרופיל, h, b, tw, tf, ק"ג/מ' לפי טבלאות תקניות — ידני]
  ['HEA200', 190, 200, 6.5, 10, 42.3], ['IPE300', 300, 150, 7.1, 10.7, 42.2], ['HEA140', 133, 140, 5.5, 8.5, 24.7],
].map(([n, h, b, tw, tf, g]) => { const pr = getProfile(n as string); return { n, exp: { h, b, tw, tf, g }, act: { h: pr.props.h, b: pr.props.b, tw: pr.dims.tw, tf: pr.dims.tf, g: massPerMeter(pr, 7850) } }; });
