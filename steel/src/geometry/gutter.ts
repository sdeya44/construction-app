import { add, dot, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import { localFrame } from './frame';
import type { NSection } from '../model/section';
import type { BuildingParams, Connection, GutterSpec, Member, ValidationIssue, WeldInfo } from '../model/types';
import { tryProfile } from '../profiles/library';

/**
 * מזחלה (פרטי לקוח: "פרט מזחלת מים IPE200/220", "פרט 17"):
 * פח מגולוון 2 מ"מ — דופן פנימית לאורך קצה הקורה עד מתחת לפח הגג, תחתית, דופן חיצונית גבוהה, כיפופי שפה 30.
 * נשענת על 2 זוויתנים L50/50/5 בכל קצה קורה (מרותכים לקצה הקורה במסגריה — מגולוונים יחד עם הקורה).
 * ירידות מרזב Ø200 (8") צמודות לעמודים, שלות כל 2 מ', קשת בתחתית. הפח והמתלים בין המסגרות — עבודת פחחות (כתב כמויות).
 */
export function defaultGutterSpec(): GutterSpec {
  return { t: 2, bottom: 350, inner: 270, outer: 450, lip: 30, bracket: 'L50x5', hangerSpacing: 1500, pipeD: 200, clampSpacing: 2000 };
}
/** פריסות סטנדרטיות של רצועת הפח (רוחב גליל): חלוקה לדפנות ותחתית, שפות 30 */
export const GUTTER_DEVS: Record<number, Pick<GutterSpec, 'inner' | 'bottom' | 'outer' | 'lip'>> = {
  500: { inner: 120, bottom: 150, outer: 170, lip: 30 },
  625: { inner: 150, bottom: 200, outer: 215, lip: 30 },
  750: { inner: 180, bottom: 250, outer: 260, lip: 30 },
  1000: { inner: 250, bottom: 300, outer: 390, lip: 30 },
  1250: { inner: 300, bottom: 400, outer: 490, lip: 30 },
};
export const gutterSpec = (g: { spec?: Partial<GutterSpec> } | undefined): GutterSpec => ({ ...defaultGutterSpec(), ...(g?.spec ?? {}) });
/** פריסת הפח (רוחב הרצועה לכיפוף) */
export const gutterDev = (s: GutterSpec) => s.lip + s.outer + s.bottom + s.inner + s.lip;

export interface GutterRun {
  id: string; label: string; kind: 'eave' | 'valley';
  /** x של הדופן הפנימית; dir = כיוון החוצה (+1/−1); בשקע: x = ציר השקע */
  x: number; dir: 1 | -1;
  zBottom: number; zInnerTop: number;
  y0: number; y1: number;
  /** קצוות הקורות בכל מסגרת (נקודת התמיכה) */
  ends: { frameId: string; rafterId: string; faceX: number; y: number }[];
  downpipes: { y: number; x: number; zTop: number; zBottom: number }[];
  /** מזחלת קצה: מזהה המישור ושיפוע הגג כלפי חוץ */
  planeId?: string; dzdxOut?: number;
}

const Y = v3(0, 1, 0), Z = v3(0, 0, 1);

/** x של פני הקצה החתוך בגובה z (חיתוך במישור ניצב לציר הקורה) */
function faceXAt(m: Member, which: 'start' | 'end', z: number): number {
  const P = which === 'start' ? m.start : m.end;
  const cut = which === 'start' ? m.startCut : m.endCut;
  if (!cut || Math.abs(cut.normal.x) < 1e-6) return P.x;
  return cut.point.x - (cut.normal.z * (z - cut.point.z)) / cut.normal.x;
}

export function gutterRuns(b: BuildingParams, sec: NSection, members: Member[]): GutterRun[] {
  const cl = b.cladding;
  if (!cl?.gutter.enabled || !cl.roof.enabled) return [];
  const s = gutterSpec(cl.gutter);
  const byId = new Map(members.map((m) => [m.id, m]));
  const frames = [...b.frames].sort((a, c) => a.y - c.y);
  const y0 = frames[0]!.y - b.purlinOverhangStart, y1 = frames[frames.length - 1]!.y + b.purlinOverhangEnd;
  const pu = tryProfile(b.purlins.left.profile)?.props.h ?? 200;
  const key = (q: { x: number; z: number }) => `${Math.round(q.x)}|${Math.round(q.z)}`;
  const ends = new Map<string, number>();
  for (const pl of sec.planes) for (const q of [pl.a, pl.b]) ends.set(key(q), (ends.get(key(q)) ?? 0) + 1);
  const lines = [...sec.lines].sort((a, c) => a.x - c.x);
  const runs: GutterRun[] = [];
  const girtH = cl.walls.enabled && cl.girts.enabled ? tryProfile(cl.girts.profile)?.props.h ?? 150 : 0;
  for (const pl of sec.planes) {
    const lowIsA = pl.a.z <= pl.b.z, low = lowIsA ? pl.a : pl.b, high = lowIsA ? pl.b : pl.a;
    if ((ends.get(key(low)) ?? 0) >= 2) continue; // שקע בין שני מישורים — בהמשך
    if (Math.abs(high.z - low.z) < 1) continue; // מישור שטוח
    const dir = (low.x > high.x ? 1 : -1) as 1 | -1;
    // קצה נמוך ליד עמוד פנימי (שן מסור / מדרגה): מזחלה פנימית צמודה לעמוד — בלי זרועות תמיכה שחוצות לצד השני
    const colH0 = tryProfile(b.columnProfile)?.props.h ?? 200;
    const atInner = lines.some((l) => Math.abs(l.x - low.x) < colH0 / 2 + 400 && lines.some((o) => dir * (o.x - l.x) > 1));
    if (atInner) {
      const zIT = low.z + pu - 10;
      runs.push({ id: `G.${pl.id}`, label: `מזחלה פנימית — קצה ${pl.label} (צמודה לעמוד)`, kind: 'valley', x: low.x - (dir > 0 ? s.bottom : 0), dir: 1, zBottom: zIT - s.inner, zInnerTop: zIT, y0, y1, ends: [],
        downpipes: frames.filter((_, i) => i === 0 || i === frames.length - 1).map((f, i) => ({ y: f.y + (i === 0 ? 350 : -350), x: low.x - dir * s.bottom / 2, zTop: zIT - s.inner, zBottom: b.baseElevation + 150 })) });
      continue;
    }
    const which: 'start' | 'end' = (() => { const r0 = byId.get(pl.rafterId(frames[0]!.id)); if (!r0) return 'end'; return Math.abs(r0.start.x - low.x) < Math.abs(r0.end.x - low.x) ? 'start' : 'end'; })();
    const r0 = byId.get(pl.rafterId(frames[0]!.id));
    if (!r0) continue;
    const rp = tryProfile(r0.profile);
    const tos = r0.anchor === 'top' ? (which === 'start' ? r0.start.z : r0.end.z) : (which === 'start' ? r0.start.z : r0.end.z) + (rp?.props.h ?? 300) / 2;
    // הדופן הפנימית עולה עד מעל הפטה האחרונה (השפה מכופפת פנימה מעל הפטה, מתחת לפח הגג); הגבהה/הנמכה לפי bracketOffset
    const zInnerTop = tos + pu + 2 + (s.bracketOffset ?? 0), zBottom = zInnerTop - s.inner;
    // הדופן הפנימית: מחוץ לפני הקצה של הקורה ומחוץ לחיפוי הקיר
    let face = -Infinity * dir;
    const pick = (x: number) => (dir > 0 ? Math.max(face, x) : Math.min(face, x));
    const es: GutterRun['ends'] = [];
    for (const f of frames) {
      const r = byId.get(pl.rafterId(f.id));
      if (!r) continue;
      const fx = Math.max(...[zBottom - 6, zInnerTop].map((z) => dir * faceXAt(r, which, z))) * dir;
      face = pick(fx);
      es.push({ frameId: f.id, rafterId: r.id, faceX: faceXAt(r, which, zBottom - 6), y: f.y });
    }
    const edgeLine = dir > 0 ? lines[lines.length - 1] : lines[0];
    if (edgeLine && Math.abs(edgeLine.x - low.x) < 3000 && cl.walls.enabled) {
      const colH = tryProfile(b.columnProfile)?.props.h ?? 200;
      face = pick(edgeLine.x + dir * (colH / 2 + girtH + 60));
    }
    const x = face + dir * (5 + ((s.support ?? 'web') === 'plate' ? s.plateT ?? 8 : 0));
    const zBase = b.lineBase?.[edgeLine?.id ?? ''] ?? b.baseElevation;
    const dzdxOut = ((low.z - high.z) / (low.x - high.x)) * dir; // שיפוע הגג כלפי חוץ (שלילי — יורד)
    // מפתחים עם מזחלה (בחירת משתמש) — מקטעים רציפים; ירידות לפי בחירה או אוטומטי בכל מקטע
    const pr = cl.gutter.perRun?.[pl.id];
    const nb = frames.length - 1;
    const on = Array.from({ length: nb }, (_, i) => pr?.bays?.[i] ?? true);
    const segs: [number, number][] = [];
    for (let i = 0; i < nb; i++) if (on[i]) { if (segs.length && segs[segs.length - 1]![1] === i) segs[segs.length - 1]![1] = i + 1; else segs.push([i, i + 1]); }
    segs.forEach(([a, c], k) => {
      const sy0 = a === 0 ? y0 : frames[a]!.y, sy1 = c === nb ? y1 : frames[c]!.y;
      const fIn = frames.slice(a, c + 1);
      let dpF: typeof frames;
      if (pr?.downpipes?.length) dpF = pr.downpipes.filter((i) => i >= a && i <= c).map((i) => frames[i]!).filter(Boolean);
      else {
        const nDp = Math.max(1, Math.ceil((sy1 - sy0) / cl.gutter.downpipeSpacing));
        dpF = nDp === 1 ? [fIn[0]!] : Array.from({ length: nDp + 1 }, (_, i) => fIn[Math.round((i * (fIn.length - 1)) / nDp)]!).filter((f, i, arr) => arr.indexOf(f) === i);
      }
      const ids = new Set(fIn.map((f) => f.id));
      runs.push({
        id: k === 0 ? `G.${pl.id}` : `G.${pl.id}.${k + 1}`, label: `מזחלה — קצה תחתון ${pl.label}${segs.length > 1 ? ` (מפתחים ${a + 1}–${c})` : ''}`, kind: 'eave', x, dir, zBottom, zInnerTop, y0: sy0, y1: sy1,
        ends: es.filter((e) => ids.has(e.frameId)), planeId: pl.id, dzdxOut,
        downpipes: dpF.map((f) => ({ y: f.y + (f.y <= sy0 + 1 || f === frames[0] ? 350 : f.y >= sy1 - 1 ? -350 : 350), x: x + dir * (s.bottom / 2), zTop: zBottom, zBottom: zBase + 150 })),
      });
    });
  }
  // שקעים: נקודה נמוכה משותפת לשני מישורים שעולים ממנה
  const done = new Set<string>();
  for (const pl of sec.planes) for (const q of [pl.a, pl.b]) {
    const k = key(q);
    if ((ends.get(k) ?? 0) < 2 || done.has(k)) continue;
    const others = sec.planes.filter((o) => [o.a, o.b].some((e) => key(e) === k));
    if (!others.every((o) => Math.max(o.a.z, o.b.z) > q.z + 1)) continue;
    done.add(k);
    const zInnerTop = q.z + pu - 10, zBottom = zInnerTop - s.inner;
    const nDp = Math.max(2, Math.ceil((y1 - y0) / cl.gutter.downpipeSpacing));
    const picks = Array.from({ length: nDp }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (nDp - 1))]!).filter((f, i, a) => a.indexOf(f) === i);
    runs.push({ id: `G.V${Math.round(q.x)}`, label: `מזחלה פנימית (שקע) x=${(q.x / 1000).toFixed(2)}`, kind: 'valley', x: q.x - s.bottom / 2, dir: 1, zBottom, zInnerTop, y0, y1, ends: [],
      downpipes: picks.map((f) => ({ y: f.y + (f === frames[0] ? 350 : -350), x: q.x, zTop: zBottom, zBottom: b.baseElevation + 150 })) });
  }
  return runs;
}

