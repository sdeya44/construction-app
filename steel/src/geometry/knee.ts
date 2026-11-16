import { add, cross, dot, norm, scale, sub, v3, type Plane, type Vec3 } from '../core/vec';
import type { BoltInfo, Connection, KneeBraceParams, Member, Project, ValidationIssue, WeldInfo } from '../model/types';
import { zAt, type SectionTopology } from '../model/section';
import { getProfile, tryProfile } from '../profiles/library';
import { hw, makeBolt } from './connections';
import { finJoint } from './finJoint';

/** ברירת מחדל לפי תוכניות הלקוח: RHS80/80/4, פלטת קצה 180×280×14 בכל קצה, 4×M16 (שתי עמודות × שתי שורות) */
export function defaultKneeBraces(): KneeBraceParams {
  return {
    enabled: false, profile: 'RHS80x80x4', drop: 800, reach: 900, mode: 'angle', angle: 45, plateT: 12, plateW: 180, plateL: 280,
    bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, gauge: 80, pitch: 200, weldSize: 5, exclude: [],
    detail: 'fin', boltsPerEnd: 2,
  };
}

const lineHitPlane = (P: Vec3, d: Vec3, pl: Plane): Vec3 => {
  const t = dot(sub(pl.point, P), pl.normal) / dot(d, pl.normal);
  return add(P, scale(d, t));
};

/**
 * אלכסוני עמוד-קורה (knee brace) בכל מפגש עמוד-מישור, לכל צד שבו הקורה ממשיכה מעבר ל-reach.
 * פרט: פלטת קצה מרותכת לאלכסון (מסגריה), מוברגת לאגף העמוד / לאגף התחתון של הקורה (שטח, 4 ברגים); הברגים מחוץ להיטל האלכסון על הפלטה — לגישת מפתח. גיאומטריה בלבד, ללא בדיקת חוזק.
 */
