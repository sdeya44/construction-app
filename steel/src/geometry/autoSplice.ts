import { add, dot, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import type { BoltInfo, Connection, Member, Project, SupportPoint, ValidationIssue, WeldInfo } from '../model/types';
import { tryProfile } from '../profiles/library';
import { axialExtent, BEAM_SPLICE_T } from './parts';
import { proposeSplices } from './purlins';
import { localFrame } from './frame';
import { hw, makeBolt } from './connections';

const AUTO_KINDS = new Set(['rafter', 'column', 'beam', 'purlin']);
/** שורות קשירה לפטות (זוויתן ארוך) — חלוקה גם להן */
const isTie = (m: Member) => m.kind === 'brace' && m.id.startsWith('BR.T');

/**
 * חיבורי המשך אפקטיביים: המיקומים שהמשתמש קבע, ולכל אלמנט ארוך מחומר הגלם שלא נקבע לו דבר — חלוקה אוטומטית
 * (ברירת מחדל, settings.autoSplice ≠ false). פטות: מעל נקודות תמיכה / לפי מספר מפתחים. קורות ועמודים: מוטות מלאים
 * מנקודת ההתחלה (קצה המרזב) והשלמה בסוף, והתפר מוזז לאחור כך שלא ייפול על תומך פטה.
 */
export function effectiveSplices(project: Project, members: Member[], supports: SupportPoint[]): { splices: Record<string, number[]>; auto: Set<string> } {
  const splices: Record<string, number[]> = { ...project.splices };
  const auto = new Set<string>();
  if (project.settings.autoSplice === false) return { splices, auto };
  const stock = project.settings.stockLength;
  const allow = Math.max(10, project.settings.kerf * 3); // מרווח חיתוך מהמוט
  for (const m of members) {
    if (!(AUTO_KINDS.has(m.kind) || isTie(m)) || m.source !== 'generated' || m.id in project.splices) continue;
    const L = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
    if (L <= stock - allow) continue;
    const { tMin, tMax } = axialExtent(m);
    if (tMax - tMin <= stock + 0.5) continue;
    const f = localFrame(m);
    let ts: number[];
    if (m.purlin) {
      const sup = supports.filter((s) => s.purlinId === m.id).map((s) => dot(sub(s.p, m.start), f.ex)).sort((a, b) => a - b);
      const nb = project.building.purlins.pieceBays ?? 0;
      // מדידה מקצה החלק בפועל (tMin — כולל הבליטה מעבר למסגרת הקיצונית), לא מנקודת ההתחלה של הקו
      ts = nb > 0 ? sup.filter((_, i) => i > 0 && i < sup.length - 1 && i % nb === 0) : proposeSplices(tMax - tMin, stock, sup.map((t) => t - tMin)).map((t) => t + tMin);
    } else {
      // אזורים אסורים: תומכי פטות על הקורה (הפלטה המוגבהת מעל האגף העליון)
      // אזורים אסורים: תומכי פטות (±160) ועמודים מתחת לקורה — פלטת ראש עמוד ואלכסון עמוד-קורה (±1300)
      // חיבור מרותך: פלטת כיסוי באורך 500 על האגף העליון — התומך לא יושב עליה
      const weldedJ = (m.kind === 'column' ? project.settings.spliceJoint?.columns : project.settings.spliceJoint?.beams) === 'welded';
      const zoneList: [number, number][] = supports.filter((s) => s.rafterId === m.id).map((s) => [dot(sub(s.p, m.start), f.ex), weldedJ ? 340 : 160]);
      if (m.kind === 'rafter') for (const c of members) if (c.kind === 'column' && c.frameId === m.frameId) {
        const t = dot(sub(c.end, m.start), f.ex);
        const perp = Math.hypot(c.end.x - (m.start.x + f.ex.x * t), c.end.z - (m.start.z + f.ex.z * t));
        if (t > tMin && t < tMax && perp < 1500) zoneList.push([t, 1300]);
      }
      const zones = zoneList.map((z) => z[0]);
      const halfOf = (z: number) => zoneList.find((q) => q[0] === z)?.[1] ?? 160;
      const HALF = 160; void HALF;
      ts = [];
      let s = tMin;
      // מצב חלוקה: stock = מוט מלא + השלמה (ברירת מחדל); equal = חלקים שווים
      const nEq = Math.ceil((tMax - tMin) / (stock - allow));
      const step = project.settings.spliceMode === 'equal' ? (tMax - tMin) / nEq : stock - allow;
      while (tMax - s > stock + 0.5) {
        let t = s + step;
        for (let it = 0; it < 20; it++) {
          const hit = zones.find((z) => Math.abs(z - t) < halfOf(z));
          if (hit === undefined) break;
          t = hit - halfOf(hit);
        }
        if (t - s < 1000) { t = s + step; } // לא נמצא מקום — נשאר במוט מלא (אזהרה בבדיקת ההתנגשות)
        ts.push(Math.round(t));
        s = t;
      }
    }
    if (ts.length) { splices[m.id] = ts; auto.add(m.id); }
  }
  return { splices, auto };
}

/**
 * חיבור המשך לקורת I (פרט הלקוח "חיבור עקרוני הארכה"): שתי פלטות קצה PL12 מרותכות לקצוות (מסגריה),
 * מוגבהות מעל ומתחת לאגפים, מוברגות זו לזו בשטח M16: שורה מחוץ לכל אגף ושתי שורות בין האגפים, 2 עמודות.
 */
export function buildBeamSplices(project: Project, members: Member[], splices: Record<string, number[]>, auto: Set<string>, flushTop: Set<string> = new Set()): { members: Member[]; connections: Connection[]; issues: ValidationIssue[] } {
  const out = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[] };
  const T = BEAM_SPLICE_T, ext = 60;
  const bolt = { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 };
  const d0 = bolt.d + bolt.clearance;
  const nutR = hw(bolt.d).s / Math.sqrt(3) + 2;
  const eE = Math.max(30, Math.ceil((1.5 * d0) / 5) * 5);
  for (const m of members) {
    if (m.kind !== 'rafter' && m.kind !== 'beam' && m.kind !== 'column') continue;
    const ts = [...new Set(splices[m.id] ?? [])].sort((a, b) => a - b);
    if (!ts.length) continue;
    const pr = tryProfile(m.profile);
    const welded = (m.kind === 'column' ? project.settings.spliceJoint?.columns : project.settings.spliceJoint?.beams) === 'welded';
    if (welded && pr) { weldedSplice(m, pr, ts, auto, out); continue; }
    if (!pr || !['IPE', 'HEA', 'HEB', 'HEM', 'INP'].includes(pr.family)) continue;
    const f = localFrame(m);
    const h = pr.props.h, b = pr.props.b, tf = pr.dims.tf ?? 10, tw = pr.dims.tw ?? 7;
    const vc = m.anchor === 'top' ? -h / 2 : 0; // מרכז החתך ביחס לקו
    // flushTop (קורה נושאת): פלטה סמויה מלמעלה — שטוחה עם האגף העליון (מעליה מושבים/קורות גג), בולטת רק למטה
    const flush = flushTop.has(m.id);
    const Hp = flush ? h + ext : h + 2 * ext, W = b, pc = flush ? -ext / 2 : 0;
    const eS = Math.max(25, Math.ceil((1.2 * d0) / 5) * 5);
    const g = Math.max(W - 2 * eS, 0);
    const vOut = h / 2 + ext - eE, vIn = h / 2 - tf - nutR - 8;
    const { tMin, tMax } = axialExtent(m);
    ts.forEach((t, k) => {
      if (!(t > tMin + 100 && t < tMax - 100)) return;
      const id = `C.RS.${m.id}.${k + 1}`;
      const at = (dt: number, dv: number, du = 0) => add(add(add(m.start, scale(f.ex, t + dt)), scale(f.v, vc + dv)), scale(f.u, du));
      const plates: string[] = [];
      for (const [pid, dt] of [[`${id}.PL1`, -T / 2], [`${id}.PL2`, T / 2]] as const) {
        out.members.push({
          id: pid, kind: 'plate', label: `פלטת המשך PL${T}×${W}×${Hp}`, start: at(dt, pc - Hp / 2), end: at(dt, pc + Hp / 2), profile: `PL${W}x${T}`, material: m.material,
          rollDeg: 0, mirror: false, anchor: 'center', refUp: f.ex, source: 'generated', manualPlacement: false, connId: id, partDesc: `פלטת המשך PL${T}×${W}×${Hp}`,
        });
        plates.push(pid);
      }
      // אופציה: פלטות חיזוק משולשות במישור הווב, מעל ומתחת לכל פלטה (מסגריה)
      if (project.settings.spliceStiffeners && !flush) {
        const Ls = 2 * ext, ts = 8;
        for (const [sg, pid] of [[-1, plates[0]], [1, plates[1]]] as const) for (const up of [1, -1]) {
          const sid = `${pid}.ST${up > 0 ? 'T' : 'B'}`;
          const q0 = up * (h / 2 + ext / 2);
          const P0 = at(sg * T, q0), P1 = at(sg * (T + Ls), q0);
          const B = at(sg * (T + Ls), up * h / 2); // קצה המשולש על האגף
          const nrm = norm(add(scale(f.ex, sg * ext), scale(f.v, up * Ls)));
          out.members.push({
            id: sid, kind: 'plate', label: `פלטת חיזוק PL${ts}`, start: P0, end: P1, profile: `PL${ext}x${ts}`, material: m.material, rollDeg: 0, mirror: false, anchor: 'center',
            refUp: f.u, source: 'generated', manualPlacement: false, connId: id, endCut: { point: B, normal: nrm }, partDesc: `פלטת חיזוק משולשת PL${ts}×${ext}×${Ls}`,
          });
          plates.push(sid);
        }
      }
      const bolts: BoltInfo[] = [];
      for (const dv of flush ? [vIn, -vIn, -vOut] : [vOut, vIn, -vIn, -vOut]) for (const du of [-g / 2, g / 2]) {
        bolts.push(makeBolt(`${id}.B${bolts.length + 1}`, id, at(-T, dv, du), f.ex, bolt, 2 * T, 'site', plates.slice(0, 2), f.v, out.members));
      }
      if (g / 2 - tw / 2 < nutR) out.issues.push({ code: 'BOLT_ACCESS', severity: 'warning', elementId: id, message: `${m.label}: חיבור המשך — אום קרוב לווב (אגף צר)` });
      if (vOut - vIn < 2.2 * d0) out.issues.push({ code: 'BOLT_EDGE', severity: 'warning', elementId: id, message: `${m.label}: חיבור המשך — מרווח שורות קטן` });
      const per = 2 * b + 2 * (h - 2 * tf) + 2 * (b - tw);
      // מיקום הריתוך = מרכז הפלטה (כך כל פלטה משויכת לחלק שאליו היא מרותכת — לפני/אחרי התפר)
      const cOf = (pid: string) => { const pm = out.members.find((x) => x.id === pid)!; return v3((pm.start.x + pm.end.x) / 2, (pm.start.y + pm.end.y) / 2, (pm.start.z + pm.end.z) / 2); };
      const welds: WeldInfo[] = plates.map((pid, i) => ({ id: `${id}.W${i + 1}`, connId: id, type: 'fillet', a: 6, length: Math.round(per), location: 'shop', between: [m.id, pid], from: cOf(pid), to: cOf(pid) }));
      out.connections.push({
        id, type: 'beam-splice', label: `חיבור המשך ${m.label} (${(t / 1000).toFixed(2)} מ')${auto.has(m.id) ? ' — אוטומטי' : ''}`,
        members: [m.id], parts: [...plates, ...bolts.map((x) => x.id)], bolts, welds, status: 'not-verified', fixity: 'rigid', overridden: false,
      });
    });
  }
  void v3; void project;
  return out;
}

