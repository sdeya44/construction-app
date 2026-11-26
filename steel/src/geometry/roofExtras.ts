import { add, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, BuildingParams, Connection, Member, ValidationIssue, WeldInfo } from '../model/types';
import { zAt, type SectionTopology } from '../model/section';
import { makeBolt } from './connections';
import { finJoint, slotsOf } from './finJoint';
import { localFrame } from './frame';
import { aabb, aabbOverlap, clash } from './clash';
import { bolt } from '../model/defaults';

type Out = { members: Member[]; connections: Connection[]; issues: ValidationIssue[] };
type Hole = { id: string; memberId: string; p: Vec3; axis: Vec3; d: number };

export const defaultSagRods = () => ({ enabled: true, d: 8, perBay: 1 });
export const defaultFlyBraces = () => ({ enabled: true, profile: 'L50x5', every: 2, boltD: 12 });
export const defaultLineTies = (lines: string[]) => ({ enabled: true, lines, profile: 'RHS80x80x3.6', plateT: 10, bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 } });

/** נקודת מרכז הווב של פטה בגובה y (קו הפטה = תחתית, במרכז הווב) */
const purlinWeb = (pm: Member, y: number) => {
  const h = getProfile(pm.profile).props.h;
  return add(v3(pm.start.x, y, pm.start.z), scale(pm.purlin!.roofNormal, h / 2));
};

/**
 * מוטות תלייה (sag rods): מוט הברגה Ø d בין כל שתי פטות סמוכות, דרך מרכז הווב, בשורות לאורך השיפוע (1–3 בכל מפתח).
 * כל קטע מוט מבולט 40 מ"מ מעבר לווב בכל צד (2 אומים + דסקית לכל צד, בשטח). חור d+2 בווב הפטה.
 */
export function buildSagRods(b: BuildingParams, topo: SectionTopology, purlins: Member[]): Out {
  const out: Out = { members: [], connections: [], issues: [] };
  const sr = b.bracing.sagRods;
  if (!sr?.enabled) return out;
  const fr = [...b.frames].sort((p, q) => p.y - q.y);
  const nb = fr.length - 1;
  const bays = (sr.bays ?? Array.from({ length: nb }, (_, i) => i)).filter((i) => i >= 0 && i < nb);
  const k = Math.max(1, Math.min(3, Math.round(sr.perBay)));
  for (const pl of topo.sec.planes) {
    const ps = purlins.filter((m) => m.purlin?.side === pl.id).sort((a, c) => a.purlin!.sSlope - c.purlin!.sSlope);
    if (ps.length < 2) continue;
    for (const bay of bays) for (let r = 1; r <= k; r++) {
      const y = fr[bay].y + ((fr[bay + 1].y - fr[bay].y) * r) / (k + 1);
      const cid = `C.SR.${pl.id}.${bay + 1}.${r}`;
      const holes: Hole[] = [], parts: string[] = [];
      for (let i = 0; i + 1 < ps.length; i++) {
        const A = purlinWeb(ps[i], y), B = purlinWeb(ps[i + 1], y);
        const dir = norm(sub(B, A));
        const id = `SR.${pl.id}.${bay + 1}.${r}.${i + 1}`;
        const L = Math.hypot(B.x - A.x, B.z - A.z) + 80;
        out.members.push({ id, kind: 'brace', label: `מוט תלייה Ø${sr.d} מפתח ${bay + 1}`, start: sub(A, scale(dir, 40)), end: add(B, scale(dir, 40)), profile: `RD${sr.d}`, material: 'S235', rollDeg: 0, mirror: false, anchor: 'center', refUp: v3(0, 1, 0), source: 'generated', manualPlacement: false, connId: cid, partDesc: `מוט תלייה מוברג Ø${sr.d} L=${Math.round(L)} + 4 אומים + 4 דסקיות` });
        parts.push(id);
        for (const [pm, P] of [[ps[i], A], [ps[i + 1], B]] as const) if (!holes.some((h) => h.memberId === pm.id)) holes.push({ id: `${cid}.H${holes.length + 1}`, memberId: pm.id, p: P, axis: dir, d: sr.d + 2 });
      }
      out.connections.push({ id: cid, type: 'brace', label: `מוטות תלייה ${pl.label} מפתח ${bay + 1}${k > 1 ? ` (${r}/${k})` : ''} — דרך ווב הפטות, אומים בשני הצדדים`, holes, members: ps.map((m) => m.id), parts: [], bolts: [], welds: [], status: 'not-verified', fixity: 'pinned', overridden: false });
    }
  }
  return out;
}

