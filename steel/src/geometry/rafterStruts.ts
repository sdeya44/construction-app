import { add, norm, scale, v3, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, BuildingParams, Connection, Member, RafterStrutParams, ValidationIssue, WeldInfo } from '../model/types';
import { zAt, type SectionTopology } from '../model/section';
import { makeBolt } from './connections';

export function defaultRafterStruts(): RafterStrutParams {
  return { rows: [], profile: 'RHS100x100x5', plateT: 10, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 } };
}

/** מיקום שורת תמוכות: x בחתך, המישור שעליו היא יושבת, המפתחים */
export interface StrutLine { idx: number; id: string; x: number; plane: string; bays: number[]; profile: string; label: string }

/** חצי רוחב פלטת הקצה לאורך השיפוע (לחישוב המרווח של קושרות הגג מהתמוכה) */
export function strutPlateHalf(rs: RafterStrutParams, profile: string): number {
  const pr = tryProfile(profile) ?? getProfile('RHS100x100x5');
  return pr.props.b / 2 + 2 * strutEdge(rs);
}
const strutEdge = (rs: RafterStrutParams) => Math.max(30, Math.ceil(1.5 * (rs.bolt.d + rs.bolt.clearance)));

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
    out.push({ idx, id: r.id, x, plane: pl.id, bays, profile: r.profile && tryProfile(r.profile) ? r.profile : rs.profile, label });
  });
  return out;
}

/**
 * תמוכות בין הקורות: RHS לאורך המבנה בין קורות גג סמוכות, באמצע גובה הקורה. בכל קצה פלטת קצה מרותכת (מסגריה)
 * ומוברגת לווב הקורה (שטח), 2 ברגים מחוץ לחתך ה-RHS לגישת מפתח. תמוכות משני צדי אותה קורה — אותם ברגים דרך הווב.
 */
