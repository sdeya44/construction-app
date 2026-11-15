import { add, norm, scale, sub, v3, type Vec3 } from '../core/vec';
import { getProfile, tryProfile } from '../profiles/library';
import type { BoltInfo, BuildingParams, Connection, Member, RoofInfo, ValidationIssue } from '../model/types';
import { makeBolt } from './connections';
import { localFrame } from './frame';
import { bolt } from '../model/defaults';

export interface BracingResult { members: Member[]; connections: Connection[]; issues: ValidationIssue[] }

/** מפתחים: אינדקסים שליליים נספרים מהסוף (‎-1 = המפתח האחרון). */
export function resolveBays(bays: number[], count: number): number[] {
  const out = new Set<number>();
  for (const b of bays) { const i = b < 0 ? count + b : b; if (i >= 0 && i < count) out.add(i); }
  return [...out].sort((a, b) => a - b);
}

const Yn = v3(0, 1, 0);
/** cut=true: חיתוך הקצוות במקביל לפני הווב/האגף (מישור Y קבוע), כדי שפינת הקושרת האלכסונית לא תחדור לאלמנט */
const mk = (id: string, label: string, profile: string, start: Vec3, end: Vec3, refUp: Vec3, material: string, anchor: Member['anchor'] = 'center', cut = false): Member => ({
  id, kind: 'brace', label, start, end, profile, material, rollDeg: 0, mirror: false, anchor, refUp,
  source: 'generated', manualPlacement: false, partDesc: `${label} ${profile}`,
  ...(cut ? { startCut: { point: start, normal: Yn }, endCut: { point: end, normal: Yn } } : {}),
});

/**
 * קושרות X בגג ובקירות ושורות קשירה לפטות. קושרות X עובדות במתיחה בלבד (לפי תוכנית K-02);
 * פחי החיבור והחיבור בהצטלבות מסומנים "דורש תכנון" — אין גיאומטריית חיבור בשלב זה.
 */