/** תומכי מזחלה (פלדה, מסגריה): 2×L50/50/5 בכל קצה קורה, מרותכים לקצה הקורה */
export function buildGutterBrackets(b: BuildingParams, sec: NSection, members: Member[]): { members: Member[]; connections: Connection[]; issues: ValidationIssue[] } {
  const out = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[] };
  const runs = gutterRuns(b, sec, members);
  const s = gutterSpec(b.cladding?.gutter);
  const lp = tryProfile(s.bracket);
  if (!lp) { if (runs.length) out.issues.push({ code: 'PROFILE', severity: 'error', message: `תומך מזחלה: חתך לא מוכר ${s.bracket}` }); return out; }
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const r of runs) {
    if (r.kind !== 'eave') continue;
    for (const e of r.ends) {
      const raf = byId.get(e.rafterId);
      if (!raf) continue;
      const sup = s.support ?? 'web';
      if (sup === 'plate') { plateSupport(out, r, e, raf, s, lp); continue; }
      if (sup === 'web') { if (!webSupport(out, r, e, raf, s, lp)) plateSupport(out, r, e, raf, s, lp); continue; }
      const rb = tryProfile(raf.profile)?.props.b ?? 150;
      const zc = r.zBottom - lp.props.h / 2; // הרגל האופקית העליונה בגובה תחתית המזחלה
      const x0 = e.faceX + r.dir * 0.5, x1 = r.x + r.dir * (s.bottom + 20);
      const len = Math.abs(x1 - x0);
      const id = `C.GB.${r.id.slice(2)}.${e.frameId}`;
      const parts: string[] = [];
      const welds: WeldInfo[] = [];
      for (const [k, du] of [[1, -(rb / 2 - lp.props.b / 2 - 5)], [2, rb / 2 - lp.props.b / 2 - 5]] as const) {
        const mid = `${id}.L${k}`;
        out.members.push({ id: mid, kind: 'cleat', label: `תומך מזחלה ${s.bracket.replace('x', '/')}`, start: v3(x0, e.y + du, zc), end: v3(x1, e.y + du, zc), profile: s.bracket, material: raf.material, rollDeg: k === 1 ? 0 : 90, mirror: false, anchor: 'center', refUp: Z, source: 'generated', manualPlacement: false, connId: id, partDesc: `תומך מזחלה ${s.bracket.replace('x', '/')}×${Math.round(len)}` });
        parts.push(mid);
        const w = v3(x0, e.y + du, zc);
        welds.push({ id: `${mid}.W`, connId: id, type: 'fillet', a: 4, length: 2 * lp.props.h + 2 * lp.props.b, location: 'shop', between: [raf.id, mid], from: w, to: add(w, scale(Y, 1)) });
      }
      if (len > 700) out.issues.push({ code: 'GUTTER_BRACKET', severity: 'warning', elementId: id, message: `תומך מזחלה במסגרת ${e.frameId}: זיז ארוך (${Math.round(len)} מ"מ) — לבדוק חתך התומך` });
      out.connections.push({ id, type: 'gutter', label: `תומכי מזחלה ${r.label.replace('מזחלה — ', '')} · ${e.frameId}`, members: [raf.id], parts, bolts: [], welds, status: 'not-verified', fixity: 'pinned', overridden: false });
    }
  }
  return out;
}