/**
 * חיבור המשך מרותך במסגריה (פרטי הלקוח "פרט הארכת אגדים / עמוד"): פלטות כיסוי t=12 על שני האגפים ושתי פלטות ווב,
 * ב-RHS — פלטה בשני צדדים. כל פלטה מרותכת לשני החלקים ⇒ החלקים והפלטות הם מכלול אחד (יוצא מהמסגריה שלם).
 */
function weldedSplice(m: Member, pr: NonNullable<ReturnType<typeof tryProfile>>, ts: number[], auto: Set<string>, out: { members: Member[]; connections: Connection[]; issues: ValidationIssue[] }) {
  const f = localFrame(m);
  const h = pr.props.h, b = pr.props.b;
  const isI = ['IPE', 'HEA', 'HEB', 'HEM', 'INP'].includes(pr.family);
  const isBox = ['RHS', 'SHS'].includes(pr.family);
  if (!isI && !isBox) { out.issues.push({ code: 'SPLICE_WELD', severity: 'warning', elementId: m.id, message: `${m.label}: חיבור המשך מרותך לא מוגדר לחתך ${m.profile} — לתכנון` }); return; }
  const vc = m.anchor === 'top' ? -h / 2 : 0;
  const tf = pr.dims.tf ?? pr.dims.t ?? 10, tw = pr.dims.tw ?? pr.dims.t ?? 7, r = pr.dims.r ?? 0;
  const T = 12, r10 = (x: number) => Math.max(40, Math.floor(x / 10) * 10);
  const { tMin, tMax } = axialExtent(m);
  ts.forEach((t, k) => {
    if (!(t > tMin + 100 && t < tMax - 100)) return;
    const id = `C.WS.${m.id}.${k + 1}`;
    const at = (dt: number, dv: number, du = 0) => add(add(add(m.start, scale(f.ex, t + dt)), scale(f.v, vc + dv)), scale(f.u, du));
    const plates: { id: string; L: number; w: number }[] = [];
    const plate = (pid: string, L: number, w: number, t2: number, dv: number, du: number, up: Vec3, desc: string) => {
      out.members.push({ id: pid, kind: 'plate', label: desc, start: at(-L / 2, dv, du), end: at(L / 2, dv, du), profile: `PL${w}x${t2}`, material: m.material, rollDeg: 0, mirror: false, anchor: 'center', refUp: up, source: 'generated', manualPlacement: false, connId: id, partDesc: `${desc} PL${t2}×${w}×${L}` });
      plates.push({ id: pid, L, w });
    };
    if (isI) {
      const wf = r10((b * 2) / 3), hw = r10(h - 2 * tf - 2 * r - 40), L = 500;
      plate(`${id}.FT`, L, wf, T, h / 2 + T / 2, 0, f.v, 'פלטת כיסוי אגף עליון');
      plate(`${id}.FB`, L, wf, T, -h / 2 - T / 2, 0, f.v, 'פלטת כיסוי אגף תחתון');
      plate(`${id}.WL`, L, hw, T, 0, tw / 2 + T / 2, f.u, 'פלטת ווב');
      plate(`${id}.WR`, L, hw, T, 0, -tw / 2 - T / 2, f.u, 'פלטת ווב');
    } else {
      const tb = 10, L = 600;
      plate(`${id}.SL`, L, r10(b - 20), tb, 0, b / 2 + tb / 2, f.u, 'פלטת הארכה צד');
      plate(`${id}.SR`, L, r10(b - 20), tb, 0, -b / 2 - tb / 2, f.u, 'פלטת הארכה צד');
    }
    // שני ריתוכים לכל פלטה — אחד לכל צד של התפר (שני החלקים מרותכים לאותה פלטה ⇒ מכלול אחד)
    const welds: WeldInfo[] = plates.flatMap((pl, i) => [-1, 1].map((sg, j) => {
      const c = at((sg * pl.L) / 4, 0);
      return { id: `${id}.W${i + 1}${j ? 'B' : 'A'}`, connId: id, type: 'fillet' as const, a: 6, length: Math.round(pl.L + pl.w), location: 'shop' as const, between: [m.id, pl.id] as [string, string], from: c, to: c };
    }));
    out.connections.push({
      id, type: 'beam-splice', label: `חיבור המשך מרותך ${m.label} (${(t / 1000).toFixed(2)} מ')${auto.has(m.id) ? ' — אוטומטי' : ''} — מסגריה`,
      members: [m.id], parts: plates.map((x) => x.id), bolts: [], welds, status: 'not-verified', fixity: 'rigid', overridden: false,
    });
  });
}