export function buildKneeBraces(project: Project, topo: SectionTopology, byId: Map<string, Member>): { members: Member[]; connections: Connection[]; issues: ValidationIssue[] } {
  const out = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[] };
  const kb = project.building.kneeBraces;
  if (!kb?.enabled) return out;
  const prof = tryProfile(kb.profile);
  if (!prof) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `אלכסון עמוד-קורה: חתך לא מוכר ${kb.profile}` }); return out; }
  const mat = project.building.material;
  const X = v3(1, 0, 0), Y = v3(0, 1, 0), Z = v3(0, 0, 1);
  const d0 = kb.bolt.d + kb.bolt.clearance;
  const nutR = hw(kb.bolt.d).s / Math.sqrt(3) + 2;
  for (const f of project.building.frames) {
    const fi = project.building.frames.indexOf(f) + 1;
    for (const jn of topo.junctions) {
      const col = byId.get(`${f.id}.COL.${jn.line.id}`), raf = byId.get(jn.plane.rafterId(f.id));
      if (!col || !raf || col.manualPlacement || raf.manualPlacement) continue;
      const cp = getProfile(col.profile), rp = getProfile(raf.profile);
      const pl = jn.plane;
      const lo = Math.min(pl.a.x, pl.b.x), hi = Math.max(pl.a.x, pl.b.x);
      const sides: (-1 | 1)[] = jn.kind === 'side' ? [jn.side as -1 | 1] : [-1, 1];
      for (const s of sides) {
        const key = `${jn.line.id}.${pl.id}.${s < 0 ? 'L' : 'R'}`;
        if (kb.exclude.includes(key)) continue;
        // הגדרה לכל צד בנפרד (מפתחים שונים — אורכים שונים): דריסה של ההגדרות הכלליות
        const ov = kb.sides?.[key];
        if (ov?.on === false) continue;
        const kq = { ...kb, ...(ov ?? {}) };
        const profK = ov?.profile ? tryProfile(ov.profile) ?? prof : prof;
        // נקודת החיבור לקורה: לפי זווית מהאופק (ברירת מחדל 45°) או מרחק אופקי קבוע
        let xR = jn.line.x + s * kq.reach;
        if ((kq.mode ?? 'angle') === 'angle') {
          const sl0 = (pl.b.z - pl.a.z) / (pl.b.x - pl.a.x);
          const hv0 = rp.props.h * Math.sqrt(1 + sl0 * sl0);
          const xF = jn.line.x + s * cp.props.h / 2;
          const und0 = (x: number) => (raf.anchor === 'top' ? zAt(pl, x) : zAt(pl, x) + hv0 / 2) - hv0;
          const zC0 = und0(xF) - kq.drop;
          const tA = Math.tan((Math.max(15, Math.min(75, kq.angle ?? 45)) * Math.PI) / 180);
          // zC0 + tA·|x−xF| = und0(x) ⇒ פתרון ליניארי לאורך הצד s
          const slopeS = sl0 * s; // שינוי גובה תחתית הקורה לכל מ"מ בכיוון s
          const dx = (und0(xF) - zC0) / (tA - slopeS);
          if (dx > 0) xR = xF + s * dx;
        }
        // הקורה חייבת להמשיך מעבר לנקודת החיבור + חצי פלטה
        if (xR - kq.plateL / 2 < lo - 1 || xR + kq.plateL / 2 > hi + 1) continue;
        const sl = (pl.b.z - pl.a.z) / (pl.b.x - pl.a.x);
        const hv = rp.props.h * Math.sqrt(1 + sl * sl);
        const tosAt = (x: number) => (raf.anchor === 'top' ? zAt(pl, x) : zAt(pl, x) + hv / 2);
        const xFace = jn.line.x + s * cp.props.h / 2;
        const underFace = tosAt(xFace) - hv;
        // עמוד מקוצר (קורה נושאת על ראש העמוד): נקודת החיבור יורדת מתחת לפלטת הראש
        const colTop = Math.max(col.start.z, col.end.z);
        const zC = colTop < underFace - 50 ? Math.min(underFace - kq.drop, colTop - 160) : underFace - kq.drop;
        if (zC < col.start.z + 500) { out.issues.push({ code: 'KNEE_LOW', severity: 'warning', message: `אלכסון ${key} מסגרת ${fi}: נקודת החיבור לעמוד נמוכה מדי` }); continue; }
        // מישורי המארחים: אגף העמוד (נורמל לכיוון הקורה) ותחתית הקורה (נורמל כלפי מטה)
        const exr = norm(v3(1, 0, sl));
        let nUp = norm(sub(Z, scale(exr, dot(Z, exr))));
        if (nUp.z < 0) nUp = scale(nUp, -1);
        const nDown = scale(nUp, -1);
        const colFace: Plane = { point: v3(xFace, f.y, 0), normal: scale(X, s) };
        const rafUnder: Plane = { point: v3(xR, f.y, tosAt(xR) - hv), normal: nDown };
        const C0 = v3(xFace, f.y, zC), R0 = v3(xR, f.y, tosAt(xR) - hv);
        const dir = norm(sub(R0, C0));
        const id = `C.KB.${f.id}.${key}`;
        const bid = `KB.${f.id}.${key}`;
        if ((kq.detail ?? 'fin') !== 'flange') {
          // פרט הלקוח: פח מרותך לעמוד/לקורה במישור המסגרת, לשונית בחריץ ה-RHS, 2 ברגים בחפיפה
          const common = { cid: id, desc: 'אלכסון', memberId: bid, prof: profK, profile: kq.profile, finT: kq.plateT, tongueT: kq.plateT, bolt: kq.bolt, bolts: kq.boltsPerEnd ?? 2, weldSize: kq.weldSize, mat, pn: Y, side: 1 as const };
          const jc = finJoint({ ...common, tag: 'C', hostId: col.id, P: lineHitPlane(C0, dir, colFace), n: colFace.normal, d: dir });
          const jr = finJoint({ ...common, tag: 'R', hostId: raf.id, P: lineHitPlane(C0, dir, rafUnder), n: rafUnder.normal, d: scale(dir, -1) });
          if (dot(sub(jr.start, jc.start), dir) < 300) { out.issues.push({ code: 'KNEE_SHORT', severity: 'warning', message: `אלכסון ${key} מסגרת ${fi}: קצר מדי לפרט הזיז` }); continue; }
          out.members.push({
            id: bid, kind: 'brace', label: `אלכסון עמוד-קורה ציר ${jn.line.label} מסגרת ${fi}`, start: jc.start, end: jr.start, profile: kq.profile, material: mat,
            rollDeg: 0, mirror: false, anchor: 'center', refUp: Y, source: 'generated', manualPlacement: false, connId: id, partDesc: `אלכסון ${kq.profile}`,
          }, ...jc.members, ...jr.members);
          out.issues.push(...jc.issues, ...jr.issues);
          out.connections.push({ id, type: 'knee', label: `אלכסון עמוד-קורה ציר ${jn.line.label} (${s < 0 ? 'שמאל' : 'ימין'}) מסגרת ${fi}`, members: [col.id, raf.id], parts: [bid, ...jc.parts, ...jr.parts], bolts: [...jc.bolts, ...jr.bolts], welds: [...jc.welds, ...jr.welds], status: 'not-verified', fixity: 'pinned', overridden: false });
          continue;
        }
        const T2 = kq.plateT;
        const offPlane = (pl0: Plane, k: number): Plane => ({ point: add(pl0.point, scale(pl0.normal, k)), normal: pl0.normal });
        const cutC = offPlane(colFace, T2), cutR = offPlane(rafUnder, T2);
        const A = lineHitPlane(C0, dir, cutC), B = lineHitPlane(C0, dir, cutR);
        out.members.push({
          id: bid, kind: 'brace', label: `אלכסון עמוד-קורה ציר ${jn.line.label} מסגרת ${fi}`, start: A, end: B, profile: kq.profile, material: mat,
          rollDeg: 0, mirror: false, anchor: 'center', refUp: Y, source: 'generated', manualPlacement: false, connId: id,
          startCut: { point: A, normal: scale(colFace.normal, -1) }, endCut: { point: B, normal: scale(rafUnder.normal, -1) }, partDesc: `אלכסון ${kq.profile}`,
        });
        const bolts: BoltInfo[] = [], welds: WeldInfo[] = [], parts: string[] = [bid];
        // שני קצוות: [שם, מישור מארח, נקודת ציר על המארח, כיוון "אורך" הפלטה על המארח, מארח]
        const ends: [string, Plane, Vec3, Vec3, Member][] = [
          ['C', colFace, lineHitPlane(C0, dir, colFace), Z, col],
          ['R', rafUnder, lineHitPlane(C0, dir, rafUnder), exr, raf],
        ];
        for (const [k, host, P, lDir, hostM] of ends) {
          const n = host.normal;
          const wDir = norm(cross(n, lDir));
          // פלטת קצה מרותכת לאלכסון (מסגריה), מוברגת לאגף המארח (שטח) — האום בתוך המארח, בין האגף לווב
          const endp = `${id}.${k}`;
          const hp = getProfile(hostM.profile);
          const tfh = hp.dims.tf ?? hp.dims.t ?? 10;
          for (const [pid, off, desc] of [[endp, kq.plateT / 2, 'פלטת קצה לאלכסון']] as const) {
            const c = add(P, scale(n, off));
            out.members.push({
              id: pid, kind: 'plate', label: `${desc} PL${kq.plateT}×${kq.plateW}×${kq.plateL}`, start: sub(c, scale(lDir, kq.plateL / 2)), end: add(c, scale(lDir, kq.plateL / 2)),
              profile: `PL${kq.plateW}x${kq.plateT}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: n,
              source: 'generated', manualPlacement: false, connId: id, partDesc: `${desc} PL${kq.plateT}×${kq.plateW}×${kq.plateL}`,
            });
            parts.push(pid);
          }
          welds.push({ id: `${id}.W${k}`, connId: id, type: 'fillet', a: kq.weldSize, length: 4 * profK.props.b, location: 'shop', between: [bid, endp], from: P, to: P });
          // ברגים: 2 עמודות (wDir) × 2 שורות (lDir), מחוץ להיטל האלכסון על הפלטה
          const sinA = Math.abs(dot(dir, n)) || 1;
          const footL = profK.props.h / sinA / 2 + nutR; // חצי אורך היטל האלכסון + אום
          if (kq.pitch / 2 < footL) out.issues.push({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `אלכסון ${key} מסגרת ${fi}: מרווח ברגים ${kq.pitch} קטן מהיטל האלכסון — הגדל מרווח ואורך פלטה` });
          // מרכז הברגים: נקודת הציר על הפלטה מוזזת לאורך lDir כך שההיטל ממורכז
          for (const [ci, gy] of [[1, -kq.gauge / 2], [2, kq.gauge / 2]] as const) for (const [ri, px] of [[1, -kq.pitch / 2], [2, kq.pitch / 2]] as const) {
            const head = add(add(add(P, scale(n, T2)), scale(wDir, gy)), scale(lDir, px));
            bolts.push(makeBolt(`${id}.B${k}${ci}${ri}`, id, head, scale(n, -1), kq.bolt, kq.plateT + tfh, 'site', [endp, hostM.id], lDir, out.members));
          }
          const twh = hp.dims.tw ?? 8;
          if (kq.gauge / 2 - nutR < twh / 2 + 1) out.issues.push({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `אלכסון ${key} מסגרת ${fi}: אום בתוך ${hostM.id} קרוב לווב — הגדל מרווח לרוחב` });
          if (kq.plateW > hp.props.b + 0.5) out.issues.push({ code: 'PLATE_WIDE', severity: 'info', elementId: id, message: `אלכסון ${key} מסגרת ${fi}: הפלטה רחבה מאגף ${hostM.id}` });
          const e1 = kq.plateL / 2 - kq.pitch / 2, e2 = kq.plateW / 2 - kq.gauge / 2;
          if (Math.min(e1, e2) < 1.2 * d0) out.issues.push({ code: 'BOLT_EDGE', severity: 'warning', elementId: id, message: `אלכסון ${key} מסגרת ${fi}: מרחק שפה ${Math.min(e1, e2)} < 1.2·d0` });
        }
        parts.push(...bolts.map((b) => b.id));
        out.connections.push({ id, type: 'knee', label: `אלכסון עמוד-קורה ציר ${jn.line.label} (${s < 0 ? 'שמאל' : 'ימין'}) מסגרת ${fi}`, members: [col.id, raf.id], parts, bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false });
      }
    }
  }
  return out;
}
