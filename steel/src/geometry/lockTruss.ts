import { add, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import { KNEE_FIN_LTCHORD_RECIPE_ID, KNEE_FIN_LTTRUSS_RECIPE_ID, LOCK_PLATE_RECIPE_ID } from './convRecipes';
import type { BoltInfo, Connection, LockTrussParams, Member, ValidationIssue, WeldInfo } from '../model/types';
import { getProfile, tryProfile, type Profile } from '../profiles/library';
import { makeBolt } from './connections';
import { finJoint, slotsOf } from './finJoint';
import type { PortalLine } from './portal';

/** ברירת מחדל לפי תוכנית 130: סיב וחגורה RHS80/80/4, אלכסונים RHS80/80/4, גובה 1000, פלטות 10 (130×250), 4×M16 */
export function defaultLockTruss(): LockTrussParams {
  return { chord: 'RHS80x80x4', diag: 'RHS80x80x4', height: 1000, position: 'above', conn: 'plate', plateT: 10,
    bolt: { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 }, weldSize: 4, gap: 100, diags: 0, continuous: true };
}

interface Out { members: Member[]; connections: Connection[]; issues: ValidationIssue[] }
const X = v3(1, 0, 0), Z = v3(0, 0, 1);

/** מידות פלטת הקצה (תוכנית 130: 130×250×10 ל-RHS80) */
function endPlateDims(prof: Profile, lt: LockTrussParams) {
  const d0 = lt.bolt.d + lt.bolt.clearance;
  const e = Math.max(40, Math.ceil((1.5 * d0) / 5) * 5);
  const W = Math.max(130, Math.ceil((prof.props.b + 50) / 10) * 10);
  const H = Math.ceil((prof.props.h + 2 * (e + Math.max(45, d0 * 1.6))) / 10) * 10;
  return { e, W, H, g: W - 2 * e, pv: H - 2 * e };
}

/**
 * נעילה אופקית לאורך ציר עמודים (תוכנית 130): סיב רציף בכל מפתח (continuous), ובמפתחים הנעולים מסבך:
 * חגורה שנייה (מעל/מתחת) + אלכסונים בתבנית W, מרותכים לשתי החגורות במסגריה (מכלול אחד). כל קצה חגורה מחובר לעמוד.
 */
export function buildLockTrussLine(out: Out, lt: LockTrussParams, L: PortalLine) {
  const cpf = tryProfile(lt.chord), dpf = tryProfile(lt.diag);
  if (!cpf || !dpf) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `נעילה אופקית: חתך לא מוכר ${!cpf ? lt.chord : lt.diag}` }); return; }
  if (!L.portalBays.length) return;
  const col = getProfile(L.colProfile);
  const hollow = ['RHS', 'SHS', 'CHS'].includes(col.family);
  const tw = hollow ? col.props.b : col.dims.tw ?? col.dims.t ?? 8;
  const inner = hollow ? col.props.h : col.props.h - 2 * (col.dims.tf ?? 10) - 2 * (col.dims.r ?? 0);
  const ch = cpf.props.h;
  const H = Math.max(300, lt.height);
  const zTopC = L.zTop - lt.gap - ch / 2; // ציר האלמנט העליון
  const zCont = lt.position === 'above' ? zTopC - H : zTopC;
  const zSec = lt.position === 'above' ? zTopC : zTopC - H;
  const x = L.x;
  const nb = L.frames.length - 1;
  const locked = new Set(L.portalBays);
  if (Math.min(zCont, zSec) - ch / 2 < L.zBase + 800) { out.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `נעילה אופקית ציר ${L.label}: גובה לא מספיק למסבך בגובה ${H}` }); return; }
  // מתכון מובנה (שלב D): לשונית שוכבת בשני הצדדים, עמוד/סיב RHS/SHS, בורג 8.8 ISO 4017 עם חור d+2. הציר נשמר ללא ההסטה — המתכון מחיל אותה (כמו קורת אגד)
  const bothTongue = (lt.connA ?? lt.conn) === 'tongue' && (lt.connB ?? lt.conn) === 'tongue';
  const colI = ['IPE', 'HEA', 'HEB', 'HEM', 'INP', 'UPN', 'UPE', 'C'].includes(col.family); // `th`: הפרט על פני הווב האמיתיים
  const recipeOn = lt.engine === 'recipe' && bothTongue && (lt.finOrient ?? 'horizontal') === 'horizontal' && (['RHS', 'SHS'].includes(col.family) || colI) && ['RHS', 'SHS'].includes(cpf.family)
    && lt.bolt.grade === '8.8' && lt.bolt.standard === 'ISO 4017' && lt.bolt.clearance === 2;
  // מתכון פלטת קצה (אתר של 3 אלמנטים: עמוד + סיב משני צדיו — אתר זוגי): עמוד RHS/SHS, בורג 8.8 ISO 4017 עם חור d+2
  const plateRecipeOn = lt.engine === 'recipe' && (['RHS', 'SHS'].includes(col.family) || colI) && lt.bolt.grade === '8.8' && lt.bolt.standard === 'ISO 4017' && lt.bolt.clearance === 2;
  if (!recipeOn && !plateRecipeOn && ['UPN', 'UPE', 'C'].includes(col.family)) out.issues.push({ code: 'COL_U_LEGACY', severity: 'warning', message: `מסבך נעילה ציר ${L.label}: עמוד ${col.name} (U/C) בקוד הישן — הקצה ממוקם לפי ציר העמוד ויתנגש באגף. הפעל "בנה ממתכון" (בורג 8.8 ISO 4017, פער 2)` });
  const bays = lt.continuous ? Array.from({ length: nb }, (_, i) => i) : [...locked];
  const joints = new Map<string, { colId: string; z: number; yC: number; ends: { chordId: string; plateId: string; sg: number; yF: number; lab: string }[] }>();
  for (const bay of bays) {
    const f0 = L.frames[bay], f1 = L.frames[bay + 1];
    const ya = Math.min(f0.y, f1.y) + tw / 2, yb = Math.max(f0.y, f1.y) - tw / 2;
    const c0 = `${f0.id}.COL.${L.side}`, c1 = `${f1.id}.COL.${L.side}`;
    const colA = f0.y < f1.y ? c0 : c1, colB = f0.y < f1.y ? c1 : c0;
    const key = `${bay + 1}.${L.side}`;
    const isLocked = locked.has(bay);
    const lab = isLocked ? `נעילה אופקית ציר ${L.label} מפתח ${bay + 1}` : `סיב רציף ציר ${L.label} מפתח ${bay + 1}`;
    const chords: { id: string; z: number }[] = [{ id: `LT.${key}.C`, z: zCont }];
    if (isLocked) chords.push({ id: `LT.${key}.S`, z: zSec });
    const ends: { a: Vec3; b: Vec3 }[] = [];
    let endReach = 0;
    for (const c of chords) {
      const pts: Vec3[] = [];
      for (const [k, yF, sg, colId] of [['A', ya, 1, colA], ['B', yb, -1, colB]] as const) {
        const cid = `C.LT.${key}.${c.id.slice(-1)}${k}`;
        const P = v3(x, yF, c.z), n = v3(0, sg, 0);
        const connK = (k === 'A' ? lt.connA : lt.connB) ?? lt.conn;
        if (connK === 'plate') {
          // פלטת קצה מרותכת לסיב (מסגריה), צמודה לפני העמוד; ברגים עוברים דרך העמוד — נבנים לכל עמוד בהמשך
          const t = lt.plateT, pd = endPlateDims(cpf, lt);
          const pid = `${cid}.PE`, pc = add(P, scale(n, t / 2));
          out.members.push({ id: pid, kind: 'plate', label: `פלטת קצה לסיב PL${t}×${pd.W}×${pd.H}`, start: add(pc, scale(Z, -pd.H / 2)), end: add(pc, scale(Z, pd.H / 2)), profile: `PL${pd.W}x${t}`, material: L.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: n, source: 'generated', manualPlacement: false, connId: `C.LT.${L.side}.${colId}.${Math.round(c.z)}`, partDesc: `פלטת קצה לסיב PL${t}×${pd.W}×${pd.H}` });
          const jk = `${colId}|${Math.round(c.z)}`;
          const jt = joints.get(jk) ?? { colId, z: c.z, yC: colId === colA ? Math.min(f0.y, f1.y) : Math.max(f0.y, f1.y), ends: [] };
          jt.ends.push({ chordId: c.id, plateId: pid, sg, yF, lab });
          joints.set(jk, jt);
          if (pd.W > (hollow ? col.props.h + 40 : inner) + 0.5) out.issues.push({ code: 'PLATE_WIDE', severity: 'warning', elementId: cid, message: `${lab}: פלטה ברוחב ${pd.W} רחבה מפני העמוד (${Math.round(hollow ? col.props.h : inner)})` });
          pts.push(add(P, scale(n, t)));
          endReach = Math.max(endReach, t + (pd.H / 2 - ch / 2));
        } else {
          // לשונית שוכבת (ברירת מחדל): הפח מרותך לפני העמוד אופקית, החריץ בסיב אופקי; ציר הסיב נשאר בגובה התכנוני
          const horiz = (lt.finOrient ?? 'horizontal') === 'horizontal';
          const Pj = horiz ? v3(P.x, P.y, P.z - lt.plateT) : P;
          const j = finJoint({ cid, desc: c.id.endsWith('C') ? 'סיב נעילה' : 'חגורת מסבך', hostId: colId, memberId: c.id, P: Pj, n, d: n, pn: horiz ? Z : X, side: 1, prof: cpf, profile: lt.chord, finT: lt.plateT, tongueT: lt.plateT, bolt: lt.bolt, bolts: 2, weldSize: lt.weldSize, mat: L.mat });
          out.members.push(...j.members); out.issues.push(...j.issues);
          out.connections.push({ id: cid, type: 'knee', label: `${lab} — ${c.id.endsWith('C') ? 'סיב' : 'חגורה'} לעמוד (לשונית)`, members: [colId, c.id], parts: j.parts, bolts: j.bolts, welds: j.welds, ...slotsOf(j), status: 'not-verified', fixity: 'pinned', overridden: false,
            ...(recipeOn ? { recipe: { id: c.id.endsWith('C') ? KNEE_FIN_LTCHORD_RECIPE_ID : KNEE_FIN_LTTRUSS_RECIPE_ID, params: { d: lt.bolt.d, nb: 2, ft: lt.plateT, tt: lt.plateT, sd: 1, bs: 1, wa: lt.weldSize, ...(colI ? { th: 1 } : {}) }, sites: [`${c.id}|${k === 'A' ? 'start' : 'end'}`] } } : {}) });
          pts.push(recipeOn ? sub(j.start, scale(Z, lt.plateT)) : j.start); // מתכון: ציר ללא ההסטה (פח + לשונית)/2 = T
          endReach = Math.max(endReach, j.tongueL + 25);
        }
      }
      // בלשונית הסיב מוסט מציר העמודים — שתי החגורות באותו מישור (אותה הסטה)
      out.members.push({ id: c.id, kind: 'beam', label: c.id.endsWith('C') ? lab.replace('נעילה אופקית', 'סיב נעילה') : `${lab} — חגורה`, start: pts[0], end: pts[1], profile: lt.chord, material: L.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: Z, source: 'generated', manualPlacement: false, partDesc: `${c.id.endsWith('C') ? 'סיב נעילה' : 'חגורת מסבך'} ${lt.chord}` });
      ends.push({ a: pts[0], b: pts[1] });
    }
    if (!isLocked) continue;
    // אלכסונים בתבנית W בין פני החגורות; מרווח מהעמוד מעבר לפלטות/לשוניות; רווח 20 בין אלכסונים בצומת
    const xo = ends[0].a.x;
    const zLoF = Math.min(zCont, zSec) + ch / 2, zHiF = Math.max(zCont, zSec) - ch / 2;
    const hF = zHiF - zLoF;
    const ec = lt.endClear && lt.endClear > 0 ? Math.max(lt.endClear, endReach) : endReach + 15;
    const y0 = ya + ec, y1 = yb - ec;
    const span = y1 - y0;
    let nd = lt.diags > 0 ? lt.diags : Math.max(2, 2 * Math.round(span / (2 * hF / Math.tan((50 * Math.PI) / 180))));
    if (lt.diags <= 0 && nd % 2) nd++;
    const pnl = span / nd;
    const sinT = hF / Math.hypot(hF, pnl);
    if (sinT > 0.97 || sinT < 0.5) out.issues.push({ code: 'BRACE_ANGLE', severity: 'warning', message: `${lab}: זווית אלכסוני המסבך ${Math.round((Math.asin(sinT) * 180) / Math.PI)}° — לשנות מספר אלכסונים/גובה` });
    const loId = zCont < zSec ? chords[0].id : chords[1].id, hiId = zCont < zSec ? chords[1].id : chords[0].id;
    const cid = `C.LT.${key}.TR`;
    const parts: string[] = [], welds: WeldInfo[] = [];
    for (let i = 0; i < nd; i++) {
      const up = i % 2 === 0; // מתחיל מהחגורה העליונה ליד העמוד ויורד (כמו בתוכנית)
      const id = `LT.${key}.D${i + 1}`;
      // חתך אישי לאלכסון זה (מפאנל האלמנט): רוחב החתך קובע את הטביעה בחגורה ואת אורך הריתוך
      const ovD = L.ovOf?.(id), dpfD = (ovD && tryProfile(ovD)) || dpf, diagName = dpfD === dpf ? lt.diag : ovD!;
      const wdD = dpfD.props.b, sD = wdD / (2 * sinT) + (lt.nodeGap ?? 20) / 2;
      const yS = y0 + i * pnl + sD, yE = y0 + (i + 1) * pnl - sD;
      const zS = up ? zHiF : zLoF, zE = up ? zLoF : zHiF;
      const S = v3(xo, yS, zS), E = v3(xo, yE, zE);
      const dir = norm(sub(E, S));
      void dir;
      out.members.push({ id, kind: 'brace', label: `${lab} — אלכסון`, start: S, end: E, profile: diagName, material: L.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: X,
        startCut: { point: S, normal: v3(0, 0, up ? 1 : -1) }, endCut: { point: E, normal: v3(0, 0, up ? -1 : 1) },
        source: 'generated', manualPlacement: false, partDesc: `אלכסון מסבך ${diagName} (חיתוך מקביל לחגורות)` });
      parts.push(id);
      const lenF = wdD / sinT;
      welds.push({ id: `${id}.W1`, connId: cid, type: 'fillet', a: lt.weldSize, length: Math.round(2 * (wdD + lenF)), location: 'shop', between: [up ? hiId : loId, id], from: S, to: add(S, v3(0, 1, 0)) });
      welds.push({ id: `${id}.W2`, connId: cid, type: 'fillet', a: lt.weldSize, length: Math.round(2 * (wdD + lenF)), location: 'shop', between: [up ? loId : hiId, id], from: E, to: add(E, v3(0, 1, 0)) });
    }
    out.connections.push({ id: cid, type: 'truss', label: `${lab} — מסבך ${nd} אלכסונים מרותכים (מסגריה)`, members: [loId, hiId], parts, bolts: [], welds, status: 'not-verified', fixity: 'pinned', overridden: false });
  }
  // ברגים דרך העמוד (תוכנית 130, "2* 130/250/10"): פלטות הקצה של שני המפתחים משני צדי העמוד, 4 ברגים ארוכים;
  // בעמוד קצה — פלטה אחת והאום בפני העמוד השני. העמוד קדוח (חורים בשתי הדפנות / בווב).
  const t = lt.plateT, pd = endPlateDims(cpf, lt);
  for (const jt of joints.values()) {
    const cid = `C.LT.${L.side}.${jt.colId}.${Math.round(jt.z)}`;
    const yLo = jt.yC - tw / 2, yHi = jt.yC + tw / 2;
    const lo = jt.ends.find((e) => e.sg < 0), hi = jt.ends.find((e) => e.sg > 0);
    // יחידה אחת: הראש בצד פלטה (או בפני העמוד), האום בצד השני
    const yHead = lo ? yLo - t : yLo, yNut = hi ? yHi + t : yHi;
    const xo = x;
    const bolts: BoltInfo[] = [];
    const holesIn = [jt.colId, ...jt.ends.map((e) => e.plateId)];
    let i = 0;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const head = v3(xo + (su * pd.g) / 2, yHead, jt.z + (sv * pd.pv) / 2);
      bolts.push(makeBolt(`${cid}.B${++i}`, cid, head, v3(0, 1, 0), lt.bolt, yNut - yHead, 'site', holesIn, Z, out.members));
    }
    const welds: WeldInfo[] = jt.ends.map((e) => ({ id: `${cid}.W.${e.plateId.split('.').slice(-2, -1)[0]}`, connId: cid, type: 'fillet' as const, a: lt.weldSize, length: 2 * (cpf.props.b + cpf.props.h), location: 'shop' as const, between: [e.chordId, e.plateId] as [string, string], from: v3(xo, e.yF, jt.z), to: v3(xo, e.yF, jt.z + 1) }));
    out.connections.push({ id: cid, type: 'knee', label: `${jt.ends[0].lab} — ${jt.ends.length > 1 ? 'סיבים משני צדי העמוד' : 'סיב לעמוד'}: פלטות קצה ${pd.W}×${pd.H}×${t}, 4×M${lt.bolt.d} דרך העמוד`,
      members: [jt.colId, ...jt.ends.map((e) => e.chordId)], parts: [...jt.ends.map((e) => e.plateId), ...bolts.map((b) => b.id)], bolts, welds, status: 'not-verified', fixity: 'pinned', overridden: false,
      ...(plateRecipeOn ? (() => {
        const siteOf = (e: { chordId: string; sg: number }) => `${e.chordId}|${e.sg > 0 ? 'start' : 'end'}`; // A (sg +1) = ההתחלה, B (sg −1) = הסוף
        const siteParams = Object.fromEntries(jt.ends.map((e) => [siteOf(e), { bld: lo ? (e === lo ? 1 : 0) : 1, prt: lo && hi ? 1 : 0, hiS: e.sg > 0 ? 1 : 0 }]));
        return { recipe: { id: LOCK_PLATE_RECIPE_ID, own: true, params: { t, Hp: pd.H, Wp: pd.W, g: pd.g, pv: pd.pv, d: lt.bolt.d, cl: lt.bolt.clearance, a: lt.weldSize, wl: 2 * (cpf.props.b + cpf.props.h), ctw: tw, ...(colI ? { th: 1 } : {}) }, sites: jt.ends.map(siteOf), siteParams, ...(lo && hi ? { pairs: { [siteOf(lo)]: siteOf(hi) } } : {}) } };
      })() : {}) });
  }
}
