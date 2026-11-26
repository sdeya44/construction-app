import { add, dot, norm, scale, sub, v3, type Plane, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type {
  DerivedModel, GridLine, Member, ModelNode, Project, RoofInfo, ValidationIssue,
} from '../model/types';
import { derivedRoof, hasErrors, validateBuilding } from '../model/validate';
import { normalizeSection, sectionTopology, type NSection, type SectionTopology } from '../model/section';
import { buildParts } from './parts';
import { issueKey } from '../model/issues';
import { buildBeamSplices, effectiveSplices } from './autoSplice';
import { buildPurlins } from './purlins';
import type { Connection, SupportPoint } from '../model/types';
import { buildConnections, checkClashes } from './connections';
import { unifyBolts } from '../fab/unify';
import { buildWallFraming } from './cladding';
import { buildGutterBrackets } from './gutter';
import { generateWithWing } from './wing';
import { buildTransfers, prepareTransfers } from './transfer';
import { buildRoofTrusses, roofTrussRafterSplices } from './truss';
import { buildBracing } from './bracing';
import { buildHaunches } from './haunch';
import { applyPlan, planMap } from './plan';
import { applyCustomDetails } from './detail';

const HEB_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת';
export const xAxisLabel = (i: number) => HEB_LETTERS[i] ?? `X${i + 1}`;

/** חתימה של מיקום לזיהוי התאמות ידניות שהפכו ללא תקפות. */
export const placementBasis = (s: Vec3, e: Vec3) =>
  [s.x, s.y, s.z, e.x, e.y, e.z].map((n) => n.toFixed(2)).join(',');

const Z = v3(0, 0, 1), X = v3(1, 0, 0);

/**
 * גזירת המודל הפיזי מפרמטרי הפרויקט. פונקציה טהורה ודטרמיניסטית:
 * אותו Project ⇒ אותם אלמנטים, אותם מזהים, אותה גיאומטריה.
 */
/** בניית המודל: סככה ראשית, ואם הוגדרה — כנף (צורת L) שמחוברת אליה */
export function generate(project: Project): DerivedModel {
  return unifyBolts(generateAny(project), project.settings.boltUnify);
}
function generateAny(project: Project): DerivedModel {
  if (project.building.wing?.enabled) return generateWithWing(project, generateBase);
  const pl = project.building.plan;
  if (pl && pl.shape !== 'rect') {
    // תוכנית לא מלבנית: בנייה מלבנית במערכת מקומית ומיפוי לעולם
    const local = generateBase({ ...project, building: { ...project.building, plan: undefined } });
    if (hasErrors(local.issues) && !local.members.length) return local;
    const map = planMap(local, project);
    return map ? applyPlan(project, local, map) : local;
  }
  return generateBase(project);
}

export function generateBase(project: Project): DerivedModel {
  const b = project.building;
  const issues: ValidationIssue[] = validateBuilding(b);
  const members: Member[] = [];
  const nodes: ModelNode[] = [];
  const grid: GridLine[] = [];
  const roof: RoofInfo = hasErrors(issues) ? { slopeLeft: 0, slopeRight: 0 } : derivedRoof(b);
  let sec: NSection | null = null;
  let topo: SectionTopology | null = null;

  // קצה קורת הגג: לפחות עד קצה פלטת הכיפה (או הפנים החיצוניות של העמוד), גם כשהקונזולה 0
  let bEff = b;
  if (!hasErrors(issues)) {
    const eave = project.connectionDefaults.eave;
    const minExt = eave.enabled ? eave.l / 2 : getProfile(b.columnProfile).props.h / 2;
    const exL = Math.max(b.rafterOverhangLeft, minExt), exR = Math.max(b.rafterOverhangRight, minExt);
    if (exL > b.rafterOverhangLeft || exR > b.rafterOverhangRight) {
      issues.push({ code: 'RAFTER_EXT', severity: 'info', message: `לידיעה, אין צורך בפעולה: קצה קורת הגג בולט ${minExt} מ"מ מעבר לציר העמוד — עד קצה ${eave.enabled ? 'פלטת הכיפה' : 'העמוד'}, כדי שהקורה תשב על כל הפלטה. הפטה האחרונה נקבעת לפי הקצה הזה. לשינוי — "קונזולת קורה" בגיאומטריה` });
    }
    // קצה הפטה: לפחות חצי רוחב זוויתן מעבר למסגרת הקיצונית, כדי ששני הברגים יעברו בפטה
    const pu = b.purlins;
    // חצי רוחב התושבת לאורך הפטה (לפי סוג התושבת)
    const halfW = (c: typeof pu.left.cleat) => {
      if (!c.enabled) return 0;
      if (c.style === 'stand') return 30;
      if (c.style === 'plate') { const n = Math.max(2, c.perRow % 2 ? c.perRow + 1 : c.perRow); return ((n - 1) * Math.max(c.pitch, 60)) / 2 + Math.max(30, Math.ceil((1.5 * (c.bolt.d + c.bolt.clearance)) / 5) * 5); }
      return c.width / 2;
    };
    // תושבת מפרט מותאם (סטודיו) — מרווח שמרני לברגים בקצה הפטה
    const customCleat = Object.keys(project.detailAssign ?? {}).some((k) => k.includes('|x:')) ? 80 : 0;
    const cw = Math.max(halfW(pu.left.cleat), b.roofType === 'gable' ? halfW(pu.right.cleat) : 0, customCleat);
    const pS = Math.max(b.purlinOverhangStart, cw), pE = Math.max(b.purlinOverhangEnd, cw);
    if (pS > b.purlinOverhangStart || pE > b.purlinOverhangEnd) {
      issues.push({ code: 'PURLIN_EXT', severity: 'info', message: `לידיעה, אין צורך בפעולה: הפטות בולטות ${cw} מ"מ מעבר למסגרות הקיצוניות, עד קצה הזוויתן, כדי ששני הברגים יעברו בפטה. לשינוי — "קונזולת פטות"` });
    }
    bEff = { ...b, rafterOverhangLeft: exL, rafterOverhangRight: exR, purlinOverhangStart: pS, purlinOverhangEnd: pE };
  }
  if (!hasErrors(issues)) {
    const b = bEff;
    const raf = getProfile(b.rafterProfile);
    const tos = b.heightRef === 'TOS';
    // מרחק מקו הייחוס של הקורה לפני התחתונים של הקורה (בניצב לקורה)
    const underOffset = tos ? raf.props.h : raf.props.h / 2;
    const anchor = tos ? 'top' : 'center';

    const col0 = getProfile(b.columnProfile);
    const eaveP = project.connectionDefaults.eave;
    sec = normalizeSection(b, roof);
    topo = sectionTopology(sec, col0.props.h / 2, eaveP.enabled ? eaveP.l / 2 : col0.props.h / 2);
    issues.push(...topo.issues.filter((i) => sec!.custom || i.code !== 'RAFTER_EXT'));
    if (topo.issues.some((i) => i.severity === 'error')) { /* שגיאת טופולוגיה — ללא גיאומטריה */ } else {
    for (const l of sec.lines) grid.push({ id: `GX-${l.id}`, label: l.label, dir: 'X', pos: l.x });
    const T = topo;

    b.frames.forEach((f, fi) => {
      const y = f.y;
      grid.push({ id: `GY-${f.id}`, label: String(fi + 1), dir: 'Y', pos: y });
      const under = new Map<string, Plane>();
      const dropAt = new Map<string, number>();
      for (const pl of sec!.planes) {
        const A = v3(pl.a.x, y, pl.a.z), B = v3(pl.b.x, y, pl.b.z);
        // חריג חתך לקורה זו (memberOverrides): פני התחתון לפי החתך שלה — העמוד והפלטה יורדים בהתאם
        const ovP = project.memberOverrides[pl.rafterId(f.id)]?.profile;
        const ovR = ovP ? tryProfile(ovP) : undefined;
        const up = underPlane(A, B, ovR ? (tos ? ovR.props.h : ovR.props.h / 2) : underOffset);
        if (ovR) { const cosA = Math.abs(B.x - A.x) / (Math.hypot(B.x - A.x, B.z - A.z) || 1) || 1; dropAt.set(pl.id, ((tos ? ovR.props.h : ovR.props.h / 2) - underOffset) / cosA); }
        under.set(pl.id, up);
        // קצה חופשי (מרזב/קונזולה): חיתוך ניצב לציר הקורה (90°), התחתון בקו הקצה — החלטת משתמש 15.11.2026.
        // קצה ברכס או בצד עמוד — נחתך מחדש בבניית החיבור.
        const exR = norm(sub(B, A));
        const below = (P: Vec3) => add(P, scale(Z, dot(sub(up.point, P), up.normal) / dot(Z, up.normal)));
        // חיתוך 90° דרך הפינה שנותנת קורה ארוכה יותר: גם הפנים העליונות (פטה) וגם התחתונות (פלטת ראש עמוד) מגיעות לקצה.
        // בשיפוע תלול (למשל 45°) זה ההבדל בין פטה שיושבת על הקורה לפטה שבולטת ממנה.
        const cutAt = (P: Vec3, outward: -1 | 1) => { const Q = below(P); return dot(sub(Q, P), exR) * outward > 0 ? Q : P; };
        const side = pl.id === 'L' || pl.id === 'R' ? pl.id : undefined;
        members.push({
          id: pl.rafterId(f.id), kind: 'rafter', frameId: f.id, side, planeId: pl.id,
          label: sec!.custom ? `קורת גג ${pl.label} מסגרת ${fi + 1}` : `קורת גג ${side === 'L' ? 'שמאל' : side === 'R' ? 'ימין' : ''} מסגרת ${fi + 1}`.replace('  ', ' '),
          start: A, end: B, profile: b.rafterProfile, material: b.material, rollDeg: 0, mirror: false,
          anchor, refUp: Z, startCut: { point: cutAt(A, -1), normal: exR }, endCut: { point: cutAt(B, 1), normal: exR }, source: 'generated', manualPlacement: false,
        });
      }
      for (const r of T.ridges) nodes.push({ id: sec!.custom ? `${f.id}.N.RG.${r.pa.id}.${r.pb.id}` : `${f.id}.N.RG`, p: v3(r.x, y, r.z), frameId: f.id, role: 'רכס' });
      for (const l of sec!.lines) {
        const ct = T.colTop.get(l.id);
        if (!ct) continue;
        // מפלס תחתית העמוד בציר הזה (חגורה/יסוד בגובה שונה) — העמוד מתקצר, הגג לא זז
        const base = b.lineBase?.[l.id] ?? b.baseElevation;
        if (fi === 0 && ct.z - base < 1000) issues.push({ code: 'COL_SHORT', severity: 'error', message: `עמוד בציר ${l.label}: מפלס התחתית ${(base / 1000).toFixed(2)} גבוה מדי ביחס לראש העמוד` });
        // קו הייחוס של העמוד: עד פני עליון קורת הגג בציר (החיתוך — לפי פני התחתון של הקורה בפועל, endCut)
        const top = v3(l.x, y, ct.z);
        const side = !sec!.custom ? (l.id as 'L' | 'R') : undefined;
        nodes.push({ id: `${f.id}.N.B${l.id}`, p: v3(l.x, y, base), frameId: f.id, role: `בסיס ציר ${l.label}` });
        nodes.push({ id: `${f.id}.N.E${l.id}`, p: top, frameId: f.id, role: `ראש עמוד ציר ${l.label}` });
        members.push({
          id: `${f.id}.COL.${l.id}`, kind: 'column', frameId: f.id, side, lineId: l.id,
          label: sec!.custom ? `עמוד ציר ${l.label} מסגרת ${fi + 1}` : `עמוד ${side === 'L' ? 'שמאל' : 'ימין'} מסגרת ${fi + 1}`,
          start: v3(l.x, y, base), end: top, profile: b.columnProfile, material: b.material,
          rollDeg: 0, mirror: false, anchor: 'center', refUp: X,
          endCut: ct.cap ? under.get(ct.cap.id)! : { point: top, normal: Z }, source: 'generated', manualPlacement: false,
        });
      }
    });
    }
  }

  // פטות ונקודות תמיכה
  const deleted = new Set(project.deleted);
  let supports: SupportPoint[] = [];
  const structuralError = hasErrors(issues);
  // דילול עמודים: עמודים מוסרים נכנסים ל-deleted; ב-A1 העמודים התומכים מתקצרים
  const tbPlans = !structuralError && sec ? prepareTransfers(project, bEff, sec, members, deleted, issues) : [];
  if (!structuralError && sec) {
    const pr = buildPurlins(bEff, sec, deleted);
    members.push(...pr.members);
    supports = pr.supports;
    issues.push(...pr.issues);
  }

  // התאמות ידניות, מחיקות ואלמנטים ידניים
  const out: Member[] = [];
  for (const m of members) {
    if (deleted.has(m.id)) continue;
    const o = project.memberOverrides[m.id];
    if (o) {
      if (o.profile) m.profile = o.profile;
      if (o.material) m.material = o.material;
      if (o.rollDeg !== undefined) m.rollDeg = o.rollDeg;
      if (o.mirror !== undefined) {
        if (m.purlin) {
          // בפטה: היפוך הוא יחסי לכיוון שנקבע בפריסה; קו הפטה אינו זז
          if (o.mirror) { m.mirror = !m.mirror; m.purlin = { ...m.purlin, opening: m.purlin.opening === 'up' ? 'down' : 'up' }; }
        } else m.mirror = o.mirror;
      }
      if (o.placement) {
        if (o.placement.basis !== placementBasis(m.start, m.end)) {
          issues.push({
            code: 'STALE_OVERRIDE', severity: 'warning', elementId: m.id,
            message: `${m.label}: המיקום הידני נקבע לפני שינוי פרמטרי — ההתאמה הידנית אינה תקפה עוד ויש לבדוק אותה`,
          });
        }
        m.start = o.placement.start; m.end = o.placement.end;
        m.startCut = undefined; m.endCut = undefined; m.manualPlacement = true;
      }
    }
    out.push(m);
  }
  for (const mm of project.manualMembers) {
    out.push({
      id: mm.id, kind: mm.kind, label: `אלמנט ידני ${mm.id}`, start: mm.start, end: mm.end,
      profile: mm.profile, material: mm.material, rollDeg: mm.rollDeg, mirror: mm.mirror,
      anchor: mm.anchor, refUp: mm.refUp, source: 'manual', manualPlacement: true,
    });
  }
  for (const m of out) {
    if (!getProfileSafe(m.profile)) {
      issues.push({ code: 'PROFILE', severity: 'error', elementId: m.id, message: `${m.label}: חתך לא מוכר ${m.profile}` });
    }
  }
  let byId = new Map(out.map((m) => [m.id, m]));
  supports = supports.filter((sp) => byId.has(sp.purlinId) && byId.has(sp.rafterId));
  // חיבורים: משנים חיתוכי קצה של עמודים/קורות לפי עובי פלטות, ומוסיפים זוויתנים, פלטות וברגים
  let connections: Connection[] = [];
  let roofSegments: DerivedModel["roofSegments"];
  let projEff: Project = project;
  // שגיאה מקומית (פטה, חיבור בודד) אינה חוסמת את שאר המודל — רק שגיאות מבנה/טופולוגיה או חתך לא מוכר בעמוד/קורה
  const fatal = structuralError || issues.some((i) => i.severity === 'error' && i.code === 'PROFILE' && /\.(COL|RAF)\b/.test(i.elementId ?? ''));
  if (!fatal && topo) {
    // חיבורי המשך: שנקבעו + אוטומטיים לאלמנטים ארוכים מחומר הגלם
    // מסבכי גג: חיבורי המשך בקורת הגג (חגורה עליונה) באמצע שדה — לפני החלוקה האוטומטית
    const rtSpl = roofTrussRafterSplices(project, out);
    const eff = effectiveSplices(Object.keys(rtSpl).length ? { ...project, splices: { ...rtSpl, ...project.splices } } : project, out, supports);
    projEff = { ...project, splices: eff.splices };
    const cr = buildConnections(projEff, out, byId, supports.filter((sp) => getProfileSafe(byId.get(sp.purlinId)!.profile)), topo);
    const hidden = new Set(project.deleted);
    out.push(...cr.members.filter((m) => !hidden.has(m.id)));
    connections = cr.connections;
    issues.push(...cr.issues);
    {
      const hn = buildHaunches(projEff, out, byId, topo, connections);
      out.push(...hn.members.filter((m) => !hidden.has(m.id)));
      connections.push(...hn.connections);
      issues.push(...hn.issues);
    }
    const bs = buildBeamSplices(projEff, out, eff.splices, eff.auto);
    out.push(...bs.members.filter((m) => !hidden.has(m.id)));
    connections.push(...bs.connections);
    issues.push(...bs.issues);
    if (eff.auto.size) issues.push({ code: 'AUTO_SPLICE', severity: 'info', message: `חיבורי המשך אוטומטיים ב-${eff.auto.size} אלמנטים ארוכים מחומר הגלם (${(project.settings.stockLength / 1000).toFixed(1)} מ') — לשינוי: בחר אלמנט ← "חיבורי המשך"` });
    const bb = buildBracing(b, topo, out.filter((m) => m.purlin), bEff, project.settings.stockLength, (id) => byId.get(id)?.profile, (id) => { const c = byId.get(id); return c && /מקוצר/.test(c.label) ? Math.max(c.start.z, c.end.z) : undefined; });
    roofSegments = bb.segments;
    out.push(...bb.members.filter((m) => !hidden.has(m.id)));
    // חלוקה אוטומטית גם לשורות הקשירה הארוכות
    const effT = effectiveSplices(projEff, bb.members, []);
    if (effT.auto.size) projEff = { ...projEff, splices: effT.splices };
    connections.push(...bb.connections);
    issues.push(...bb.issues);
    // מסגור קירות לחיפוי: פטות קיר, עמודי רוח ועמודי פתחים
    if (sec && b.cladding) {
      const wf = buildWallFraming(project, bEff, sec, out);
      for (const m of wf.members) { const o = project.memberOverrides[m.id]; if (o?.profile) m.profile = o.profile; if (o?.material) m.material = o.material; if (o?.rollDeg !== undefined) m.rollDeg = o.rollDeg; if (o?.mirror !== undefined) m.mirror = o.mirror; }
      out.push(...wf.members.filter((m) => !hidden.has(m.id)));
      issues.push(...wf.issues);
    }
    // תומכי מזחלה: 2×L50/50/5 בכל קצה קורה בקצה נמוך חופשי (מרותכים לקורה במסגריה)
    if (sec && b.cladding?.gutter.enabled && b.cladding.roof.enabled) {
      const gb = buildGutterBrackets(bEff, sec, out);
      out.push(...gb.members.filter((m) => !hidden.has(m.id)));
      connections.push(...gb.connections);
      issues.push(...gb.issues);
    }
    // מסבכי גג: חגורה תחתונה, אנכיים ואלכסונים (מרותכים), חיבורי המשך וחגורה–עמוד (מוברגים)
    if (b.roofTruss?.enabled) {
      const rtr = buildRoofTrusses(projEff, out, projEff.splices);
      out.push(...rtr.members.filter((m) => !hidden.has(m.id)));
      connections.push(...rtr.connections);
      issues.push(...rtr.issues);
    }
    // קורות נושאות, חיבורי תמיכה ומושבים; הסרת אלמנטים שנשענו על עמודים מוסרים/מקוצרים
    if (tbPlans.length) {
      const tr = buildTransfers(project, tbPlans, out);
      out.push(...tr.members);
      connections.push(...tr.connections);
      issues.push(...tr.issues);
      // קורה נושאת ארוכה מחומר הגלם: חיבורי המשך מוברגים (פלטות קצה), מחוץ לאזורי המושבים
      {
        const stock = project.settings.stockLength, allow = Math.max(10, project.settings.kerf * 3);
        const tbSpl: Record<string, number[]> = {};
        for (const def of b.transfers ?? []) {
          const tb = tr.members.find((m) => m.id === `TB.${def.id}`);
          if (!tb || def.splice === 'none' || def.kind === 'truss') continue;
          const L = Math.hypot(tb.end.x - tb.start.x, tb.end.y - tb.start.y, tb.end.z - tb.start.z);
          if (L <= stock - allow) continue;
          const seats = tr.connections.filter((c) => c.type === 'tb-seat' && c.members[0] === tb.id).map((c) => { const p0 = tr.members.find((m) => c.parts.includes(m.id) && m.kind === 'plate'); return p0 ? Math.abs((p0.start.y + p0.end.y) / 2 - tb.start.y) : null; }).filter((t): t is number => t !== null);
          // חלוקה לחלקים שווים; תפר שנופל ליד מושב מוזז ממנו (450 מ"מ); אם חלק חורג מהמוט — חלק נוסף
          let ts: number[] = [];
          for (let n = Math.ceil(L / (stock - allow)); n < 12; n++) {
            ts = [];
            for (let k = 1; k < n; k++) {
              const t0 = (L * k) / n, prev = ts.length ? ts[ts.length - 1] : 0;
              // שני כיווני הזזה מהמושב — עדיפות לזה שמשאיר את החלק הקודם בתוך אורך המוט
              const clear = (t: number) => { for (let it = 0; it < 10; it++) { const hit = seats.find((sy) => Math.abs(sy - t) < 450); if (hit === undefined) return t; t = hit + (t >= hit ? 450 : -450); } return t; };
              const hitA = seats.find((sy) => Math.abs(sy - t0) < 450);
              const cands = hitA === undefined ? [t0] : [clear(hitA - 450), clear(hitA + 450)];
              const ok = cands.filter((t) => t - prev <= stock - allow).sort((a2, b2) => Math.abs(a2 - t0) - Math.abs(b2 - t0));
              ts.push(Math.round(ok[0] ?? cands.sort((a2, b2) => a2 - b2)[0]));
            }
            const cuts = [0, ...ts, L];
            if (cuts.every((c, i) => !i || c - cuts[i - 1] <= stock - allow)) break;
          }
          if (ts.some((t, i) => (i ? t - ts[i - 1] : t) > stock - allow) || L - ts[ts.length - 1] > stock - allow) issues.push({ code: 'TB_SPLICE', severity: 'warning', elementId: tb.id, message: `קורה נושאת ${def.id}: חלק ארוך מחומר הגלם אחרי הזזת חיבור ההמשך מהמושבים — לבדיקה` });
          tbSpl[tb.id] = ts;
          issues.push({ code: 'TB_SPLICE', severity: 'info', elementId: tb.id, message: `קורה נושאת ${def.id} (${(L / 1000).toFixed(2)} מ') ארוכה מחומר הגלם — חולקה ל-${ts.length + 1} חלקים עם חיבורי המשך מוברגים ב-${ts.map((t) => (t / 1000).toFixed(2)).join(', ')} מ' מהקצה` });
        }
        // מסבך נושא: חיבורי המשך באמצע שדות, בשתי החגורות
        Object.assign(tbSpl, tr.trussSplices);
        if (Object.keys(tbSpl).length) {
          projEff = { ...projEff, splices: { ...projEff.splices, ...tbSpl } };
          const bs2 = buildBeamSplices(projEff, out.filter((m) => m.id in tbSpl), tbSpl, new Set(Object.keys(tbSpl)), new Set(Object.keys(tbSpl).filter((k) => !k.endsWith('.BC'))));
          out.push(...bs2.members); connections.push(...bs2.connections); issues.push(...bs2.issues);
        }
      }
      if (tr.drop.size || tr.shortCols.size) {
        // חיבורים שתלויים בעמוד שהתקצר (ראש עמוד, קורה לצד עמוד, אלכסון) — הקורות יושבות עכשיו על הקורה הנושאת
        const dropConn = connections.filter((c) => c.members.some((mid) => tr.drop.has(mid)) || ((c.type === 'eave' || c.type === 'rafter-side') && c.members.some((mid) => tr.shortCols.has(mid))));
        const dc = new Set(dropConn.map((c) => c.id));
        const keepIss = issues.filter((i) => !(i.elementId && dc.has(i.elementId))); issues.length = 0; issues.push(...keepIss);
        const dropIds = new Set([...tr.drop, ...dropConn.flatMap((c) => c.parts.flatMap((pid) => [pid, `${pid}.H`, `${pid}.S`, `${pid}.N`, `${pid}.W`]))]);
        const keep = out.filter((m) => !dropIds.has(m.id)); out.length = 0; out.push(...keep);
        connections = connections.filter((c) => !dropConn.includes(c));
        if (tr.drop.size) issues.push({ code: 'TB_DROP', severity: 'info', message: `דילול עמודים: הוסרו ${tr.drop.size} אלמנטים (אלכסונים/קושרות) שנשענו על עמודים שבוטלו או קוצרו` });
      }
    }
    // אלמנט משני שנמחק (אלכסון עמוד-קורה, קושרת, אגד, נעילה...): נבנה יחד עם הפחים/הברגים שלו —
    // החיבור שנשאר רק עם אלמנטים ראשיים (עמוד/קורה/פטה/קורה נושאת) הוא "יתום" ונמחק עם חלקיו
    if (project.deleted.length) {
      const hid = new Set(project.deleted);
      const live = new Map(out.map((m) => [m.id, m]));
      const isMain = (id: string) => { const m = live.get(id)!; return m.kind === 'column' || m.kind === 'rafter' || !!m.purlin || /^TB\./.test(id); };
      // אלמנט "בעלים" = אלמנט במסגרת החיבור שאינו חלק שנוצר בו (פלטה/בורג מזהים מתחילים במזהה החיבור)
      const own = (c: Connection) => [...new Set([...c.members, ...c.parts])].filter((id) => !id.startsWith(`${c.id}.`));
      const orphan = connections.filter((c) => { const o = own(c); return o.some((id) => hid.has(id)) && (c.type === 'brace-cross' || o.filter((id) => !hid.has(id) && live.has(id)).every(isMain)); });
      if (orphan.length) {
        const oc = new Set(orphan);
        const dropIds = new Set(orphan.flatMap((c) => c.parts.flatMap((pid) => [pid, `${pid}.H`, `${pid}.S`, `${pid}.N`, `${pid}.W`])));
        const keep = out.filter((m) => !dropIds.has(m.id)); out.length = 0; out.push(...keep);
        connections = connections.filter((c) => !oc.has(c));
        const ids = new Set(orphan.map((c) => c.id));
        const keepIss = issues.filter((i) => !(i.elementId && ids.has(i.elementId))); issues.length = 0; issues.push(...keepIss);
      }
    }
    // פרטי חיבור מותאמים מהספרייה: מחליפים את החיבור שנבנה בקצה האלמנט
    if ((project.detailAssign && Object.keys(project.detailAssign).length) || connections.some((c) => c.recipe)) issues.push(...applyCustomDetails(project, out, connections));
    byId = new Map(out.map((m) => [m.id, m]));
    issues.push(...checkClashes(connections, byId));
  }
  const valid = out.filter((m) => m.kind !== 'bolt' && getProfileSafe(m.profile));
  const pp = buildParts(valid, projEff, new Map(connections.map((c) => [c.id, c])));
  issues.push(...pp.issues);
  // הודעות שהמשתמש הסתיר (אזהרות ומידע בלבד — שגיאה לעולם אינה מוסתרת)
  const dis = new Set(project.dismissedIssues ?? []);
  const hiddenIssues = dis.size ? issues.filter((i) => i.severity !== 'error' && (dis.has(`${i.code}|*`) || dis.has(issueKey(i)))) : [];
  if (hiddenIssues.length) { const h = new Set(hiddenIssues); const keep = issues.filter((i) => !h.has(i)); issues.length = 0; issues.push(...keep); }
  return { members: out, nodes, grid, roof, issues, byId, supports, parts: pp.parts, splices: pp.splices, hiddenIssues, connections, connById: new Map(connections.map((c) => [c.id, c])), section: sec ?? undefined, roofSegments };
}

function getProfileSafe(n: string) { try { return getProfile(n); } catch { return null; } }

/** מישור פני תחתון של קורת גג בין שתי נקודות על קו הייחוס, במרחק off בניצב כלפי מטה. */
function underPlane(a: Vec3, b: Vec3, off: number): Plane {
  const ex = norm(sub(b, a));
  // נורמל כלפי מעלה במישור האנכי של הקורה
  let n = sub(Z, { x: ex.x * ex.z, y: ex.y * ex.z, z: ex.z * ex.z });
  n = norm(n);
  return { point: add(a, { x: -n.x * off, y: -n.y * off, z: -n.z * off }), normal: n };
}