export function buildBracing(b: BuildingParams, roof: RoofInfo, purlins: Member[], eff: BuildingParams): BracingResult {
  const res: BracingResult = { members: [], connections: [], issues: [] };
  const br = b.bracing;
  const frames = b.frames;
  const nb = frames.length - 1;
  const mat = b.material;
  const raf = getProfile(b.rafterProfile), col = getProfile(b.columnProfile);
  const tw = raf.dims.tw ?? raf.dims.t ?? 6;
  const conn = (id: string, label: string, parts: string[]) => res.connections.push({
    id, type: 'brace', label, members: [], parts, bolts: [], welds: [], status: 'not-verified', fixity: 'pinned', overridden: false,
  });
  for (const [key, prof] of [['roof', br.roof.profile], ['walls', br.walls.profile], ['ties', br.purlinTies.profile]] as const) {
    if (!tryProfile(prof)) res.issues.push({ code: 'PROFILE', severity: 'error', message: `חתך קושרת לא מוכר (${key}): ${prof}` });
  }
  if (res.issues.length) return res;

  // ---- קושרות גג: במישור ציר קורת הגג, בין פני הווב של שתי מסגרות סמוכות
  if (br.roof.enabled) {
    const slopes: { side: string; a: { x: number; z: number }; c: { x: number; z: number } }[] = [];
    const tosZ = (x: number) => (b.roofType === 'gable'
      ? (x <= b.ridgeX ? b.eaveLeft + roof.slopeLeft * x : roof.ridgeZ! - roof.slopeRight * (x - b.ridgeX))
      : b.eaveLeft + roof.slopeLeft * x);
    if (b.roofType === 'gable') {
      slopes.push({ side: 'L', a: { x: 0, z: tosZ(0) }, c: { x: b.ridgeX - 150, z: tosZ(b.ridgeX - 150) } });
      slopes.push({ side: 'R', a: { x: b.width, z: tosZ(b.width) }, c: { x: b.ridgeX + 150, z: tosZ(b.ridgeX + 150) } });
    } else slopes.push({ side: 'M', a: { x: 0, z: tosZ(0) }, c: { x: b.width, z: tosZ(b.width) } });
    for (const bay of resolveBays(br.roof.bays, nb)) {
      const y0 = frames[bay].y + tw / 2, y1 = frames[bay + 1].y - tw / 2;
      const ids: string[] = [];
      for (const sl of slopes) {
        const dir = norm(v3(sl.c.x - sl.a.x, 0, sl.c.z - sl.a.z));
        const n = norm(v3(-dir.z * Math.sign(dir.x), 0, Math.abs(dir.x)));
        const ax = (x: number, z: number, y: number, off: number) => add(v3(x, y, z), scale(n, -raf.props.h / 2 + off));
        const id1 = `BR.R${bay + 1}.${sl.side}.1`, id2 = `BR.R${bay + 1}.${sl.side}.2`;
        // שתי האלכסונים מוסטים בניצב למישור הגג כדי לא לחדור זה בזה בהצטלבות
        res.members.push(mk(id1, `קושרת גג מפתח ${bay + 1}`, br.roof.profile, ax(sl.a.x, sl.a.z, y0, 30), ax(sl.c.x, sl.c.z, y1, 30), n, mat, 'center', true));
        res.members.push(mk(id2, `קושרת גג מפתח ${bay + 1}`, br.roof.profile, ax(sl.a.x, sl.a.z, y1, -30), ax(sl.c.x, sl.c.z, y0, -30), n, mat, 'center', true));
        ids.push(id1, id2);
      }
      conn(`C.BR.ROOF.${bay + 1}`, `קושרות גג מפתח ${bay + 1} — פחי חיבור והצטלבות: דורש תכנון`, ids);
    }
  }

  // ---- קושרות קיר: במישור ציר העמודים, בין שפות האגפים של שני עמודים סמוכים
  if (br.walls.enabled) {
    const rafV = raf.props.h * Math.sqrt(1 + roof.slopeLeft * roof.slopeLeft);
    for (const [side, x, eave, bays] of [['L', 0, b.eaveLeft, br.walls.left], ['R', b.width, b.eaveRight, br.walls.right]] as const) {
      for (const bay of resolveBays(bays, nb)) {
        const y0 = frames[bay].y + col.props.b / 2, y1 = frames[bay + 1].y - col.props.b / 2;
        const z0 = b.baseElevation + 300, z1 = eave - rafV - 60 - 150;
        if (z1 - z0 < 1000) { res.issues.push({ code: 'BRACE_SHORT', severity: 'warning', message: `קושרת קיר ${side} מפתח ${bay + 1}: גובה קטן מדי` }); continue; }
        const X = v3(1, 0, 0);
        const id1 = `BR.W${bay + 1}.${side}.1`, id2 = `BR.W${bay + 1}.${side}.2`;
        res.members.push(mk(id1, `קושרת קיר ${side === 'L' ? 'ציר א' : 'ציר ב'} מפתח ${bay + 1}`, br.walls.profile, v3(x + 30, y0, z0), v3(x + 30, y1, z1), X, mat, 'center', true));
        res.members.push(mk(id2, `קושרת קיר ${side === 'L' ? 'ציר א' : 'ציר ב'} מפתח ${bay + 1}`, br.walls.profile, v3(x - 30, y1, z0), v3(x - 30, y0, z1), X, mat, 'center', true));
        conn(`C.BR.WALL.${side}.${bay + 1}`, `קושרות קיר ${side === 'L' ? 'ציר א' : 'ציר ב'} מפתח ${bay + 1} — פחי חיבור והצטלבות: דורש תכנון`, [id1, id2]);
      }
    }
  }

  // ---- שורת קשירה לאגף התחתון של הפטות, באמצע כל מפתח, לכל שיפוע
  if (br.purlinTies.enabled) {
    for (const side of ['L', 'R', 'M'] as const) {
      const ps = purlins.filter((m) => m.purlin?.side === side).sort((a, c) => a.purlin!.index - c.purlin!.index);
      if (ps.length < 2) continue;
      const first = ps[0], last = ps[ps.length - 1];
      const dir = norm(sub(v3(last.start.x, 0, last.start.z), v3(first.start.x, 0, first.start.z)));
      const n = first.purlin!.roofNormal;
      const a0 = sub(v3(first.start.x, 0, first.start.z), scale(dir, 60));
      const a1 = add(v3(last.start.x, 0, last.start.z), scale(dir, 60));
      const tieProf = getProfile(br.purlinTies.profile);
      const tieT = tieProf.dims.t ?? 4;
      for (let bay = 0; bay < nb; bay++) {
        const ym = (frames[bay].y + frames[bay + 1].y) / 2;
        const id = `BR.T${bay + 1}.${side}`;
        // זוויתן מסובב 180°: הרגל האופקית למעלה, צמודה מתחת לאגף התחתון של הפטות (מגע 0 מ"מ)
        const tie = mk(id, `שורת קשירה לפטות מפתח ${bay + 1}`, br.purlinTies.profile, v3(a0.x, ym, a0.z), v3(a1.x, ym, a1.z), n, mat, 'purlin');
        tie.rollDeg = 180;
        res.members.push(tie);
        const cid = `C.BR.TIE.${side}.${bay + 1}`;
        // בורג M12 בכל הצטלבות: דרך הרגל האופקית ואמצע האגף התחתון של הפטה (בשטח)
        const bolts: BoltInfo[] = [];
        for (const pm of ps) {
          const pp = getProfile(pm.profile);
          const lf = localFrame(pm);
          const flangeDir = pp.family === 'Z' ? scale(lf.u, -1) : lf.u;
          if (pp.family !== 'C' && pp.family !== 'Z') continue;
          const at = add(v3(pm.start.x, ym, pm.start.z), scale(flangeDir, pp.props.b / 2));
          const head = sub(at, scale(n, tieT));
          bolts.push(makeBolt(`${cid}.B${pm.purlin!.index}`, cid, head, n, bolt(12), tieT + pp.dims.t, 'site', [id, pm.id], flangeDir, res.members));
        }
        res.connections.push({ id: cid, type: 'brace', label: `שורת קשירה מפתח ${bay + 1} — מוברגת לאגף התחתון של כל פטה`, members: ps.map((m) => m.id), parts: [id, ...bolts.map((b2) => b2.id)], bolts, welds: [], status: 'not-verified', fixity: 'pinned', overridden: false });
      }
    }
  }
  void eff;
  return res;
}