/**
 * תמיכה צידית לפטה (fly brace): בכל קורת גג, בכל פטה n-ית — שני זוויתנים ב-45° מהווב של הפטה אל פח מרותך מתחת לאגף
 * התחתון של הקורה (בשני הצדדים). הזוויתן צמוד לגב הווב של הפטה (הצד ללא האגפים), בורג אחד בכל קצה (שטח).
 */
export function buildFlyBraces(b: BuildingParams, topo: SectionTopology, purlins: Member[], profOf?: (id: string) => string | undefined, avoid?: (x: number, y: number) => boolean, obstacles: Member[] = []): Out {
  const out: Out = { members: [], connections: [], issues: [] };
  const fb = b.bracing.flyBraces;
  if (!fb?.enabled) return out;
  const ap = tryProfile(fb.profile);
  if (!ap) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `תמיכה צידית: חתך לא מוכר ${fb.profile}` }); return out; }
  const leg = ap.props.b, ta = ap.dims.t ?? 5, tp = 8, every = Math.max(1, Math.round(fb.every));
  const Y = v3(0, 1, 0);
  let skipped = 0;
  const obs = obstacles.map((o) => ({ o, box: aabb(o) }));
  for (const pl of topo.sec.planes) {
    const ps = purlins.filter((m) => m.purlin?.side === pl.id).sort((a, c) => a.purlin!.sSlope - c.purlin!.sSlope);
    for (const f of b.frames) {
      const rid = pl.rafterId(f.id);
      const rn = profOf?.(rid);
      if (!rn) continue;
      const rp = getProfile(rn);
      const h = rp.props.h, bf = rp.props.b;
      ps.forEach((pm, i) => {
        if ((i + 1) % every !== 0) return;
        const x = pm.start.x;
        if (x < Math.min(pl.a.x, pl.b.x) + 50 || x > Math.max(pl.a.x, pl.b.x) - 50) return;
        if (avoid?.(x, f.y)) { skipped++; return; }
        const pp = getProfile(pm.profile);
        const n = pm.purlin!.roofNormal;
        const slope = (pl.b.z - pl.a.z) / (pl.b.x - pl.a.x);
        const dir = norm(v3(1, 0, slope));
        // צד הגב של ווב הפטה (ללא אגפים): הזוויתן צמוד לפח/לווב בצד הזה
        const lf = localFrame(pm);
        const fl = pp.family === 'Z' ? scale(lf.u, -1) : lf.u;
        const back = -(Math.sign(fl.x * dir.x + fl.z * dir.z) || 1);
        const bk = scale(dir, back);
        const tos = v3(x, f.y, zAt(pl, x));
        const yb = bf / 2 + 30, dn = h + 60; // נקודת הבורג: 30 מתחת לאגף התחתון / 30 מעל תחתית הפטה — 45°
        const g = Math.min(leg - 18, Math.round(leg * 0.55));
        for (const s of [-1, 1] as const) {
          const key = `${pl.id}.${f.id}.${pm.purlin!.index}.${s < 0 ? 'A' : 'B'}`;
          const cid = `C.FB.${key}`, id = `FB.${key}`;
          const Bt = add(add(tos, scale(n, -h - 30)), scale(Y, s * yb));
          const Tp = add(add(v3(pm.start.x, f.y, pm.start.z), scale(n, 30)), scale(Y, s * (yb + dn)));
          const ex = norm(sub(Tp, Bt));
          const fr0 = localFrame({ start: Bt, end: Tp, refUp: bk, rollDeg: 0, mirror: false });
          const corner = (P: Vec3) => add(add(P, scale(fr0.u, -g)), scale(bk, tp / 2));
          const fbm: Member = { id, kind: 'brace', label: `תמיכה צידית לפטה ${pm.purlin!.index} מסגרת ${b.frames.indexOf(f) + 1}`, start: corner(add(Bt, scale(ex, -25))), end: corner(add(Tp, scale(ex, 25))), profile: fb.profile, material: b.material, rollDeg: 0, mirror: false, anchor: 'corner', refUp: bk, source: 'generated', manualPlacement: false, connId: cid, partDesc: `תמיכה צידית ${fb.profile}` };
          // מכשול (אלכסון קושרת גג / פח / תמוכה) — מדלגים על המיקום הזה
          const box = aabb(fbm);
          if (obs.some((q) => aabbOverlap(box, q.box) && clash(fbm, q.o))) { skipped++; continue; }
          out.members.push(fbm);
          // פח מתחת לאגף התחתון (מרותך במסגריה) במישור ווב הקורה; פני הפח בצד הגב — הזוויתן צמוד אליו
          const pid = `${cid}.PL`;
          const pn0 = add(tos, scale(n, -h - 30));
          out.members.push({ id: pid, kind: 'plate', label: `פח תמיכה צידית PL${tp}×60×${Math.round(yb + 30 - (bf / 2 - 25))}`, start: add(pn0, scale(Y, s * (bf / 2 - 25))), end: add(pn0, scale(Y, s * (yb + 30))), profile: `PL60x${tp}`, material: b.material, rollDeg: 0, mirror: false, anchor: 'center', refUp: bk, source: 'generated', manualPlacement: false, connId: cid, partDesc: `פח תמיכה צידית PL${tp}×60 — מרותך מתחת לאגף התחתון` });
          const spec = bolt(fb.boltD);
          const bolts: BoltInfo[] = [
            makeBolt(`${cid}.B1`, cid, add(Bt, scale(bk, tp / 2 + ta)), scale(bk, -1), spec, ta + tp, 'site', [id, pid], Y, out.members),
            makeBolt(`${cid}.B2`, cid, add(Tp, scale(bk, tp / 2 + ta)), scale(bk, -1), spec, ta + (pp.dims.t ?? 2) + 3, 'site', [id, pm.id], Y, out.members),
          ];
          const welds: WeldInfo[] = [{ id: `${cid}.W1`, connId: cid, type: 'fillet', a: 4, length: 2 * 50, location: 'shop', between: [rid, pid], from: add(tos, scale(n, -h)), to: add(tos, scale(n, -h)) }];
          out.connections.push({ id: cid, type: 'brace', label: `תמיכה צידית — פטה ${pm.purlin!.index} לאגף התחתון של קורת הגג מסגרת ${b.frames.indexOf(f) + 1}`, members: [rid, pm.id], parts: [id, pid, ...bolts.map((x) => x.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
        }
      });
    }
  }
  if (skipped) out.issues.push({ code: 'FB_SKIP', severity: 'info', message: `תמיכה צידית: ${skipped} מיקומים דולגו — סמוכים לתמוכה בין הקורות / לפח קושרת (מניעת התנגשות)` });
  return out;
}

/**
 * סיב רציף בשורת עמודים: קורת RHS בין העמודים בכל המפתחים, מתחת לקורת הגג (פני עליון 60 מתחת לתחתית הקורה).
 * חיבור בכל קצה: פח מרותך לעמוד + לשונית בחריץ ה-RHS, מוברגים בחפיפה (כמו קורת אגד B).
 */
export function buildLineTies(b: BuildingParams, topo: SectionTopology, profOf?: (id: string) => string | undefined): Out {
  const out: Out = { members: [], connections: [], issues: [] };
  const lt = b.bracing.lineTies;
  if (!lt?.enabled || !lt.lines.length) return out;
  const tp = tryProfile(lt.profile);
  if (!tp) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `סיב רציף: חתך לא מוכר ${lt.profile}` }); return out; }
  const raf = getProfile(b.rafterProfile);
  const X = v3(1, 0, 0);
  const fr = [...b.frames].sort((p, q) => p.y - q.y);
  const br = b.bracing;
  for (const lid of lt.lines) {
    const l = topo.sec.lines.find((q) => q.id === lid);
    if (!l || l.wall) continue;
    const lType = br.walls.enabled ? (br.walls.lineType?.[l.id] ?? br.walls.type ?? 'x') : 'x';
    const wallsOn = br.walls.enabled && (br.walls.byLine?.[l.id]?.length ?? 0) > 0;
    if (wallsOn && lType === 'truss') { out.issues.push({ code: 'TIE_TRUSS', severity: 'info', message: `סיב רציף ציר ${l.label}: בציר יש נעילה אופקית עם סיב רציף — לא נוסף סיב נוסף` }); continue; }
    const ct = topo.colTop.get(l.id);
    if (!ct) continue;
    const cap = ct.cap ?? topo.junctions.find((j) => j.line === l)?.plane;
    const sl = cap ? Math.abs((cap.b.z - cap.a.z) / (cap.b.x - cap.a.x)) : 0;
    const zTop = ct.z - raf.props.h * Math.sqrt(1 + sl * sl) - 60;
    const zc = zTop - tp.props.h / 2;
    if (wallsOn && lType === 'portal') {
      const gap = { ...(br.walls.portal ?? {}), ...(br.walls.linePortal?.[l.id] ?? {}) }.gap ?? 150;
      if (gap < tp.props.h + 20) out.issues.push({ code: 'TIE_PORTAL', severity: 'warning', message: `סיב רציף ציר ${l.label}: קורת אגד B צמודה מדי (מרווח ${gap} < ${tp.props.h + 20}) — הגדל את המרווח מתחת לקורה הראשית באגד B` });
    }
    for (let bay = 0; bay + 1 < fr.length; bay++) {
      const f0 = fr[bay], f1 = fr[bay + 1];
      const c0 = `${f0.id}.COL.${l.id}`, c1 = `${f1.id}.COL.${l.id}`;
      const p0 = profOf?.(c0), p1 = profOf?.(c1);
      if (!p0 || !p1) continue; // עמוד מבוטל (דילול) — אין סיב במפתח
      const half = (nm: string) => { const cp = getProfile(nm); return ['RHS', 'SHS', 'CHS'].includes(cp.family) ? cp.props.b / 2 : (cp.dims.tw ?? 8) / 2; };
      const key = `${bay + 1}.${l.id}`, bid = `LTIE.${key}`;
      const ends = ([['E0', f0.y + half(p0), 1, c0], ['E1', f1.y - half(p1), -1, c1]] as const).map(([k, yF, sg, col]) => {
        const cid = `C.LTIE.${key}.${k}`;
        const j = finJoint({ cid, desc: 'סיב רציף', hostId: col, memberId: bid, P: v3(l.x, yF, zc), n: v3(0, sg, 0), d: v3(0, sg, 0), pn: X, side: 1, prof: tp, profile: lt.profile, finT: lt.plateT, tongueT: lt.plateT, bolt: lt.bolt, bolts: 2, weldSize: 5, mat: b.material });
        return { cid, col, j };
      });
      out.members.push({ id: bid, kind: 'beam', label: `סיב רציף ציר ${l.label} מפתח ${bay + 1}`, start: ends[0].j.start, end: ends[1].j.start, profile: lt.profile, material: b.material, rollDeg: 0, mirror: false, anchor: 'center', refUp: v3(0, 0, 1), source: 'generated', manualPlacement: false, partDesc: `סיב רציף ${lt.profile}` });
      for (const e of ends) {
        out.members.push(...e.j.members); out.issues.push(...e.j.issues);
        out.connections.push({ id: e.cid, type: 'knee', label: `סיב רציף ציר ${l.label} מפתח ${bay + 1} — לעמוד`, members: [e.col, bid], parts: e.j.parts, bolts: e.j.bolts, welds: e.j.welds, ...slotsOf(e.j), status: 'not-verified', fixity: 'pinned', overridden: false });
      }
    }
  }
  return out;
}
