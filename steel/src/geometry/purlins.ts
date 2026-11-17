import { cross, dot, norm, v3, type Vec3 } from '../core/vec';
import { tryProfile } from '../profiles/library';
import type { CleatParams, BuildingParams, Member, PurlinSideParams, PurlinSystem, SupportPoint, ValidationIssue } from '../model/types';
import type { NSection } from '../model/section';

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
export function layoutPositions(Ls: number, cosA: number, p: PurlinSideParams, label: string, towardEnd = 0, towardStart = 0): Layout {
  const issues: ValidationIssue[] = [];
  const W = (code: string, message: string, severity: 'error' | 'warning' | 'info' = 'warning') => issues.push({ code, severity, message });
  // עבודה ביחידת המדידה שנבחרה (שיפוע או אופקי), המרה בסוף לשיפוע
  const k = p.measure === 'horizontal' ? cosA : 1;
  const L = Ls * k;
  // הפטה האחרונה יושבת כולה על קורת הגג: edgeOffset נמדד מקצה הקורה עד הפנים החיצוניות של הפטה/התומך,
  // ולכן ציר הווב מוזז פנימה ברוחב החלק שפונה לקצה (החלטת משתמש 15.11.2026)
  const end = L - p.edgeOffset - towardEnd * k;
  let s: number[];
  if (p.manualPositions) {
    s = [...p.manualPositions].sort((a, b) => a - b).map((x) => x * k);
    if (s.some((x) => x < -TOL || x > L + TOL)) W('PURLIN_RANGE', `${label}: מיקום ידני מחוץ לקורת הגג`, 'error');
    else if (s.length && s[s.length - 1] + towardEnd * k > L + TOL) W('PURLIN_OVERHANG', `${label}: הפטה האחרונה בולטת מעבר לקצה קורת הגג — אינה יושבת כולה על הפרופיל`);
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] < TOL) W('PURLIN_DUP', `${label}: שתי פטות באותו מיקום`, 'error');
  } else {
    if (!(p.spacing > 0)) { W('PURLIN_SPACING', `${label}: מרווח פטות חייב להיות חיובי`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    if (p.first < 0) { W('PURLIN_FIRST', `${label}: מרחק ראשון שלילי`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    if (p.edgeOffset < 0 || end <= 0) { W('PURLIN_EDGE', `${label}: מיקום פטה אחרונה לא תקין`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    if (p.first > end + TOL) { W('PURLIN_FIRST', `${label}: המרחק הראשון גדול מאורך השיפוע`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    // בקצה חופשי (גג חד־שיפועי) גם הפטה הראשונה יושבת כולה על הקורה
    const first = p.first + towardStart * k;
    if (first > end + TOL) { W('PURLIN_FIRST', `${label}: המרחק הראשון גדול מאורך השיפוע`, 'error'); return { s: [], h: [], lastSpan: 0, issues }; }
    if (p.layout === 'even') {
      // חלוקה שווה: מספר המפתחים המזערי שבו המרווח אינו עולה על spacing
      const span = end - first;
      const nsp = Math.max(1, Math.ceil((span - TOL) / p.spacing));
      s = span > TOL ? Array.from({ length: nsp + 1 }, (_, i) => first + (span * i) / nsp) : [first];
    } else {
      s = [first];
      while (s[s.length - 1] + p.spacing < end - TOL) s.push(s[s.length - 1] + p.spacing);
      if (end - s[s.length - 1] > TOL) s.push(end);
      else s[s.length - 1] = Math.max(s[s.length - 1], end); // מקרה גבולי: הפטה האחרונה נופלת בדיוק על הקצה
      const last = s.length > 1 ? s[s.length - 1] - s[s.length - 2] : 0;
      if (s.length > 1 && last < 0.25 * p.spacing) {
        issues.push({ code: 'PURLIN_REMAINDER', severity: 'warning', message: `${label}: מרווח אחרון ${(last / 1000 / k).toFixed(3)} מ' קטן מרבע מהמרווח הרגיל — מוצע: חלוקה שווה`, fix: { label: 'חלוקה שווה', purlinKey: '', patch: { layout: 'even' } } });
      }
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
  /** מזהה מישור הגג (קלאסי: L / R / M) */
  side: string;
  params: PurlinSideParams;
  paramKey: string;
  /** קצה ההתחלה חופשי (לא רכס) */
  free: boolean;
  /** נקודת ההתחלה ונקודת הקצה של קו פני העליון של הקורה (x,z) */
  S: { x: number; z: number };
  E: { x: number; z: number };
  /** כיוון "מעלה השיפוע" (לכיוון הצד הגבוה; בשיפוע 0 — לכיוון ההתחלה) */
  up: Vec3;
  rafterId: (frameId: string) => string;
  label: string;
}

export interface PurlinResult { members: Member[]; supports: SupportPoint[]; issues: ValidationIssue[] }

/** בליטת התושבת מהווב לצד הרחוק מהפטה, לפי סוג התושבת (זוויתן שוכב: רגל הבסיס; עומד: הרגל הניצבת; פלטה: עובי + משולש) */
export function cleatReach(c: CleatParams): number {
  if (c.style === 'stand') { const p = tryProfile(c.standProfile ?? 'L40x40x4'); return p?.dims.h ?? 40; }
  if (c.style === 'plate') return c.thickness + Math.max(40, c.base);
  return c.base;
}

/** פרמטרי פטות לפי מפתח: left / right / מזהה מישור (חתך מודולרי) */
export function purlinParams(pu: PurlinSystem, key: string): PurlinSideParams {
  return key === 'left' ? pu.left : key === 'right' ? pu.right : pu.planes?.[key] ?? pu.left;
}

/** בניית קווי פטות, נקודות תמיכה וולידציות. גיאומטריה טהורה ודטרמיניסטית. */
export function buildPurlins(b: BuildingParams, sec: NSection, deleted: Set<string>): PurlinResult {
  const out: PurlinResult = { members: [], supports: [], issues: [] };
  const pu = b.purlins;
  const lines: SlopeLine[] = sec.planes.map((pl) => {
    const S = pl.startAt === 'b' ? pl.b : pl.a, E = pl.startAt === 'b' ? pl.a : pl.b;
    const hi = S.z >= E.z ? S : E, lo = hi === S ? E : S;
    const up = Math.abs(S.z - E.z) < 1e-6 ? norm(v3(S.x - E.x, 0, 0)) : norm(v3(hi.x - lo.x, 0, hi.z - lo.z));
    const label = sec.custom ? `פטות ${pl.label}` : pl.id === 'L' ? 'פטות שמאל' : pl.id === 'R' ? 'פטות ימין' : 'פטות';
    // קצה חופשי של קורת הגג נחתך 90° דרך הפינה החיצונית (generate): בקצה הנמוך הפנים העליונות בולטות מעבר לקצה המישור.
    // הפטה הקיצונית נמדדת מהקצה האמיתי של הפנים העליונות — אחרת נשאר רווח שגדל עם השיפוע (12.5% ≈ 25 מ"מ ב-C120)
    const raf = tryProfile(b.rafterProfile);
    const colH = tryProfile(b.columnProfile)?.props.h ?? 200;
    const L0 = Math.hypot(E.x - S.x, E.z - S.z);
    const dir = { x: (E.x - S.x) / L0, z: (E.z - S.z) / L0 };
    const hv = raf ? raf.props.h * Math.sqrt(1 + (dir.z / (dir.x || 1e-9)) ** 2) : 0;
    const joined = (P: { x: number; z: number }) =>
      sec.planes.some((q) => q !== pl && [q.a, q.b].some((Q) => Math.abs(Q.x - P.x) < 1 && Math.abs(Q.z - P.z) < 1))
      || sec.lines.some((l) => Math.abs(l.x - P.x) <= colH / 2 + 1);
    const topExt = (P: { x: number; z: number }, out: { x: number; z: number }) => (joined(P) ? 0 : Math.max(0, -(b.heightRef === 'TOS' ? hv : hv / 2) * out.z));
    const eE = topExt(E, dir), eS = pl.startFree ? topExt(S, { x: -dir.x, z: -dir.z }) : 0;
    let E2 = eE > 0.01 ? { x: E.x + dir.x * eE, z: E.z + dir.z * eE } : E;
    let S2 = eS > 0.01 ? { x: S.x - dir.x * eS, z: S.z - dir.z * eS } : S;
    // קצה המישור בצד עמוד שממשיך למעלה (גג מדורג / שן מסור): הפטות נמדדות מפני העמוד + 10 מ"מ, לא מציר העמוד
    const zOn = (q: typeof pl, x: number) => q.a.z + ((q.b.z - q.a.z) * (x - q.a.x)) / ((q.b.x - q.a.x) || 1e-9);
    const atColSide = (P: { x: number; z: number }) => sec.lines.some((l) => Math.abs(l.x - P.x) < 1)
      && sec.planes.some((q) => q !== pl && P.x >= Math.min(q.a.x, q.b.x) - 1 && P.x <= Math.max(q.a.x, q.b.x) + 1 && zOn(q, P.x) > P.z + 50);
    // הפטה נטויה עם הגג: גובה החתך מוסיף בליטה אופקית h·sinα מול פני העמוד האנכיים
    const ph = tryProfile(purlinParams(pu, pl.params).profile)?.props.h ?? 200;
    const back = (colH / 2 + 10 + ph * Math.abs(dir.z)) / Math.max(0.2, Math.abs(dir.x));
    // עמק (מרזב) מעל עמוד: שני המישורים יורדים אל העמוד — הפטה הנמוכה מתרחקת מראש העמוד
    const isValley = (P: { x: number; z: number }) => sec.lines.some((l) => Math.abs(l.x - P.x) <= colH / 2 + 1)
      && sec.planes.some((q) => q !== pl && [q.a, q.b].some((Q) => Math.abs(Q.x - P.x) < 1 && Math.abs(Q.z - P.z) < 1) && Math.max(q.a.z, q.b.z) > P.z + 1)
      && Math.max(pl.a.z, pl.b.z) > P.z + 1;
    // רכס מעל עמוד (סככת T): גם שם ראש העמוד מתחת לשני המישורים — מרחק מפני העמוד
    const isColRidge = (P: { x: number; z: number }) => sec.lines.some((l) => Math.abs(l.x - P.x) <= colH / 2 + 1)
      && sec.planes.some((q) => q !== pl && [q.a, q.b].some((Q) => Math.abs(Q.x - P.x) < 1 && Math.abs(Q.z - P.z) < 1) && Math.min(q.a.z, q.b.z) < P.z - 1)
      && Math.min(pl.a.z, pl.b.z) < P.z - 1;
    if (atColSide(E) || isValley(E) || isColRidge(E)) E2 = { x: E2.x - dir.x * back, z: E2.z - dir.z * back };
    if (atColSide(S) || isValley(S) || isColRidge(S)) S2 = { x: S2.x + dir.x * back, z: S2.z + dir.z * back };
    return { side: pl.id, params: purlinParams(pu, pl.params), paramKey: pl.params, free: pl.startFree, S: S2, E: E2, up, rafterId: pl.rafterId, label };
  });
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
    // נורמל מישור הגג כלפי מעלה (ניצב לקו השיפוע, במישור XZ)
    const n = norm(v3(-ln.up.z * Math.sign(ln.up.x || 1), 0, Math.abs(ln.up.x)));
    // היקף החתך (ותומך) לכיוון קצה הקו — כדי שהפטה האחרונה תשב על הקורה
    const n0 = n;
    const u0 = cross(n0, ex);
    const sDir = norm(v3(ln.S.x - ln.E.x, 0, ln.S.z - ln.E.z)); // לכיוון ההתחלה
    const mirror0 = (dot(u0, ln.up) > 0) !== (prm.opening === 'up');
    const wc0 = webCenterU(prm.profile);
    const us0 = prof.outline.outer.map((q) => (mirror0 ? -(q.u - wc0) : q.u - wc0));
    // ln.up מצביע מהקצה לכיוון ההתחלה (רכס/צד גבוה); הקצה בכיוון -up
    let towardEnd = dot(u0, sDir) > 0 ? -Math.min(...us0) : Math.max(...us0);
    const cleatToStart0 = prm.cleat.enabled && (prof.family === 'Z' ? prm.opening === 'up' : prm.opening === 'down') === (dot(ln.up, sDir) > 0);
    if (prm.cleat.enabled && !cleatToStart0) {
      const wb0 = prof.family === 'C' || prof.family === 'Z' ? prof.dims.t / 2 : prof.props.b / 2;
      towardEnd = Math.max(towardEnd, wb0 + cleatReach(prm.cleat));
    }
    let towardStart0 = 0;
    if (ln.free) {
      towardStart0 = dot(u0, sDir) > 0 ? Math.max(...us0) : -Math.min(...us0);
      if (cleatToStart0) towardStart0 = Math.max(towardStart0, (prof.family === 'C' || prof.family === 'Z' ? prof.dims.t / 2 : prof.props.b / 2) + cleatReach(prm.cleat));
    }
    // רכס: מרחק ראשון מזערי כך שהפטה והתומך לא יחצו את קו הרכס — תיקון אוטומטי + הצעה לעדכון הערך
    let prmL = prm;
    if (!ln.free && !prm.manualPositions) {
      let ridgeExt = dot(u0, sDir) > 0 ? Math.max(...us0) : -Math.min(...us0);
      if (cleatToStart0) ridgeExt = Math.max(ridgeExt, (prof.family === 'C' || prof.family === 'Z' ? prof.dims.t / 2 : prof.props.b / 2) + cleatReach(prm.cleat));
      const kk = prm.measure === 'horizontal' ? cosA : 1;
      const minFirst = Math.ceil(((ridgeExt + 10) * kk) / 5) * 5;
      if (prm.first < minFirst - 1e-6 && !prm.firstExact) {
        prmL = { ...prm, first: minFirst };
        out.issues.push({ code: 'PURLIN_FIRST_AUTO', severity: 'warning', message: `${ln.label}: מרחק ראשון ${Math.round(prm.first)} מ"מ קטן מהמזערי — הפטה הוזזה אוטומטית ל-${minFirst} מ"מ מהרכס (רוחב הפטה והתומך)`, fix: { label: `קבע ${minFirst} מ"מ`, purlinKey: ln.paramKey, patch: { first: minFirst } } });
      }
    }
    const lay = layoutPositions(Ls, cosA, prmL, ln.label, Math.max(0, towardEnd), Math.max(0, towardStart0));
    for (const i of lay.issues) if (i.fix) i.fix = { ...i.fix, purlinKey: ln.paramKey };
    out.issues.push(...lay.issues);
    if (lay.issues.some((i) => i.severity === 'error')) continue;
    // u = v × ex (כמו ב-localFrame) — כיוון פתיחת חתך C כאשר mirror=false
    const u = cross(n, ex);
    const wantUp = prm.opening === 'up';
    const mirror = (dot(u, ln.up) > 0) !== wantUp;
    // היקף החתך לכיוון נקודת ההתחלה (לבדיקת חציית רכס)
    const wc = webCenterU(prm.profile);
    const us = prof.outline.outer.map((q) => (mirror ? -(q.u - wc) : q.u - wc));
    let towardStart = ln.free ? 0 : dot(u, sDir) > 0 ? Math.max(...us) : -Math.min(...us);
    // התומך (זוויתן) בצד הרחוק מהאגף התחתון: אם הוא פונה לרכס, גם רגל הבסיס שלו נבדקת מול קו הרכס
    const cleatToStart = prm.cleat.enabled && (prof.family === 'Z' ? prm.opening === 'up' : prm.opening === 'down') === (dot(ln.up, sDir) > 0);
    if (!ln.free && cleatToStart) {
      const wb = prof.family === 'C' || prof.family === 'Z' ? prof.dims.t / 2 : prof.props.b / 2;
      towardStart = Math.max(towardStart, wb + cleatReach(prm.cleat));
    }
    lay.s.forEach((s, i) => {
      const id = `PL.${ln.side}.${String(i + 1).padStart(2, '0')}`;
      if (deleted.has(id)) return;
      if (i === 0 && !ln.free && s - towardStart < 0) {
        out.issues.push({ code: 'PURLIN_RIDGE', severity: prm.firstExact ? 'warning' : 'error', elementId: id, message: `${ln.label}: הפטה הראשונה או התומך שלה חוצים את קו הרכס${prm.firstExact ? ' (מרחק ראשון מדויק לפי בחירתך — לבדוק מול הפטה בשיפוע השני)' : ' — הגדל את המרחק הראשון'}` });
      }
      const P = { x: ln.S.x + dir.x * s, z: ln.S.z + dir.z * s };
      out.members.push({
        id, kind: 'purlin',
        label: `${ln.label.replace('פטות', 'פטה')} ${i + 1}`,
        start: v3(P.x, y0, P.z), end: v3(P.x, y1, P.z),
        profile: prm.profile, material: pu.material, rollDeg: 0, mirror,
        anchor: 'purlin', refUp: n, source: 'generated', manualPlacement: false,
        purlin: {
          side: ln.side, startFree: ln.free, paramKey: ln.paramKey, index: i + 1, count: lay.s.length, sSlope: s, sHoriz: lay.h[i],
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
 * הצעת חיבורי המשך לקו באורך L (לאורך Y מתחילת הקו), כך שאף חלק אינו ארוך מחומר הגלם.
 * עדיפות: תפר מעל תומך. אם תומך נמצא ממש אחרי סוף המוט (עד 300 מ"מ) — התפר בסוף המוט, סמוך לתומך
 * (ניצול מלא של המוט; החלטת משתמש 15.11.2026). הצעה בלבד — המשתמש מאשר/משנה.
 */
export function proposeSplices(L: number, stock: number, supportsT: number[]): number[] {
  if (L <= stock + TOL) return [];
  const NEAR = 300;
  const out: number[] = [];
  // לא מציעים חיבור קרוב לקצה הקו (חלק קצר מ-500 מ"מ אינו מעשי)
  const ts = [...supportsT].filter((t) => t > 500 && t < L - 500).sort((a, b) => a - b);
  let s = 0;
  while (L - s > stock + TOL) {
    const end = s + stock;
    const cand = ts.filter((t) => t > s + TOL && t - s <= stock + TOL);
    const near = ts.some((t) => t > end + TOL && t <= end + NEAR);
    const best = cand.length ? cand[cand.length - 1] : null;
    // תומך במרחק NEAR אחרי סוף המוט — עדיף מוט מלא עם תפר ליד התומך על פני חלק קצר בהרבה
    const next = near || best === null || end - best > NEAR ? end : best;
    out.push(next);
    s = next;
  }
  return out;
}
