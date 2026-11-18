import { add, dot, norm, scale, sub, v3 } from '../core/vec';
import type { Connection, HaunchParams, Member, Project, ValidationIssue } from '../model/types';
import type { SectionTopology } from '../model/section';
import { getProfile } from '../profiles/library';
import { localFrame } from './frame';

export function defaultHaunch(): HaunchParams { return { enabled: true, length: 1500, depth: 0, webT: 0, flangeT: 0, weldSize: 5 }; }

/**
 * מכפל (haunch) בראש העמוד — מתחת לקורת הגג, בכל צד שבו הקורה ממשיכה פנימה מעבר לעמוד:
 * פח גוף משולש (בעובי הווב) + פח אגף משופע (ברוחב אגף הקורה), מרותכים לקורה במסגריה — מכלול אחד עם הקורה.
 * המכפל מתחיל אחרי קצה פלטות ראש העמוד. גיאומטריה בלבד — ללא בדיקת חוזק/יציבות.
 */
export function buildHaunches(project: Project, members: Member[], byId: Map<string, Member>, topo: SectionTopology, conns: Connection[]): { members: Member[]; connections: Connection[]; issues: ValidationIssue[] } {
  const out = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[] };
  const hp = project.building.haunch;
  if (!hp?.enabled) return out;
  const b = project.building;
  if (b.kneeBraces?.enabled) out.issues.push({ code: 'HAUNCH_KNEE', severity: 'warning', message: 'מכפל ואלכסוני עמוד-קורה יחד — בדרך כלל בוחרים אחד מהם; לבדוק התנגשות בין האלכסון לאגף המכפל' });
  for (const f of b.frames) {
    for (const jn of topo.junctions.filter((j) => j.kind === 'cap')) {
      const col = byId.get(`${f.id}.COL.${jn.line.id}`), raf = byId.get(jn.plane.rafterId(f.id));
      if (!col || !raf) continue;
      const rp = getProfile(raf.profile), cp = getProfile(col.profile);
      const lf = localFrame(raf);
      const h = rp.props.h, bf = rp.props.b;
      const tw = hp.webT || (rp.dims.tw ?? 8), tf = hp.flangeT || (rp.dims.tf ?? 10);
      const D = hp.depth || h;
      const under = raf.anchor === 'top' ? h : h / 2;
      const U = (s: number) => sub(add(raf.start, scale(lf.ex, s)), scale(lf.v, under)); // נקודה על תחתית הקורה
      const sAt = (x: number) => (x - (raf.start.x - lf.v.x * under)) / (lf.ex.x || 1e-9); // s שבו תחתית הקורה ב-x
      const cap = conns.find((c) => c.id === `C.EAVE.${f.id}.${jn.line.id}`);
      const capL = cap ? Math.max(0, ...cap.parts.map((id) => byId.get(id) ?? members.find((m) => m.id === id)).filter((m): m is Member => !!m && m.kind === 'plate').map((m) => Math.hypot(m.end.x - m.start.x, m.end.z - m.start.z) / 2)) : 0;
      const L = hp.length;
      const tMin = 0, tMax = localFrame(raf).length;
      for (const dir of [1, -1] as const) {
        // dir: לאורך x; הצד שבו הקורה ממשיכה מעבר לפני העמוד
        const xFace = jn.line.x + dir * Math.max(cp.props.h / 2 + 15, capL * Math.abs(lf.ex.x) + 15);
        const s0 = sAt(xFace);
        const sgn = Math.sign(lf.ex.x) * dir; // כיוון s פנימה
        const s1 = s0 + sgn * (L / Math.max(Math.abs(lf.ex.x), 0.3));
        if (Math.min(s0, s1) < tMin + 1 || Math.max(s0, s1) > tMax - 1) continue;
        const id = `C.HN.${f.id}.${jn.line.id}.${dir > 0 ? 'R' : 'L'}`;
        const A = U(s0), B = U(s1);
        const down = scale(lf.v, -1);
        // פח גוף: מגע עם תחתית הקורה, משולש (A, B, A+down·D)
        const wid = `${id}.WEB`, fid = `${id}.FL`;
        const ex = norm(sub(B, A));
        const web: Member = { id: wid, kind: 'plate', label: `פח גוף מכפל PL${tw}`, start: A, end: B, profile: `PL${Math.round(D)}x${tw}`, material: raf.material, rollDeg: 0, mirror: false, anchor: 'center', refUp: v3(0, 1, 0), source: 'generated', manualPlacement: false, connId: id, partDesc: `פח גוף מכפל PL${tw} ${Math.round(L)}×${Math.round(D)} (משולש)` };
        const wf = localFrame(web);
        const su = dot(wf.u, down) >= 0 ? 1 : -1;
        const Lw = Math.hypot(B.x - A.x, B.z - A.z);
        web.contour = [{ s: 0, u: 0 }, { s: Lw, u: 0 }, { s: 0, u: su * (D - tf) }];
        out.members.push(web);
        // פח אגף משופע: מקצה הגוף בעמוד (A + down·(D−tf/2)) עד B, בעובי tf, ברוחב אגף הקורה
        const F0 = add(A, scale(down, D - tf / 2)), F1 = B;
        const fd = norm(sub(F1, F0));
        let nF = norm(v3(-fd.z, 0, fd.x));
        if (dot(nF, down) < 0) nF = scale(nF, -1);
        const F0o = add(F0, scale(nF, 0)), F1o = add(F1, scale(nF, tf / 2));
        void ex;
        out.members.push({ id: fid, kind: 'plate', label: `פח אגף מכפל PL${tf}×${bf}`, start: F0o, end: F1o, profile: `PL${Math.round(bf)}x${tf}`, material: raf.material, rollDeg: 0, mirror: false, anchor: 'center', refUp: nF, source: 'generated', manualPlacement: false, connId: id, partDesc: `פח אגף מכפל PL${tf}×${Math.round(bf)}×${Math.round(Math.hypot(F1o.x - F0o.x, F1o.z - F0o.z))}` });
        out.connections.push({
          id, type: 'knee', label: `מכפל ${jn.plane.label} ליד ציר ${jn.line.label} מסגרת ${b.frames.indexOf(f) + 1} — ${Math.round(L)}×${Math.round(D)}`,
          members: [raf.id], parts: [wid, fid], bolts: [],
          welds: [
            { id: `${id}.W1`, connId: id, type: 'fillet', a: hp.weldSize, length: Math.round(2 * Lw), location: 'shop', between: [raf.id, wid], from: A, to: B },
            { id: `${id}.W2`, connId: id, type: 'fillet', a: hp.weldSize, length: Math.round(2 * Math.hypot(F1.x - F0.x, F1.z - F0.z)), location: 'shop', between: [wid, fid], from: F0, to: F1 },
            { id: `${id}.W3`, connId: id, type: 'fillet', a: hp.weldSize, length: Math.round(2 * bf), location: 'shop', between: [raf.id, fid], from: B, to: B },
          ],
          status: 'not-verified', fixity: 'rigid', overridden: false,
        });
      }
    }
  }
  return out;
}