/**
 * תמיכת מזחלה (בקשת משתמש 18.11.2026): זוויתן מרותך בחפיפה על צד ווב הקורה (מסגריה), בולט החוצה מתחת לתחתית המזחלה —
 * אופקי או בשיפוע הגג. הרגל האנכית צמודה לווב, הרגל האופקית למעלה (עליה יושבת המזחלה). אם הזוויתן נמוך מתחום הווב
 * (מתחת לאגף התחתון של הקורה) — מחזיר false, והתמיכה נבנית על פלטת קצה.
 */
function webSupport(out: { members: Member[]; connections: Connection[]; issues: ValidationIssue[] }, r: GutterRun, e: GutterRun['ends'][number], raf: Member, s: GutterSpec, lp: NonNullable<ReturnType<typeof tryProfile>>): boolean {
  const rp = tryProfile(raf.profile);
  if (!rp || !['IPE', 'HEA', 'HEB', 'HEM', 'INP', 'UPN', 'UPE'].includes(rp.family)) return false;
  const h = rp.props.h, tf = rp.dims.tf ?? 10, tw = rp.dims.tw ?? 8, rr = rp.dims.r ?? 0;
  const lap = s.lap ?? 150;
  const which = Math.abs(raf.start.x - e.faceX) < Math.abs(raf.end.x - e.faceX) ? 'start' : 'end';
  const P = which === 'start' ? raf.start : raf.end, Q = which === 'start' ? raf.end : raf.start;
  const ex = norm(sub(P, Q)); // החוצה לאורך הקורה
  const tosAt = (x: number) => (raf.anchor === 'top' ? 0 : h / 2) + P.z + ((x - P.x) * ex.z) / (ex.x || 1e-9);
  const sloped = (s.bracketSlope ?? 'horizontal') === 'roof';
  const a = lp.props.h; // רגל אנכית
  const xIn = e.faceX - r.dir * lap, xOut = r.x + r.dir * (s.bottom + 20);
  // גובה פני העליון של הזוויתן: תחתית המזחלה בדופן הפנימית; בשיפוע — לאורך שיפוע הגג
  const zTopAt = (x: number) => r.zBottom + (sloped ? (r.dzdxOut ?? 0) * r.dir * (x - r.x) : 0);
  // תחום הווב בחפיפה (בין האגפים, אחרי הרדיוס)
  for (const x of [xIn, e.faceX - r.dir * 5]) {
    const top = tosAt(x) - tf - rr, bot = tosAt(x) - h + tf + rr;
    if (zTopAt(x) > top + 0.5 || zTopAt(x) - a < bot - 0.5) return false;
  }
  const id = `C.GB.${r.id.slice(2)}.${e.frameId}`;
  const lid = `${id}.L1`;
  const yS = e.y + tw / 2; // פני הווב בצד +y
  const S = v3(xIn, yS, zTopAt(xIn)), E = v3(xOut, yS, zTopAt(xOut));
  const m: Member = { id: lid, kind: 'cleat', label: `זוויתן תומך מזחלה ${s.bracket.replace('x', '/')} (על הווב)`, start: S, end: E, profile: s.bracket, material: raf.material, rollDeg: 0, mirror: false, anchor: 'corner', refUp: v3(0, 0, -1),
    source: 'generated', manualPlacement: false, connId: id, partDesc: `זוויתן תומך מזחלה ${s.bracket.replace('x', '/')}×${Math.round(Math.hypot(E.x - S.x, E.z - S.z))} — מרותך בחפיפה ${lap} לווב${sloped ? ', בשיפוע הגג' : ''}` };
  if (dot(localFrame(m).u, v3(0, 1, 0)) < 0) m.mirror = true;
  out.members.push(m);
  const len = Math.abs(xOut - e.faceX);
  if (len > 700) out.issues.push({ code: 'GUTTER_BRACKET', severity: 'warning', elementId: id, message: `תומך מזחלה במסגרת ${e.frameId}: זיז ארוך (${Math.round(len)} מ"מ) — לבדוק חתך התומך` });
  out.connections.push({ id, type: 'gutter', label: `תומך מזחלה — זוויתן על ווב הקורה ${r.label.replace('מזחלה — ', '')} · ${e.frameId}`, members: [raf.id], parts: [lid], bolts: [],
    welds: [{ id: `${lid}.W`, connId: id, type: 'fillet', a: 4, length: 2 * lap + a, location: 'shop', between: [raf.id, lid], from: S, to: v3(e.faceX, yS, zTopAt(e.faceX)) }],
    status: 'not-verified', fixity: 'pinned', overridden: false });
  return true;
}

