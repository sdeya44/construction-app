import { add, norm, scale, v3, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, BuildingParams, Connection, Member, RafterStrutDetail, RafterStrutParams, ValidationIssue, WeldInfo } from '../model/types';
import { finJoint } from './finJoint';
import { zAt, type SectionTopology } from '../model/section';
import { makeBolt } from './connections';
import { STRUT_FIN_RECIPE_ID } from './convRecipes';

export function defaultRafterStruts(): RafterStrutParams {
  return { rows: [], profile: 'RHS100x100x5', plateT: 10, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 } };
}

/** מיקום שורת תמוכות: x בחתך, המישור שעליו היא יושבת, המפתחים, החתך והפרט */
export interface StrutLine { idx: number; id: string; x: number; plane: string; bays: number[]; profile: string; detail: RafterStrutDetail; label: string }

export const STRUT_DETAIL_HE: Record<RafterStrutDetail, string> = { endplate: 'פלטת קצה מוברגת לווב הקורה', fin: 'פח מרותך לווב + לשונית בחריץ ה-RHS (מוברג)', weld: 'ריתוך ישיר לווב הקורה (שטח)' };

const strutEdge = (rs: RafterStrutParams) => Math.max(30, Math.ceil(1.5 * (rs.bolt.d + rs.bolt.clearance)));
/** חצי רוחב אזור החיבור על ווב הקורה לאורך השיפוע (מרווח קושרות הגג מהתמוכה) */
export function strutPlateHalf(rs: RafterStrutParams, profile: string, detail: RafterStrutDetail = rs.detail ?? 'endplate'): number {
  const pr = tryProfile(profile) ?? getProfile('RHS100x100x5');
  return detail === 'endplate' ? pr.props.b / 2 + 2 * strutEdge(rs) : pr.props.b / 2 + 25;
}

/** פתרון שורות התמוכה למיקומים בחתך. שורה שלא נופלת על מישור גג — התראה */
export function strutLines(b: BuildingParams, topo: SectionTopology, issues?: ValidationIssue[]): StrutLine[] {
  const rs = b.bracing.rafterStruts;
  if (!rs?.rows.length) return [];
  const nb = b.frames.length - 1;
  const out: StrutLine[] = [];
  rs.rows.forEach((r, idx) => {
    const lf = topo.sec.lines.find((l) => l.id === r.from), lt = topo.sec.lines.find((l) => l.id === r.toward);
    if (!lf) { issues?.push({ code: 'RS_LINE', severity: 'warning', message: `תמוכה בין קורות ${idx + 1}: הציר ${r.from} לא קיים בחתך` }); return; }
    const sg = lt && lt !== lf ? Math.sign(lt.x - lf.x) : 1;
    const x = lf.x + sg * r.dist;
    const pl = topo.sec.planes.find((p) => Math.min(p.a.x, p.b.x) + 1 < x && x < Math.max(p.a.x, p.b.x) - 1);
    const label = `${lf.label}${lt && lt !== lf ? `→${lt.label}` : ''} ${(r.dist / 1000).toFixed(2)} מ'`;
    if (!pl) { issues?.push({ code: 'RS_OUT', severity: 'warning', message: `תמוכה בין קורות ${label}: המיקום מחוץ לגג — לא נבנתה` }); return; }
    const bays = (r.bays ?? Array.from({ length: nb }, (_, i) => i)).filter((i) => i >= 0 && i < nb);
    out.push({ idx, id: r.id, x, plane: pl.id, bays, profile: r.profile && tryProfile(r.profile) ? r.profile : rs.profile, detail: r.detail ?? rs.detail ?? 'endplate', label });
  });
  return out;
}

/**
 * תמוכות בין הקורות: RHS לאורך המבנה בין קורות גג סמוכות, באמצע גובה הקורה. פרט החיבור לווב הקורה:
 *  endplate — פלטת קצה מרותכת לתמוכה (מסגריה), מוברגת לווב (שטח), ברגים מחוץ לחתך; משני צדי קורה — אותם ברגים דרך הווב;
 *  fin — פח מרותך לווב (מסגריה) + לשונית בחריץ ה-RHS, מוברגים בחפיפה בשטח (כמו פרט האלכסון עמוד-קורה);
 *  weld — ה-RHS מרותך ישירות לווב בשטח (ריתוך היקפי), ללא פחים.
 */
