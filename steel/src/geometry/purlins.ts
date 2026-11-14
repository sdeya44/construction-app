import { cross, dot, norm, v3, type Vec3 } from '../core/vec';
import { tryProfile } from '../profiles/library';
import type { BuildingParams, Member, PurlinSideParams, RoofInfo, SupportPoint, ValidationIssue } from '../model/types';

const TOL = 1; // mm

export interface Layout {
  /** מרחקים מנקודת ההתחלה לאורך השיפוע */
  s: number[];
  /** מרחקים בהיטל אופקי */
  h: number[];
  lastSpan: number;
  issues: ValidationIssue[];
}

/**
 * פריסת פטות לאורך קו שיפוע באורך Ls (לאורך השיפוע), cosA = קוסינוס זווית השיפוע.
 * מתחילה בנקודת ההתחלה, פטה ראשונה במרחק first, מרווחים רגילים, פטה אחרונה בקצה (פחות edgeOffset).
 * השארית נשארת במפתח האחרון בלבד — אינה מפוזרת על שאר המפתחים.
 */
export function layoutPositions(Ls: number, cosA: number, p: PurlinSideParams, label: string): Layout {
  const issues: ValidationIssue[] = [];
  const W = (code: string, message: string, severity: 'error' | 'warning' | 'info' = 'warning') => issues.push({ code, severity, message });
  // עבודה ביחידת המדידה שנבחרה (שיפוע או אופקי), המרה בסוף לשיפוע
  const k = p.measure === 'horizontal' ? cosA : 1;
  const L = Ls * k;
  const end = L - p.edgeOffset;
  let s: number[];
  if (p.manualPositions) {
    s = [...p.manualPositions].sort((a, b) => a - b).map((x) => x * k);
    if (s.some((x) => x < -TOL || x > L + TOL)) W('PURLIN_RANGE', `${label}: מיקום ידני מחוץ לקורת הגג`, 'error');
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] < TOL) W('PURLIN_DUP', `${label}: שתי פטות באותו מיקום`, 'error');
  } else {
    if (!(p.spacing > 0)) { W('PURLIN_SPACING', `${label}: מרווח פטות חייב להיות חיובי`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    if (p.first < 0) { W('PURLIN_FIRST', `${label}: מרחק ראשון שלילי`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    if (p.edgeOffset < 0 || end <= 0) { W('PURLIN_EDGE', `${label}: מיקום פטה אחרונה לא תקין`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    if (p.first > end + TOL) { W('PURLIN_FIRST', `${label}: המרחק הראשון גדול מאורך השיפוע`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    s = [p.first];
    while (s[s.length - 1] + p.spacing < end - TOL) s.push(s[s.length - 1] + p.spacing);
    if (end - s[s.length - 1] > TOL) s.push(end);
    else s[s.length - 1] = Math.max(s[s.length - 1], end); // מקרה גבולי: הפטה האחרונה נופלת בדיוק על הקצה
    const last = s.length > 1 ? s[s.length - 1] - s[s.length - 2] : 0;
    if (s.length > 1 && last < 0.25 * p.spacing) {
      W('PURLIN_REMAINDER', `${label}: מרווח אחרון ${(last / 1000 / k).toFixed(3)} מ' קטן מרבע מהמרווח הרגיל — צפיפות חריגה, שקול התאמה ידנית`);
    }
    if (p.spacing > 2500) W('PURLIN_SPACING_LARGE', `${label}: מרווח פטות מעל 2.5 מ' — לבדוק`);
  }
  const sSlope = s.map((x) => x / k);
  return {
    s: sSlope,
    h: sSlope.map((x) => x * cosA),
    lastSpan: sSlope.length > 1 ? sSlope[sSlope.length - 1] - sSlope[sSlope.length - 2] : 0,
    issues,
  };
}

/** מיקום ציר הווב של חתך הפטה במערכת החתך (u). C: מרכז הווב; Z/RHS/אחר: 0. */
export function webCenterU(profile: string): number {
  const p = tryProfile(profile);
  if (!p) return 0;
  if (p.family === 'C' || p.family === 'UPN' || p.family === 'UPE') {
    const umin = Math.min(...p.outline.outer.map((q) => q.u));
    const t = p.family === 'C' ? p.dims.t : p.dims.tw;
    return umin + t / 2;
  }
  return 0;
}

interface SlopeLine {
  side: 'L' | 'R' | 'M';
  params: PurlinSideParams;
  /** נקודת ההתחלה ונקודת הקצה של קו פני העליון של הקורה (x,z) */
  S: { x: number; z: number };
  E: { x: number; z: number };
  /** כיוון "מעלה השיפוע" (לכיוון הרכס / הצד הגבוה) */
  up: Vec3;
  rafterId: (frameId: string) => string;
  label: string;
}

export interface PurlinResult { members: Member[]; supports: SupportPoint[]; issues: ValidationIssue[] }

/** בניית קווי פטות, נקודות תמיכה וולידציות. גיאומטריה טהורה ודטרמיניסטית. */
export function buildPurlins(b: BuildingParams, roof: RoofInfo, deleted: Set<string>): PurlinResult {
  const out: PurlinResult = { members: [], supports: [], issues: [] };
  const pu = b.purlins;
  const lines: SlopeLine[] = [];
  if (b.roofType === 'gable') {
    const R = { x: b.ridgeX, z: roof.ridgeZ! };
    const A = { x: -b.rafterOverhangLeft, z: b.eaveLeft - roof.slopeLeft * b.rafterOverhangLeft };
    const B = { x: b.width + b.rafterOverhangRight, z: b.eaveRight - roof.slopeRight * b.rafterOverhangRight };
    lines.push({ side: 'L', params: pu.left, S: R, E: A, up: norm(v3(1, 0, roof.slopeLeft)), rafterId: (f) => `${f}.RAF.L`, label: 'פטות שמאל' });
    lines.push({ side: 'R', params: pu.right, S: R, E: B, up: norm(v3(-1, 0, roof.slopeRight)), rafterId: (f) => `${f}.RAF.R`, label: 'פטות ימין' });
  } else {
    const s = roof.slopeLeft;
    const A = { x: -b.rafterOverhangLeft, z: b.eaveLeft - s * b.rafterOverhangLeft };
    const B = { x: b.width + b.rafterOverhangRight, z: b.eaveRight + s * b.rafterOverhangRight };
    const lowIsA = A.z <= B.z;
    const low = lowIsA ? A : B, high = lowIsA ? B : A;
    const [S, E] = pu.monoStart === 'low' ? [low, high] : [high, low];
    const up = norm(v3(high.x - low.x, 0, high.z - low.z));
    lines.push({ side: 'M', params: pu.left, S, E, up, rafterId: (f) => `${f}.RAF`, label: 'פטות' });
  }
  const ys = b.frames.map((f) => f.y);
  const y0 = Math.min(...ys) - b.purlinOverhangStart, y1 = Math.max(...ys) + b.purlinOverhangEnd;
  const ex = v3(0, 1, 0);

  for (const ln of lines) {
    const prm = ln.params;
    if (!prm.enabled) continue;
    const prof = tryProfile(prm.profile);
    if (!prof) { out.issues.push({ code: 'PROFILE', severity: 'error', message: `${ln.label}: חתך לא מוכר ${prm.profile}` }); continue; }
    const dx = ln.E.x - ln.S.x, dz = ln.E.z - ln.S.z;
    const Ls = Math.hypot(dx, dz);
    const dir = { x: dx / Ls, z: dz / Ls };
    const cosA = Math.abs(dir.x);
    const lay = layoutPositions(Ls, cosA, prm, ln.label);
    out.issues.push(...lay.issues);
    if (lay.issues.some((i) => i.severity === 'error')) continue;
    // נורמל מישור הגג כלפי מעלה (ניצב לקו השיפוע, במישור XZ)
    const n = norm(v3(-ln.up.z * Math.sign(ln.up.x || 1), 0, Math.abs(ln.up.x)));
    // u = v × ex (כמו ב-localFrame) — כיוון פתיחת חתך C כאשר mirror=false
    const u = cross(n, ex);
    const wantUp = prm.opening === 'up';
    const mirror = (dot(u, ln.up) > 0) !== wantUp;
    // היקף החתך לכיוון נקודת ההתחלה (לבדיקת חציית רכס)
    const wc = webCenterU(prm.profile);
    const us = prof.outline.outer.map((q) => (mirror ? -(q.u - wc) : q.u - wc));
    let towardStart = ln.side === 'M' ? 0 : dot(u, ln.up) > 0 ? Math.max(...us) : -Math.min(...us);
    // התומך (זוויתן) בצד הרחוק מהאגף התחתון: אם הוא פונה לרכס, גם רגל הבסיס שלו נבדקת מול קו הרכס
    const cleatToStart = prm.cleat.enabled && (prof.family === 'Z' ? prm.opening === 'up' : prm.opening === 'down');
    if (ln.side !== 'M' && cleatToStart) {
      const wb = prof.family === 'C' || prof.family === 'Z' ? prof.dims.t / 2 : prof.props.b / 2;
      towardStart = Math.max(towardStart, wb + prm.cleat.base);
    }
    lay.s.forEach((s, i) => {
      const id = `PL.${ln.side}.${String(i + 1).padStart(2, '0')}`;
      if (deleted.has(id)) return;
      if (i === 0 && ln.side !== 'M' && s - towardStart < 0) {
        out.issues.push({ code: 'PURLIN_RIDGE', severity: 'error', elementId: id, message: `${ln.label}: הפטה הראשונה או התומך שלה חוצים את קו הרכס — הגדל את המרחק הראשון` });
      }
      const P = { x: ln.S.x + dir.x * s, z: ln.S.z + dir.z * s };
      out.members.push({
        id, kind: 'purlin',
        label: `${ln.label.replace('פטות', 'פטה')} ${i + 1}`,
        start: v3(P.x, y0, P.z), end: v3(P.x, y1, P.z),
        profile: prm.profile, material: pu.material, rollDeg: 0, mirror,
        anchor: 'purlin', refUp: n, source: 'generated', manualPlacement: false,
        purlin: {
          side: ln.side, index: i + 1, count: lay.s.length, sSlope: s, sHoriz: lay.h[i],
          spanBefore: i ? s - lay.s[i - 1] : 0, isLast: i === lay.s.length - 1,
          roofNormal: n, opening: prm.opening, measure: prm.measure,
        },
      });
      for (const f of b.frames) {
        const rid = ln.rafterId(f.id);
        if (deleted.has(rid)) continue;
        out.supports.push({ id: `SP.${id}.${f.id}`, purlinId: id, frameId: f.id, rafterId: rid, p: v3(P.x, f.y, P.z) });
      }
    });
  }
  return out;
}

/**
 * הצעת חיבורי המשך לקו באורך L (לאורך Y מתחילת הקו), מעל נקודות תמיכה, כך שאף חלק אינו ארוך מחומר הגלם.
 * הצעה בלבד — המשתמש מאשר/משנה. אינה כופה חיבור בכל מסגרת.
 */
export function proposeSplices(L: number, stock: number, supportsT: number[]): number[] {
  if (L <= stock + TOL) return [];
  const out: number[] = [];
  // לא מציעים חיבור קרוב לקצה הקו (חלק קצר מ-500 מ"מ אינו מעשי)
  const ts = [...supportsT].filter((t) => t > 500 && t < L - 500).sort((a, b) => a - b);
  let s = 0;
  while (L - s > stock + TOL) {
    const cand = ts.filter((t) => t > s + TOL && t - s <= stock + TOL);
    const next = cand.length ? cand[cand.length - 1] : s + stock;
    out.push(next);
    s = next;
  }
  return out;
}
