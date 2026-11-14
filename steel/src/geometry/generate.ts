import { add, norm, sub, v3, type Plane, type Vec3 } from '../core/vec';
import { getProfile } from '../profiles/library';
import type {
  DerivedModel, GridLine, Member, ModelNode, Project, RoofInfo, ValidationIssue,
} from '../model/types';
import { derivedRoof, hasErrors, validateBuilding } from '../model/validate';
import { buildParts } from './parts';
import { buildPurlins } from './purlins';
import type { Connection, SupportPoint } from '../model/types';
import { buildConnections, checkClashes } from './connections';
import { buildBracing } from './bracing';

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
export function generate(project: Project): DerivedModel {
  const b = project.building;
  const issues: ValidationIssue[] = validateBuilding(b);
  const members: Member[] = [];
  const nodes: ModelNode[] = [];
  const grid: GridLine[] = [];
  const roof: RoofInfo = hasErrors(issues) ? { slopeLeft: 0, slopeRight: 0 } : derivedRoof(b);

  // קצה קורת הגג: לפחות עד קצה פלטת הכיפה (או הפנים החיצוניות של העמוד), גם כשהקונזולה 0
  let bEff = b;
  if (!hasErrors(issues)) {
    const eave = project.connectionDefaults.eave;
    const minExt = eave.enabled ? eave.l / 2 : getProfile(b.columnProfile).props.h / 2;
    const exL = Math.max(b.rafterOverhangLeft, minExt), exR = Math.max(b.rafterOverhangRight, minExt);
    if (exL > b.rafterOverhangLeft || exR > b.rafterOverhangRight) {
      issues.push({ code: 'RAFTER_EXT', severity: 'info', message: `קורות הגג מוארכות ${minExt} מ"מ מציר העמוד, עד קצה ${eave.enabled ? 'פלטת הכיפה' : 'העמוד'} — הפטה האחרונה בקצה זה` });
    }
    // קצה הפטה: לפחות חצי רוחב זוויתן מעבר למסגרת הקיצונית, כדי ששני הברגים יעברו בפטה
    const pu = b.purlins;
    const cw = Math.max(pu.left.cleat.enabled ? pu.left.cleat.width / 2 : 0, b.roofType === 'gable' && pu.right.cleat.enabled ? pu.right.cleat.width / 2 : 0);
    const pS = Math.max(b.purlinOverhangStart, cw), pE = Math.max(b.purlinOverhangEnd, cw);
    if (pS > b.purlinOverhangStart || pE > b.purlinOverhangEnd) {
      issues.push({ code: 'PURLIN_EXT', severity: 'info', message: `הפטות מוארכות ${cw} מ"מ מעבר למסגרות הקיצוניות, עד קצה הזוויתן` });
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

    grid.push({ id: 'GX0', label: xAxisLabel(0), dir: 'X', pos: 0 });
    grid.push({ id: 'GX1', label: xAxisLabel(1), dir: 'X', pos: b.width });

    b.frames.forEach((f, fi) => {
      const y = f.y;
      grid.push({ id: `GY-${f.id}`, label: String(fi + 1), dir: 'Y', pos: y });
      const base = b.baseElevation;
      const eL = v3(0, y, b.eaveLeft), eR = v3(b.width, y, b.eaveRight);
      nodes.push({ id: `${f.id}.N.BL`, p: v3(0, y, base), frameId: f.id, role: 'בסיס שמאל' });
      nodes.push({ id: `${f.id}.N.BR`, p: v3(b.width, y, base), frameId: f.id, role: 'בסיס ימין' });
      nodes.push({ id: `${f.id}.N.EL`, p: eL, frameId: f.id, role: 'ראש עמוד שמאל' });
      nodes.push({ id: `${f.id}.N.ER`, p: eR, frameId: f.id, role: 'ראש עמוד ימין' });

      const rafters: { id: string; side?: 'L' | 'R'; s: Vec3; e: Vec3; startCut: Plane; endCut: Plane }[] = [];
      let underL: Plane, underR: Plane;
      if (b.roofType === 'gable') {
        const rz = roof.ridgeZ!;
        const ridge = v3(b.ridgeX, y, rz);
        nodes.push({ id: `${f.id}.N.RG`, p: ridge, frameId: f.id, role: 'רכס' });
        const sL = roof.slopeLeft, sR = roof.slopeRight;
        const aL = v3(-b.rafterOverhangLeft, y, b.eaveLeft - sL * b.rafterOverhangLeft);
        const aR = v3(b.width + b.rafterOverhangRight, y, b.eaveRight - sR * b.rafterOverhangRight);
        const ridgePlane: Plane = { point: ridge, normal: X };
        rafters.push({ id: `${f.id}.RAF.L`, side: 'L', s: aL, e: ridge, startCut: { point: aL, normal: X }, endCut: ridgePlane });
        rafters.push({ id: `${f.id}.RAF.R`, side: 'R', s: aR, e: ridge, startCut: { point: aR, normal: X }, endCut: ridgePlane });
        underL = underPlane(aL, ridge, underOffset);
        underR = underPlane(aR, ridge, underOffset);
      } else {
        const s = roof.slopeLeft;
        const aL = v3(-b.rafterOverhangLeft, y, b.eaveLeft - s * b.rafterOverhangLeft);
        const aR = v3(b.width + b.rafterOverhangRight, y, b.eaveRight + s * b.rafterOverhangRight);
        rafters.push({ id: `${f.id}.RAF`, s: aL, e: aR, startCut: { point: aL, normal: X }, endCut: { point: aR, normal: X } });
        underL = underR = underPlane(aL, aR, underOffset);
      }
      for (const r of rafters) {
        members.push({
          id: r.id, kind: 'rafter', frameId: f.id, side: r.side,
          label: `קורת גג ${r.side === 'L' ? 'שמאל' : r.side === 'R' ? 'ימין' : ''} מסגרת ${fi + 1}`.replace('  ', ' '),
          start: r.s, end: r.e, profile: b.rafterProfile, material: b.material, rollDeg: 0, mirror: false,
          anchor, refUp: Z, startCut: r.startCut, endCut: r.endCut, source: 'generated', manualPlacement: false,
        });
      }
      for (const [side, x, top, under] of [['L', 0, eL, underL], ['R', b.width, eR, underR]] as const) {
        members.push({
          id: `${f.id}.COL.${side}`, kind: 'column', frameId: f.id, side,
          label: `עמוד ${side === 'L' ? 'שמאל' : 'ימין'} מסגרת ${fi + 1}`,
          start: v3(x, y, base), end: top, profile: b.columnProfile, material: b.material,
          rollDeg: 0, mirror: false, anchor: 'center', refUp: X,
          endCut: under, source: 'generated', manualPlacement: false,
        });
      }
    });
  }

  // פטות ונקודות תמיכה
  const deleted = new Set(project.deleted);
  let supports: SupportPoint[] = [];
  if (!hasErrors(issues)) {
    const pr = buildPurlins(bEff, roof, deleted);
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
  if (!hasErrors(issues)) {
    const cr = buildConnections(project, out, byId, supports.filter((sp) => getProfileSafe(byId.get(sp.purlinId)!.profile)));
    const hidden = new Set(project.deleted);
    out.push(...cr.members.filter((m) => !hidden.has(m.id)));
    connections = cr.connections;
    issues.push(...cr.issues);
    const bb = buildBracing(b, roof, out.filter((m) => m.purlin), bEff);
    out.push(...bb.members.filter((m) => !hidden.has(m.id)));
    connections.push(...bb.connections);
    issues.push(...bb.issues);
    byId = new Map(out.map((m) => [m.id, m]));
    issues.push(...checkClashes(connections, byId));
  }
  const valid = out.filter((m) => m.kind !== 'bolt' && getProfileSafe(m.profile));
  const pp = buildParts(valid, project);
  issues.push(...pp.issues);
  return { members: out, nodes, grid, roof, issues, byId, supports, parts: pp.parts, splices: pp.splices, connections, connById: new Map(connections.map((c) => [c.id, c])) };
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