/**
 * תמיכת מזחלה מסוג "פלטה + זוויתן אופקי" (פרט הלקוח: "מזחלה סוגי תמיכות פלטה עם פרופיל וזוית"):
 * פלטה (8 מ"מ) מרותכת על פני הקצה של הקורה, יורדת עד מתחת למזחלה; זוויתן L50/5 אופקי (לא בשיפוע הגג)
 * מרותך לתחתית הפלטה ובולט החוצה מתחת לתחתית המזחלה. הדופן הפנימית של המזחלה צמודה לפלטה. מסגריה בלבד.
 */
function plateSupport(out: { members: Member[]; connections: Connection[]; issues: ValidationIssue[] }, r: GutterRun, e: GutterRun['ends'][number], raf: Member, s: GutterSpec, lp: NonNullable<ReturnType<typeof tryProfile>>) {
  const rp = tryProfile(raf.profile);
  const rb = rp?.props.b ?? 150, rh = rp?.props.h ?? 300;
  const t = s.plateT ?? 8;
  const which = Math.abs(raf.start.x - e.faceX) < Math.abs(raf.end.x - e.faceX) ? 'start' : 'end';
  const P = which === 'start' ? raf.start : raf.end, Q = which === 'start' ? raf.end : raf.start;
  const cut = which === 'start' ? raf.startCut : raf.endCut;
  // נורמל פני הקצה (החוצה): מישור החיתוך אם יש, אחרת ציר הקורה
  const ax = norm(sub(P, Q));
  let nrm = cut ? norm(cut.normal) : ax;
  if (dot(nrm, ax) < 0) nrm = scale(nrm, -1);
  nrm = norm(v3(nrm.x, 0, nrm.z));
  const pt = cut ? cut.point : P;
  const tos = raf.anchor === 'top' ? P.z : P.z + rh / 2;
  const zLow = r.zBottom - lp.props.h - 5;
  // נקודה על מישור הפנים בגובה z
  const onFace = (z: number) => { const x = pt.x - (nrm.z * (z - pt.z)) / (nrm.x || 1e-9); return v3(x, e.y, z); };
  const A = add(onFace(zLow), scale(nrm, t / 2)), B = add(onFace(tos), scale(nrm, t / 2));
  const id = `C.GB.${r.id.slice(2)}.${e.frameId}`;
  const pid = `${id}.PL`, lid = `${id}.L1`;
  const H = Math.round(Math.hypot(B.x - A.x, B.z - A.z));
  const W = Math.ceil(rb / 10) * 10;
  out.members.push({ id: pid, kind: 'plate', label: `פלטת קצה למזחלה PL${t}×${W}×${H}`, start: A, end: B, profile: `PL${W}x${t}`, material: raf.material, rollDeg: 0, mirror: false, anchor: 'center', refUp: nrm, source: 'generated', manualPlacement: false, connId: id, partDesc: `פלטת קצה למזחלה PL${t}×${W}×${H}` });
  // זוויתן אופקי: הרגל העליונה בגובה תחתית המזחלה, מהפלטה החוצה עד מעבר לדופן החיצונית
  const zc = r.zBottom - lp.props.h / 2;
  const x0 = onFace(zc).x + r.dir * (t + 0.5), x1 = r.x + r.dir * (s.bottom + 20);
  const len = Math.abs(x1 - x0);
  out.members.push({ id: lid, kind: 'cleat', label: `זוויתן תומך מזחלה ${s.bracket.replace('x', '/')} (אופקי)`, start: v3(x0, e.y, zc), end: v3(x1, e.y, zc), profile: s.bracket, material: raf.material, rollDeg: 0, mirror: false, anchor: 'center', refUp: Z, source: 'generated', manualPlacement: false, connId: id, partDesc: `זוויתן תומך מזחלה ${s.bracket.replace('x', '/')}×${Math.round(len)} אופקי` });
  const welds: WeldInfo[] = [
    { id: `${pid}.W`, connId: id, type: 'fillet', a: 5, length: 2 * rb + 2 * rh, location: 'shop', between: [raf.id, pid], from: A, to: B },
    { id: `${lid}.W`, connId: id, type: 'fillet', a: 4, length: 2 * lp.props.h + 2 * lp.props.b, location: 'shop', between: [pid, lid], from: v3(x0, e.y, zc), to: v3(x0, e.y + 1, zc) },
  ];
  if (len > 700) out.issues.push({ code: 'GUTTER_BRACKET', severity: 'warning', elementId: id, message: `תומך מזחלה במסגרת ${e.frameId}: זיז ארוך (${Math.round(len)} מ"מ) — לבדוק חתך התומך` });
  out.connections.push({ id, type: 'gutter', label: `תומך מזחלה — פלטה + זוויתן אופקי ${r.label.replace('מזחלה — ', '')} · ${e.frameId}`, members: [raf.id], parts: [pid, lid], bolts: [], welds, status: 'not-verified', fixity: 'pinned', overridden: false });
}