export function buildRafterStruts(b: BuildingParams, topo: SectionTopology, profOf?: (id: string) => string | undefined): { members: Member[]; connections: Connection[]; issues: ValidationIssue[] } {
  const out = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[] };
  const rs = b.bracing.rafterStruts;
  if (!rs?.rows.length) return out;
  const frames = b.frames, mat = b.material;
  const Y = v3(0, 1, 0);
  const e = strutEdge(rs), tp = rs.plateT, d0 = rs.bolt.d + rs.bolt.clearance;
  const nBolts = rs.bolts === 4 ? 4 : 2;
  for (const sl of strutLines(b, topo, out.issues)) {
    const pl = topo.sec.planes.find((p) => p.id === sl.plane)!;
    const sp = tryProfile(sl.profile);
    if (!sp) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `תמוכה בין קורות: חתך לא מוכר ${sl.profile}` }); continue; }
    const sb = sp.props.b, sh = sp.props.h;
    const slope = (pl.b.z - pl.a.z) / (pl.b.x - pl.a.x);
    const dir = norm(v3(1, 0, slope)), n = norm(v3(-slope, 0, 1));
    const z = zAt(pl, sl.x);
    const rafOf = (fid: string) => { const id = pl.rafterId(fid); const nm = profOf?.(id); return nm ? { id, pr: getProfile(nm) } : null; };
    const center = (fid: string, y: number) => { const r = rafOf(fid)!; return add(v3(sl.x, y, z), scale(n, -r.pr.props.h / 2)); };
    const has = new Set(sl.bays.filter((i) => rafOf(frames[i].id) && rafOf(frames[i + 1].id)));
    const W = Math.ceil((sb + 4 * e) / 5) * 5;
    const tag = `RS${sl.idx + 1}`;
    const sid = (bay: number) => `${tag}.${bay + 1}`;
    // קצוות ה-RHS לכל מפתח: [קצה ליד המסגרת הראשונה, קצה ליד השנייה]
    const ends = new Map<number, [Vec3?, Vec3?]>();
    const setEnd = (bay: number, k: 0 | 1, P: Vec3) => { const a = ends.get(bay) ?? [undefined, undefined]; a[k] = P; ends.set(bay, a); };
    for (let fi = 0; fi < frames.length; fi++) {
      const left = has.has(fi - 1), right = has.has(fi);
      if (!left && !right) continue;
      const f = frames[fi], r = rafOf(f.id);
      if (!r) continue;
      const tw = r.pr.dims.tw ?? r.pr.dims.t ?? 6;
      const clear = r.pr.props.h - 2 * (r.pr.dims.tf ?? 8) - 2 * (r.pr.dims.r ?? 0);
      if (sh > clear - 4 && !out.issues.some((i) => i.code === 'RS_DEEP' && i.elementId === tag)) out.issues.push({ code: 'RS_DEEP', severity: 'warning', elementId: tag, message: `תמוכה בין קורות ${sl.label}: גובה ${sl.profile} (${sh}) גדול מגובה הווב הפנוי בקורה (${Math.round(clear)}) — לבחור חתך נמוך יותר` });
      const C = center(f.id, f.y);
      const cid = `C.${tag}.${f.id}`;
      const sgnF = fi + 1 < frames.length ? Math.sign(frames[fi + 1].y - f.y) || 1 : Math.sign(f.y - frames[fi - 1].y) || 1;
      const sides: { bay: number; s: number; k: 0 | 1 }[] = [];
      if (left) sides.push({ bay: fi - 1, s: -sgnF, k: 1 });
      if (right) sides.push({ bay: fi, s: sgnF, k: 0 });
      const parts: string[] = [], welds: WeldInfo[] = [], bolts: BoltInfo[] = [];
      const face = (s: number) => v3(C.x, f.y + s * tw / 2, C.z);
      if (sl.detail === 'weld') {
        for (const sd of sides) {
          setEnd(sd.bay, sd.k, add(face(sd.s), scale(Y, sd.s * 1)));
          welds.push({ id: `${cid}.W${welds.length + 1}`, connId: cid, type: 'fillet', a: Math.max(4, Math.min(6, Math.round((sp.dims.t ?? 5)))), length: 2 * (sb + sh), location: 'site', between: [r.id, sid(sd.bay)], from: add(face(sd.s), scale(dir, -sb / 2)), to: add(face(sd.s), scale(dir, sb / 2)) });
        }
      } else if (sl.detail === 'fin') {
        for (const sd of sides) {
          const j = finJoint({ cid, tag: sd.s > 0 ? 'A' : 'B', desc: 'תמוכה בין קורות', hostId: r.id, memberId: sid(sd.bay), P: face(sd.s), n: scale(Y, sd.s), d: scale(Y, sd.s), pn: dir, side: 1, prof: sp, profile: sl.profile, finT: tp, tongueT: tp, bolt: rs.bolt, bolts: nBolts, weldSize: 5, mat });
          out.members.push(...j.members); bolts.push(...j.bolts); welds.push(...j.welds); parts.push(...j.parts.filter((x) => !j.bolts.some((bo) => bo.id === x)));
          for (const q of j.issues) if (!out.issues.some((i) => i.code === q.code && i.elementId === tag)) out.issues.push({ ...q, elementId: tag });
          setEnd(sd.bay, sd.k, j.start);
          if (j.finW > clear - 4 && !out.issues.some((i) => i.code === 'RS_FIN_H' && i.elementId === tag)) out.issues.push({ code: 'RS_FIN_H', severity: 'warning', elementId: tag, message: `תמוכה בין קורות ${sl.label}: רוחב הפח (${j.finW}) גדול מגובה הווב הפנוי (${Math.round(clear)}) — לבחור RHS נמוך יותר או פלטת קצה` });
        }
      } else {
        const Hp = Math.max(60, Math.min(sh, Math.floor(clear / 5) * 5));
        for (const sd of sides) {
          const pid = `${cid}.${sd.s > 0 ? 'A' : 'B'}.PL`;
          const yc = f.y + sd.s * (tw / 2 + tp / 2);
          const P0 = add(v3(C.x, yc, C.z), scale(dir, -W / 2)), P1 = add(v3(C.x, yc, C.z), scale(dir, W / 2));
          out.members.push({ id: pid, kind: 'plate', label: `פלטת קצה תמוכה PL${tp}×${Hp}×${W}`, start: P0, end: P1, profile: `PL${Hp}x${tp}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: Y, source: 'generated', manualPlacement: false, connId: cid, partDesc: `פלטת קצה תמוכה PL${tp}×${Hp}×${W}` });
          parts.push(pid);
          const yw = f.y + sd.s * (tw / 2 + tp);
          setEnd(sd.bay, sd.k, v3(C.x, yw, C.z));
          welds.push({ id: `${cid}.W${welds.length + 1}`, connId: cid, type: 'fillet', a: 4, length: 2 * (sb + sh), location: 'shop', between: [sid(sd.bay), pid], from: add(v3(C.x, yw, C.z), scale(dir, -sb / 2)), to: add(v3(C.x, yw, C.z), scale(dir, sb / 2)) });
        }
        // ברגים: דרך כל הפלטות והווב; הראש בצד הראשון. 4 ברגים — שניים בכל צד של ה-RHS, אם הגובה מאפשר
        const sMin = Math.min(...sides.map((q) => q.s)), sMax = Math.max(...sides.map((q) => q.s));
        const yHead = f.y + sMin * (tw / 2 + tp);
        const grip = tw + tp * sides.length;
        const four = nBolts === 4 && Hp - 2 * e >= 2.4 * d0 - 0.01;
        if (nBolts === 4 && !four && !out.issues.some((i) => i.code === 'RS_BOLTS' && i.elementId === tag)) out.issues.push({ code: 'RS_BOLTS', severity: 'warning', elementId: tag, message: `תמוכה בין קורות ${sl.label}: הפלטה נמוכה מכדי 2 ברגים בגובה — 2 ברגים בלבד` });
        const pts = (four ? [-1, 1].flatMap((kw) => [-1, 1].map((kn) => [kw, kn * (Hp / 2 - e)])) : [-1, 1].map((kw) => [kw, 0])) as [number, number][];
        pts.forEach(([kw, dn], i) => {
          const at = add(add(v3(C.x, yHead, C.z), scale(dir, kw * (sb / 2 + e))), scale(n, dn));
          bolts.push(makeBolt(`${cid}.B${i + 1}`, cid, at, scale(Y, sMax > sMin ? sMax : -sMin), rs.bolt, grip, 'site', [...parts, r.id], n, out.members));
        });
      }
      out.connections.push({ id: cid, type: 'brace', label: `תמוכה בין קורות ${sl.label} — ${STRUT_DETAIL_HE[sl.detail]} (מסגרת ${fi + 1})`, members: [r.id, ...sides.map((q) => sid(q.bay))], parts: [...parts, ...bolts.map((x) => x.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false,
        ...(rs.finEngine === 'recipe' && sl.detail === 'fin' && ['RHS', 'SHS'].includes(sp.family) && ['IPE', 'HEA', 'HEB', 'HEM', 'INP'].includes(tryProfile(profOf?.(r.id) ?? '')?.family ?? '')
          ? { recipe: { id: STRUT_FIN_RECIPE_ID, params: { d: rs.bolt.d, nb: nBolts, ft: tp, tt: tp }, sites: sides.map((sd) => `${sid(sd.bay)}|${sd.k === 1 ? 'end' : 'start'}`) } } : {}) });
    }
    for (const bay of has) {
      const [A, B] = ends.get(bay) ?? [];
      if (!A || !B) continue;
      out.members.push({ id: sid(bay), kind: 'beam', label: `תמוכה בין קורות ${sl.label} מפתח ${bay + 1}`, start: A, end: B, profile: sl.profile, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, partDesc: `תמוכה בין קורות ${sl.profile}` });
    }
  }
  return out;
}

/** מיקומי התמוכות (w לאורך הקטע) בקטע קושרות גג ובמפתח נתון */
export function strutCutsIn(lines: StrutLine[], bay: number, plane: string, a: { x: number; z: number }, dir: Vec3, L: number, margin: number): { w: number; profile: string; detail: RafterStrutDetail }[] {
  return lines.filter((s) => s.plane === plane && s.bays.includes(bay))
    .map((s) => ({ w: (s.x - a.x) / (dir.x || 1e-9), profile: s.profile, detail: s.detail }))
    .filter((q) => q.w > margin && q.w < L - margin)
    .sort((p, q) => p.w - q.w);
}