export function buildRafterStruts(b: BuildingParams, topo: SectionTopology, profOf?: (id: string) => string | undefined): { members: Member[]; connections: Connection[]; issues: ValidationIssue[] } {
  const out = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[] };
  const rs = b.bracing.rafterStruts;
  if (!rs?.rows.length) return out;
  const frames = b.frames, mat = b.material;
  const Y = v3(0, 1, 0);
  const e = strutEdge(rs), tp = rs.plateT;
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
    for (const bay of has) {
      const f0 = frames[bay], f1 = frames[bay + 1];
      const r0 = rafOf(f0.id)!, r1 = rafOf(f1.id)!;
      const sgn = Math.sign(f1.y - f0.y) || 1;
      const tw = (pr: typeof r0.pr) => pr.dims.tw ?? pr.dims.t ?? 6;
      const clear = Math.min(...[r0.pr, r1.pr].map((pr) => pr.props.h - 2 * (pr.dims.tf ?? 8) - 2 * (pr.dims.r ?? 0)));
      if (sh > clear - 4 && !out.issues.some((i) => i.code === 'RS_DEEP' && i.elementId === tag)) out.issues.push({ code: 'RS_DEEP', severity: 'warning', elementId: tag, message: `תמוכה בין קורות ${sl.label}: גובה ${sl.profile} (${sh}) גדול מגובה הווב הפנוי בקורה (${Math.round(clear)}) — לבחור חתך נמוך יותר` });
      const ya = f0.y + sgn * (tw(r0.pr) / 2 + tp), yb = f1.y - sgn * (tw(r1.pr) / 2 + tp);
      const A = center(f0.id, ya), B = center(f1.id, yb);
      const id = `${tag}.${bay + 1}`;
      out.members.push({ id, kind: 'beam', label: `תמוכה בין קורות ${sl.label} מפתח ${bay + 1}`, start: A, end: B, profile: sl.profile, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, partDesc: `תמוכה בין קורות ${sl.profile}` });
    }
    // חיבור בכל קורה שיש לה תמוכה לפחות מצד אחד
    for (let fi = 0; fi < frames.length; fi++) {
      const left = has.has(fi - 1), right = has.has(fi);
      if (!left && !right) continue;
      const f = frames[fi], r = rafOf(f.id);
      if (!r) continue;
      const tw = r.pr.dims.tw ?? r.pr.dims.t ?? 6;
      const clear = r.pr.props.h - 2 * (r.pr.dims.tf ?? 8) - 2 * (r.pr.dims.r ?? 0);
      const Hp = Math.max(60, Math.min(sh, Math.floor(clear / 5) * 5));
      const C = center(f.id, f.y);
      const cid = `C.${tag}.${f.id}`;
      const parts: string[] = [], welds: WeldInfo[] = [];
      // צד "לפני" (מפתח fi-1) ו"אחרי" (מפתח fi): כיוון הפלטה מהווב
      const sides: { bay: number; s: number }[] = [];
      const sgnF = fi + 1 < frames.length ? Math.sign(frames[fi + 1].y - f.y) || 1 : Math.sign(f.y - frames[fi - 1].y) || 1;
      if (left) sides.push({ bay: fi - 1, s: -sgnF });
      if (right) sides.push({ bay: fi, s: sgnF });
      for (const sd of sides) {
        const pid = `${cid}.${sd.s > 0 ? 'A' : 'B'}.PL`;
        const yc = f.y + sd.s * (tw / 2 + tp / 2);
        const P0 = add(v3(C.x, yc, C.z), scale(dir, -W / 2)), P1 = add(v3(C.x, yc, C.z), scale(dir, W / 2));
        out.members.push({ id: pid, kind: 'plate', label: `פלטת קצה תמוכה PL${tp}×${Hp}×${W}`, start: P0, end: P1, profile: `PL${Hp}x${tp}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: Y, source: 'generated', manualPlacement: false, connId: cid, partDesc: `פלטת קצה תמוכה PL${tp}×${Hp}×${W}` });
        parts.push(pid);
        const sid = `${tag}.${sd.bay + 1}`;
        const yw = f.y + sd.s * (tw / 2 + tp);
        welds.push({ id: `${cid}.W${welds.length + 1}`, connId: cid, type: 'fillet', a: 4, length: 2 * (sb + sh), location: 'shop', between: [sid, pid], from: add(v3(C.x, yw, C.z), scale(dir, -sb / 2)), to: add(v3(C.x, yw, C.z), scale(dir, sb / 2)) });
      }
      // ברגים: דרך כל הפלטות והווב; הראש בצד הראשון
      const sMin = Math.min(...sides.map((q) => q.s)), sMax = Math.max(...sides.map((q) => q.s));
      const yHead = f.y + sMin * (tw / 2 + (sides.some((q) => q.s === sMin) ? tp : 0));
      const grip = tw + tp * sides.length;
      const bolts: BoltInfo[] = [-1, 1].map((k, i) => {
        const at = add(v3(C.x, yHead, C.z), scale(dir, k * (sb / 2 + e)));
        return makeBolt(`${cid}.B${i + 1}`, cid, at, scale(Y, sMax > sMin ? sMax : -sMin), rs.bolt, grip, 'site', [...parts, r.id], n, out.members);
      });
      out.connections.push({ id: cid, type: 'brace', label: `תמוכה בין קורות ${sl.label} — פלטת קצה מוברגת לווב הקורה (מסגרת ${fi + 1})`, members: [r.id, ...sides.map((q) => `${tag}.${q.bay + 1}`)], parts: [...parts, ...bolts.map((x) => x.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
    }
  }
  return out;
}

/** מיקומי התמוכות (w לאורך הקטע) בקטע קושרות גג ובמפתח נתון */
export function strutCutsIn(lines: StrutLine[], bay: number, plane: string, a: { x: number; z: number }, dir: Vec3, L: number, margin: number): { w: number; profile: string }[] {
  return lines.filter((s) => s.plane === plane && s.bays.includes(bay))
    .map((s) => ({ w: (s.x - a.x) / (dir.x || 1e-9), profile: s.profile }))
    .filter((q) => q.w > margin && q.w < L - margin)
    .sort((p, q) => p.w - q.w);
}