/** משטחים לתצוגה: פח המזחלה (חתך מוחלץ לאורך Y) וירידות המרזב */
export function gutterSurfaces(b: BuildingParams, runs: GutterRun[]): { kind: 'gutter' | 'pipe'; pts: Vec3[]; ref?: string }[] {
  const s = gutterSpec(b.cladding?.gutter);
  const out: { kind: 'gutter' | 'pipe'; pts: Vec3[]; ref?: string }[] = [];
  for (const r of runs) {
    const d = r.dir;
    const prof = r.kind === 'eave'
      ? [[r.x - d * s.lip, r.zInnerTop], [r.x, r.zInnerTop], [r.x, r.zBottom], [r.x + d * s.bottom, r.zBottom], [r.x + d * s.bottom, r.zBottom + s.outer], [r.x + d * (s.bottom - s.lip), r.zBottom + s.outer]]
      : [[r.x, r.zInnerTop], [r.x, r.zBottom], [r.x + s.bottom, r.zBottom], [r.x + s.bottom, r.zInnerTop]];
    for (let i = 0; i < prof.length - 1; i++) {
      const [ax, az] = prof[i]!, [bx, bz] = prof[i + 1]!;
      out.push({ kind: 'gutter', ref: r.planeId ?? r.id, pts: [v3(ax, r.y0, az), v3(bx, r.y0, bz), v3(bx, r.y1, bz), v3(ax, r.y1, az)] });
    }
    for (const dp of r.downpipes) {
      const R = s.pipeD / 2, n = 8;
      for (let i = 0; i < n; i++) {
        const a0 = (2 * Math.PI * i) / n, a1 = (2 * Math.PI * (i + 1)) / n;
        const p = (a: number, z: number) => v3(dp.x + R * Math.cos(a), dp.y + R * Math.sin(a), z);
        out.push({ kind: 'pipe', ref: r.planeId ?? r.id, pts: [p(a0, dp.zBottom), p(a1, dp.zBottom), p(a1, dp.zTop), p(a0, dp.zTop)] });
      }
    }
  }
  return out;
}

/** כמויות: פח (אורך × פריסה), מתלים בין המסגרות, ירידות (אורך, שלות, קשתות, שקעים) */
export function gutterTakeoff(b: BuildingParams, runs: GutterRun[]) {
  const s = gutterSpec(b.cladding?.gutter);
  const dev = gutterDev(s);
  const frames = [...b.frames].sort((a, c) => a.y - c.y);
  const bays = frames.length - 1;
  return runs.map((r) => {
    const len = r.y1 - r.y0;
    const hangers = r.kind === 'eave' && s.hangerSpacing > 0 ? bays * Math.max(0, Math.ceil((len / Math.max(1, bays)) / s.hangerSpacing) - 1) : 0;
    const pipeLen = r.downpipes.reduce((a, d) => a + (d.zTop - d.zBottom), 0);
    const fall = Math.max(0, s.fall ?? 0);
    return { name: r.label + (fall ? ` (חתך משתנה, +${fall} בירידה)` : ''), length: len, downpipes: r.downpipes.length, dev: dev + fall, sheetT: s.t, hangers, pipeD: s.pipeD, pipeLen, clamps: r.downpipes.reduce((a, d) => a + Math.max(2, Math.ceil((d.zTop - d.zBottom) / s.clampSpacing) + 1), 0), elbows: r.downpipes.length };
  });
}
