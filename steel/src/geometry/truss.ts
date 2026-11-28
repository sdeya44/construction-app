import { add, cross, dot, norm, scale, sub, v3, type Plane, type Vec3 } from '../core/vec';
import type { BoltInfo, Connection, Member, Project, RoofTrussParams, TrussCell, TrussSpec, ValidationIssue, WeldInfo } from '../model/types';
import { getProfile, tryProfile } from '../profiles/library';
import { makeBolt } from './connections';

/**
 * מסבכים: קורה נושאת מסבך ומסבכי גג.
 * עיקרון ייצור: כל הצמתים מרותכים במסגריה (אנכיים/אלכסונים לחגורות, ללא פח צומת), חיבורי המשך של החגורות ושל
 * החגורה התחתונה לעמוד — פלטות קצה מוברגות בשטח. צומת K עם מרווח (gap) בין האלכסונים והאנך; שדה X — אלכסון
 * רציף ושני חצאים מרותכים אליו. האלכסונים נחתכים במקביל לפני החגורות (מרווח ריתוך 1 מ"מ). גיאומטריה בלבד.
 */

const Z = v3(0, 0, 1);
/** מינימום לפרמטרי לחיות הצומת (מ"מ) — ערכי ברירת מחדל טכניים של התוכנה (לא תכן מאושר); ערך קטן מהם מוגבל אליהם */
export const CHEEK_MIN = { t: 4, h: 30 } as const;
/** המינימום בפועל: מה שהוגדר בלחיות (`minT`/`minH`, מספר ≥ 1 מ"מ) או ברירת המחדל; ערך לא חוקי (קובץ פגום) — ברירת המחדל */
export function cheekMins(nc?: { minT?: number; minH?: number }): { t: number; h: number } {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1;
  return { t: ok(nc?.minT) ? nc!.minT! : CHEEK_MIN.t, h: ok(nc?.minH) ? nc!.minH! : CHEEK_MIN.h };
}
const GAP = 12; // מרווח בין אלכסונים/אנך באותו צומת (≥ t1+t2)
const BOLT = { d: 16, grade: '8.8', standard: 'ISO 4017', clearance: 2 };

export const TRUSS_PATTERNS: { id: NonNullable<TrussSpec['pattern']>; label: string }[] = [
  { id: 'warren-v', label: 'Warren + אנכיים' }, { id: 'warren', label: 'Warren' }, { id: 'pratt', label: 'Pratt' }, { id: 'howe', label: 'Howe' },
];

/** תבנית שדות: cells (n) + verts (n+1) */
export function patternCells(pattern: NonNullable<TrussSpec['pattern']>, n: number): { cells: TrussCell[]; verts: boolean[] } {
  const cells: TrussCell[] = [], verts: boolean[] = [];
  const half = n / 2;
  for (let i = 0; i < n; i++) {
    const left = i < half;
    if (pattern === 'pratt') cells.push(left ? '\\' : '/');
    else if (pattern === 'howe') cells.push(left ? '/' : '\\');
    else { const k = left ? i : n - 1 - i; const c: TrussCell = k % 2 === 0 ? '/' : '\\'; cells.push(left ? c : c === '/' ? '\\' : '/'); }
  }
  for (let i = 0; i <= n; i++) verts.push(pattern === 'warren' ? i === 0 || i === n : true);
  return { cells, verts };
}

export function defaultTrussSpec(panels: number, depth: number, profiles?: Partial<TrussSpec['profiles']>): TrussSpec {
  const n = Math.max(2, Math.round(panels));
  return {
    panels: n, depth, ...patternCells('warren-v', n), pattern: 'warren-v', symmetric: true, splice: 'auto',
    profiles: { top: 'HEA160', bottom: 'HEA140', endDiag: 'SHS100x5', diag: 'SHS80x4', vert: 'SHS60x4', ...(profiles ?? {}) },
  };
}

/** התאמת מערכי השדות לאורך n (שינוי מספר שדות) */
export function resizeSpec(spec: TrussSpec, n: number): TrussSpec {
  const pat = spec.pattern && spec.pattern !== 'custom' ? spec.pattern : 'warren-v';
  const base = patternCells(pat, n);
  return { ...spec, panels: n, cells: base.cells, verts: base.verts, splice: Array.isArray(spec.splice) ? spec.splice.filter((i) => i < n) : spec.splice, panelLens: undefined, lockedLens: undefined };
}

/** שדות נעולים (נקבעו ידנית) — מערך באורך מספר השדות */
export function panelLocks(spec: TrussSpec): boolean[] {
  const n = Math.max(2, Math.round(spec.panels));
  const L = spec.lockedLens;
  return hasPanelLens(spec) && L && L.length === n ? L.map(Boolean) : Array(n).fill(false);
}

/**
 * שינוי אורך שדה (בקשת משתמש 18.11.2026): השדה (ובסימטריה — גם המראה שלו) ננעל באורך שהוזן;
 * שדות שנקבעו ידנית קודם נשארים; השדות החופשיים מתחלקים שווה ביתרה. אם לא נשאר שדה חופשי — שאר השדות משתחררים.
 */
export function setPanelLen(spec: TrussSpec, span: number, i: number, v: number): TrussSpec {
  const n = Math.max(2, Math.round(spec.panels)), MIN = 200;
  const sym = spec.symmetric ?? true;
  const edit = new Set([i, ...(sym ? [n - 1 - i] : [])]);
  const lens = trussPanelLens(spec, span);
  let locks = panelLocks(spec).map((l, j) => l && !edit.has(j));
  let free = lens.map((_, j) => j).filter((j) => !edit.has(j) && !locks[j]);
  if (!free.length) { locks = locks.map(() => false); free = lens.map((_, j) => j).filter((j) => !edit.has(j)); }
  const lockedSum = lens.reduce((a, L, j) => a + (locks[j] ? L : 0), 0);
  const maxV = (span - lockedSum - MIN * free.length) / edit.size;
  const val = Math.max(MIN, Math.min(v, maxV));
  const rest = span - lockedSum - val * edit.size;
  const each = free.length ? rest / free.length : 0;
  const out = lens.map((L, j) => (edit.has(j) ? val : locks[j] ? L : each));
  // עיגול למ"מ: השארית לשדה החופשי האחרון (הסכום = מפתח)
  const r = out.map((x) => Math.round(x));
  const diff = Math.round(span) - r.reduce((a, b) => a + b, 0);
  if (diff && free.length) r[free[free.length - 1]] += diff;
  return { ...spec, panelLens: r, lockedLens: lens.map((_, j) => edit.has(j) || locks[j]) };
}

/** שחרור שדה נעול (ובסימטריה — גם המראה): הוא והשדות החופשיים מתחלקים שווה ביתרה */
export function unlockPanel(spec: TrussSpec, span: number, i: number): TrussSpec {
  const n = Math.max(2, Math.round(spec.panels));
  const sym = spec.symmetric ?? true;
  const locks = panelLocks(spec).map((l, j) => l && j !== i && !(sym && j === n - 1 - i));
  if (!locks.some(Boolean)) return { ...spec, panelLens: undefined, lockedLens: undefined };
  const lens = trussPanelLens(spec, span);
  const free = lens.map((_, j) => j).filter((j) => !locks[j]);
  const rest = span - lens.reduce((a, L, j) => a + (locks[j] ? L : 0), 0);
  const r = lens.map((L, j) => Math.round(locks[j] ? L : rest / free.length));
  const diff = Math.round(span) - r.reduce((a, b) => a + b, 0);
  if (diff) r[free[free.length - 1]] += diff;
  return { ...spec, panelLens: r, lockedLens: locks };
}

/** האם יש חלוקת שדות לא אחידה תקפה */
export function hasPanelLens(spec: TrussSpec): boolean {
  const L = spec.panelLens;
  return !!L && L.length === Math.max(2, Math.round(spec.panels)) && L.every((x) => Number.isFinite(x) && x > 0);
}

/** שברי מיקום הצמתים (0..1) לאורך המסבך — לפי panelLens (יחסית) או שווים */
export function trussFractions(spec: TrussSpec): number[] {
  const n = Math.max(2, Math.round(spec.panels));
  if (!hasPanelLens(spec)) return Array.from({ length: n + 1 }, (_, i) => i / n);
  const L = spec.panelLens!, tot = L.reduce((a, b) => a + b, 0);
  let acc = 0;
  return [0, ...L.map((x, i) => (i === n - 1 ? 1 : (acc += x) / tot))];
}

/** מיקום הצמתים בין a ל-b */
export function trussNodes(spec: TrussSpec, a: number, b: number): number[] {
  return trussFractions(spec).map((f) => a + (b - a) * f);
}

/** אורכי השדות בפועל (מ"מ) למפתח span */
export function trussPanelLens(spec: TrussSpec, span: number): number[] {
  const fr = trussFractions(spec);
  return fr.slice(1).map((f, i) => (f - fr[i]) * span);
}

/** חלוקת שדות כך שכל מסגרת (מיקום יחסי 0..span) תיפול על צומת; מספר השדות בכל מפתח ∝ אורכו */
export function panelsOnFrames(spec: TrussSpec, span: number, frameOffsets: number[]): TrussSpec {
  const pts = [...new Set([0, ...frameOffsets.filter((x) => x > 1 && x < span - 1), span].map((x) => Math.round(x)))].sort((a, b) => a - b);
  const bays = pts.slice(1).map((x, i) => x - pts[i]);
  const n0 = Math.max(Math.round(spec.panels), bays.length);
  const k = bays.map((L) => Math.max(1, Math.round((n0 * L) / span)));
  const lens = bays.flatMap((L, i) => Array.from({ length: k[i] }, () => Math.round(L / k[i])));
  const n = Math.max(2, lens.length);
  const base = lens.length === n ? lens : [lens[0] / 2, lens[0] / 2];
  const rs = n === Math.round(spec.panels) ? spec : resizeSpec(spec, n);
  return { ...rs, panelLens: base, lockedLens: undefined };
}

// ------------------------------------------------------------------ בונה כללי במישור המסבך

export interface ChordDef {
  /** גובה ציר החגורה כפונקציה של s */
  z: (s: number) => number;
  /** גובה החתך (בניצב לציר) */
  h: number;
  /** מזהה האלמנט שמחזיק את החגורה ב-s (לריתוך ולשיוך לחלק) */
  memberAt: (s: number) => string;
}
export interface TrussPlaneIn {
  idBase: string; connId: string; label: string;
  /** נקודת ייחוס (s=0, z=0) וכיוון המפתח (אופקי) */
  origin: Vec3; e: Vec3;
  nodes: number[];
  top: ChordDef; bot: ChordDef;
  spec: TrussSpec;
  mat: string;
  /** חתך אישי לאלמנט (memberOverrides) — אנכים ואלכסונים: החתך והחיבורים (צמתים, לחיים, ריתוכים) נבנים לפיו */
  ovOf?: (id: string) => string | undefined;
}

const slopeAt = (c: ChordDef, s: number) => (c.z(s + 1) - c.z(s - 1)) / 2;

export function buildTrussPlane(t: TrussPlaneIn): { members: Member[]; connection: Connection; issues: ValidationIssue[] } {
  const P = (s: number, z: number): Vec3 => add(add(t.origin, scale(t.e, s)), v3(0, 0, z));
  const pn = norm(cross(t.e, Z)); // ניצב למישור המסבך
  const n = t.nodes.length - 1;
  const members: Member[] = [], welds: WeldInfo[] = [], issues: ValidationIssue[] = [];
  // פני החגורות: תחתית העליונה / ראש התחתונה, ונורמל לכיוון השדה
  const face = (c: ChordDef, top: boolean) => (s: number) => {
    const m = slopeAt(c, s), cos = 1 / Math.hypot(1, m);
    return c.z(s) + (top ? -1 : 1) * (c.h / 2) / cos;
  };
  const fTop = face(t.top, true), fBot = face(t.bot, false);
  const faceN = (c: ChordDef, top: boolean, s: number): Vec3 => {
    const m = slopeAt(c, s);
    const nn = norm(add(scale(t.e, -m), Z)); // כלפי מעלה, ניצב לציר
    return top ? scale(nn, -1) : nn;
  };
  const prof = (k: keyof TrussSpec['profiles']) => t.spec.profiles[k];
  type Web = { id: string; prof: string; kind: 'v' | 'd'; bot: number; top: number; xPair?: 'cont' | 'split' };
  const webs: Web[] = [];
  const own = (id: string, def: string) => { const o = t.ovOf?.(id) ?? t.ovOf?.(`${id}1`) ?? t.ovOf?.(`${id}2`); return o && tryProfile(o) ? o : def; };
  t.spec.verts.forEach((v, i) => { if (v && i <= n) webs.push({ id: `${t.idBase}.V${i}`, prof: own(`${t.idBase}.V${i}`, prof('vert')), kind: 'v', bot: i, top: i }); });
  t.spec.cells.slice(0, n).forEach((c, i) => {
    const pr = i === 0 || i === n - 1 ? prof('endDiag') : prof('diag');
    if (c === '/' || c === 'X') webs.push({ id: `${t.idBase}.D${i}a`, prof: own(`${t.idBase}.D${i}a`, pr), kind: 'd', bot: i, top: i + 1, xPair: c === 'X' ? 'cont' : undefined });
    if (c === '\\' || c === 'X') webs.push({ id: `${t.idBase}.D${i}b`, prof: own(`${t.idBase}.D${i}b`, pr), kind: 'd', bot: i + 1, top: i, xPair: c === 'X' ? 'split' : undefined });
  });
  // רוחב במישור ועקבות על פני החגורה
  const wIn = (pr: string) => tryProfile(pr)?.props.b ?? 80;
  const angleTo = (w: Web, atTop: boolean) => {
    const sb = t.nodes[w.bot], st = t.nodes[w.top];
    const d = norm(sub(P(st, t.top.z(st)), P(sb, t.bot.z(sb))));
    // שיפוע החגורה בצד של האלכסון (ברכס השיפוע משתנה — לוקחים את הצד שאליו האלכסון פונה)
    const c = atTop ? t.top : t.bot, s = atTop ? st : sb, m = slopeAt(c, s + Math.sign((atTop ? sb : st) - s));
    const ch = norm(add(t.e, scale(Z, m)));
    return Math.max(0.2, Math.sqrt(Math.max(0, 1 - dot(d, ch) ** 2)));
  };
  // היסטים בצומת: אנך במרכז; אלכסון לכיוון +s מימין, לכיוון −s משמאל (מרווח GAP)
  const offset = new Map<string, number>();
  for (const atTop of [false, true]) for (let i = 0; i <= n; i++) {
    const here = webs.filter((w) => (atTop ? w.top : w.bot) === i);
    const vert = here.find((w) => w.kind === 'v');
    const base = vert ? wIn(vert.prof) / 2 + GAP : GAP / 2;
    for (const w of here) {
      if (w.kind === 'v') { offset.set(`${w.id}|${atTop}`, 0); continue; }
      const other = atTop ? w.bot : w.top, sg = Math.sign(other - i);
      const f = wIn(w.prof) / (2 * angleTo(w, atTop));
      const alone = !vert && here.filter((x) => x.kind === 'd').length === 1;
      offset.set(`${w.id}|${atTop}`, alone ? 0 : sg * (base + f));
    }
  }
  const sAt = (w: Web, atTop: boolean) => {
    const i = atTop ? w.top : w.bot, c = atTop ? t.top : t.bot;
    const o = offset.get(`${w.id}|${atTop}`) ?? 0;
    const m = slopeAt(c, t.nodes[i] + Math.sign(o));
    return t.nodes[i] + o / Math.hypot(1, m);
  };
  const cutPlane = (atTop: boolean, s: number): Plane => {
    const c = atTop ? t.top : t.bot;
    const nn = faceN(c, atTop, s);
    const p = P(s, atTop ? fTop(s) : fBot(s));
    return { point: add(p, scale(nn, 1)), normal: nn };
  };
  const mk = (id: string, label: string, pr: string, a: Vec3, b: Vec3, startCut?: Plane, endCut?: Plane): Member => ({
    id, kind: 'brace', label, start: a, end: b, profile: pr, material: t.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: pn,
    source: 'generated', manualPlacement: false, connId: t.connId, startCut, endCut, partDesc: `${label} ${pr}`,
  });
  const weldOf = (k: string, a: string, b: string, at: Vec3, len: number): WeldInfo => ({ id: `${t.connId}.W${k}`, connId: t.connId, type: 'fillet', a: 4, length: Math.round(len), location: 'shop', between: [a, b], from: at, to: at });
  const perim = (pr: string) => { const p = tryProfile(pr); return p ? 2 * (p.props.b + p.props.h) : 300; };
  let wk = 0;
  for (const w of webs) {
    const sb = sAt(w, false), st = sAt(w, true);
    const A = P(sb, fBot(sb)), B = P(st, fTop(st));
    const label = w.kind === 'v' ? `אנך ${t.label}` : `אלכסון ${t.label}`;
    if (w.xPair === 'split') {
      // חצי אלכסון משני צדי האלכסון הרציף של אותו שדה
      const cont = webs.find((x) => x.xPair === 'cont' && Math.min(x.bot, x.top) === Math.min(w.bot, w.top))!;
      const cA = P(sAt(cont, false), fBot(sAt(cont, false))), cB = P(sAt(cont, true), fTop(sAt(cont, true)));
      const dC = norm(sub(cB, cA)), dW = norm(sub(B, A));
      // נקודת חיתוך הצירים במישור
      const r = sub(A, cA), den = dot(dC, dC) * dot(dW, dW) - dot(dC, dW) ** 2;
      const tc = (dot(r, dC) * dot(dW, dW) - dot(r, dW) * dot(dC, dW)) / (den || 1);
      const X = add(cA, scale(dC, tc));
      const nX = norm(cross(pn, dC));
      const halfW = wIn(cont.prof) / 2 + 1;
      const sideA = Math.sign(dot(sub(A, X), nX)) || 1;
      const plA: Plane = { point: add(X, scale(nX, sideA * halfW)), normal: nX };
      const plB: Plane = { point: add(X, scale(nX, -sideA * halfW)), normal: nX };
      const h1 = mk(`${w.id}1`, label, w.prof, A, X, cutPlane(false, sb), plA);
      const h2 = mk(`${w.id}2`, label, w.prof, X, B, plB, cutPlane(true, st));
      members.push(h1, h2);
      welds.push(weldOf(`${++wk}`, t.bot.memberAt(sb), h1.id, A, perim(w.prof)), weldOf(`${++wk}`, cont.id, h1.id, X, perim(w.prof)), weldOf(`${++wk}`, cont.id, h2.id, X, perim(w.prof)), weldOf(`${++wk}`, t.top.memberAt(st), h2.id, B, perim(w.prof)));
      continue;
    }
    members.push(mk(w.id, label, w.prof, A, B, cutPlane(false, sb), cutPlane(true, st)));
    welds.push(weldOf(`${++wk}`, t.bot.memberAt(sb), w.id, A, perim(w.prof)), weldOf(`${++wk}`, t.top.memberAt(st), w.id, B, perim(w.prof)));
  }
  // לחיות צומת (F10): זוג פלטות משני צדי קצות האלכסונים בכל צומת, על פני החגורה (ניצבות למישור המסבך). אפשרי רק כשהאלכסונים צרים מהחגורה.
  const nc = t.spec.nodeCheeks;
  if (nc?.enabled) {
    const mn = cheekMins(nc), tg = Math.max(mn.t, nc.t), hg = Math.max(mn.h, nc.h);
    for (const atTop of [false, true]) {
      const chord = atTop ? t.top : t.bot, face = atTop ? fTop : fBot;
      for (let i = 0; i <= n; i++) {
        const here = webs.filter((w) => (atTop ? w.top : w.bot) === i);
        if (!here.length) continue;
        const wmax = Math.max(...here.map((w) => wIn(w.prof)));
        const reach = here.map((w) => ({ s: sAt(w, atTop), f: wIn(w.prof) / (2 * angleTo(w, atTop)) }));
        const lo = Math.min(...reach.map((r) => r.s - r.f)) - 20, hi = Math.max(...reach.map((r) => r.s + r.f)) + 20;
        const sMid = (lo + hi) / 2, L = hi - lo;
        const m = slopeAt(chord, sMid), ch = norm(add(t.e, scale(Z, m))), nn = faceN(chord, atTop, sMid);
        // בחגורה שהשיפוע שלה משתנה בתוך אורך הלחי (רכס) — הלחי מורחקת מהפנים עד שאין חדירה לחגורה
        const F0 = P(sMid, face(sMid));
        const dev = Math.max(0, ...[lo, hi].map((sk) => dot(sub(P(sk, face(sk)), F0), nn))), shift = dev + 1; // + מרווח ריתוך 1 מ"מ מפני החגורה
        const C = add(add(F0, scale(nn, shift)), scale(nn, hg / 2));
        const off = wmax / 2 + tg / 2;
        const host = chord.memberAt(t.nodes[i]);
        const ids: string[] = [];
        for (const [k, sg] of [[1, 1], [2, -1]] as const) {
          const c = add(C, scale(pn, sg * off));
          const id = `${t.idBase}.G${i}${atTop ? 'T' : 'B'}${k}`;
          members.push({
            id, kind: 'plate', label: `לחי צומת PL${tg}×${Math.round(hg)}×${Math.round(L)}`, start: sub(c, scale(ch, L / 2)), end: add(c, scale(ch, L / 2)),
            profile: `PL${Math.round(hg)}x${tg}`, material: t.mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: pn, source: 'generated', manualPlacement: false, connId: t.connId,
            partDesc: `לחי צומת PL${tg}×${Math.round(hg)}×${Math.round(L)}`,
          });
          ids.push(id);
          welds.push(weldOf(`${++wk}`, host, id, add(P(sMid, face(sMid)), scale(pn, sg * off)), 2 * L));
          for (const w of here) welds.push(weldOf(`${++wk}`, w.id, id, add(P(sAt(w, atTop), face(sAt(w, atTop))), scale(pn, sg * off)), Math.round(hg / angleTo(w, atTop))));
        }
        const chordB = tryProfile(atTop ? t.spec.profiles.top : t.spec.profiles.bottom)?.props.b ?? 0;
        if (chordB && off + tg / 2 > chordB / 2) issues.push({ code: 'TRUSS_NODE', severity: 'warning', elementId: ids[0], message: `${t.label}: לחיות צומת ${i + 1} חורגות מרוחב החגורה (${Math.round(chordB)} מ"מ) — הקטן את עובי הלחי או את רוחב האלכסון` });
      }
    }
  }
  // בדיקת זוויות (30°–70° מומלץ לאלכסונים)
  for (const w of webs.filter((x) => x.kind === 'd')) {
    const a = (Math.asin(angleTo(w, false)) * 180) / Math.PI;
    if (a < 25 || a > 75) { issues.push({ code: 'TRUSS_ANGLE', severity: 'warning', elementId: w.id, message: `${t.label}: זווית אלכסון ${a.toFixed(0)}° — מומלץ 30°–60° (שנה מספר שדות או גובה)` }); break; }
  }
  const connection: Connection = {
    id: t.connId, type: 'truss', label: `${t.label} — צמתים מרותכים`, members: [...new Set(t.nodes.flatMap((s) => [t.top.memberAt(s), t.bot.memberAt(s)]))],
    parts: members.map((m) => m.id), bolts: [], welds, status: 'not-verified', fixity: 'rigid', overridden: false,
  };
  return { members, connection, issues };
}

// ------------------------------------------------------------------ חיבור המשך בחגורה / חגורה לעמוד (פלטות קצה מוברגות)

/** חיבור המשך כללי בין שני קטעי חגורה (כל חתך): שתי פלטות קצה מרותכות, 4 ברגים מחוץ לחתך */
export function chordSplice(id: string, label: string, a: Member, b: Member, at: Vec3, dir: Vec3, mat: string, hEff?: number): { members: Member[]; connection: Connection } {
  const pr = getProfile(a.profile);
  const T = 15, e = 30, bh = pr.props.b, hh = hEff ?? pr.props.h;
  const ex = norm(dir);
  let up = norm(sub(Z, scale(ex, dot(Z, ex)))); if (up.z < 0) up = scale(up, -1);
  const side = norm(cross(ex, up));
  const W = bh + 2 * (e + 25), H = hh + 2 * (e + 25);
  const vc = a.anchor === 'top' ? -hh / 2 : 0;
  const c0 = add(at, scale(up, vc));
  const plates: Member[] = [];
  for (const [k, dt] of [[1, -T / 2], [2, T / 2]] as const) {
    const c = add(c0, scale(ex, dt));
    plates.push({ id: `${id}.PL${k}`, kind: 'plate', label: `פלטת המשך PL${T}×${Math.round(W)}×${Math.round(H)}`, start: sub(c, scale(up, H / 2)), end: add(c, scale(up, H / 2)), profile: `PL${Math.round(W)}x${T}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: ex, source: 'generated', manualPlacement: false, connId: id, partDesc: `פלטת המשך חגורה PL${T}×${Math.round(W)}×${Math.round(H)}` });
  }
  const bolts: BoltInfo[] = [];
  const out: Member[] = [...plates];
  let k = 0;
  for (const du of [-(bh / 2 + e), bh / 2 + e]) for (const dv of [-(hh / 2 + e), hh / 2 + e]) {
    const head = add(add(add(c0, scale(ex, -T)), scale(side, du)), scale(up, dv));
    bolts.push(makeBolt(`${id}.B${++k}`, id, head, ex, BOLT, 2 * T, 'site', plates.map((p) => p.id), up, out));
  }
  const welds: WeldInfo[] = [
    { id: `${id}.W1`, connId: id, type: 'fillet', a: 5, length: Math.round(2 * (bh + hh)), location: 'shop', between: [a.id, plates[0].id], from: add(c0, scale(ex, -T)), to: add(c0, scale(ex, -T)) },
    { id: `${id}.W2`, connId: id, type: 'fillet', a: 5, length: Math.round(2 * (bh + hh)), location: 'shop', between: [b.id, plates[1].id], from: add(c0, scale(ex, T)), to: add(c0, scale(ex, T)) },
  ];
  return { members: out, connection: { id, type: 'truss-splice', label, members: [a.id, b.id], parts: out.map((m) => m.id), bolts, welds, status: 'not-verified', fixity: 'rigid', overridden: false } };
}

// ------------------------------------------------------------------ מסבכי גג

/** מסגרות עם מסבך גג */
export function trussFrames(p: Project): string[] {
  const rt = p.building.roofTruss;
  if (!rt?.enabled) return [];
  return rt.frames === 'all' ? p.building.frames.map((f) => f.id) : rt.frames.filter((id) => p.building.frames.some((f) => f.id === id));
}

interface RoofLayout { x0: number; x1: number; xR: number | null; nodes: number[]; rafters: Member[]; colL: Member; colR: Member; /** מספר המפתח (1…) במסגרת רב-מפתחית; 0 = מפתח יחיד */ bay: number }
/**
 * צמתי המסבך לאורך X בין פני העמודים; ברכס — צומת.
 * מסגרת רב-מפתחית (1.66): מסבך נפרד בכל מפתח בין שני עמודים סמוכים.
 */
export function roofTrussLayouts(p: Project, members: Member[], frameId: string): RoofLayout[] {
  const rt = p.building.roofTruss!;
  const cols = members.filter((m) => m.kind === 'column' && m.frameId === frameId).sort((a, b) => a.start.x - b.start.x);
  const allRafters = members.filter((m) => m.kind === 'rafter' && m.frameId === frameId);
  if (cols.length < 2 || !allRafters.length) return [];
  const out: RoofLayout[] = [];
  for (let k = 0; k + 1 < cols.length; k++) {
    const colL = cols[k]!, colR = cols[k + 1]!;
    const hc = (c: Member) => tryProfile(c.profile)?.props.h ?? 200;
    const x0 = colL.start.x + hc(colL) / 2 + 20, x1 = colR.start.x - hc(colR) / 2 - 20;
    const rafters = allRafters.filter((m) => Math.max(m.start.x, m.end.x) > x0 + 1 && Math.min(m.start.x, m.end.x) < x1 - 1);
    if (!rafters.length || x1 - x0 < 1000) continue;
    // רכס: נקודה שבה שתי קורות נפגשות בתוך התחום
    const ends = rafters.flatMap((r) => [r.start.x, r.end.x]).filter((x) => x > x0 + 500 && x < x1 - 500);
    const xR = rafters.length >= 2 && ends.length ? ends.reduce((a, b) => a + b, 0) / ends.length : null;
    let n = Math.max(2, Math.round(rt.spec.panels));
    const nodes: number[] = [];
    if (xR !== null) {
      if (n % 2) n += 1;
      // שדות לא אחידים: כל חצי לפי חציו של panelLens (הרכס תמיד צומת)
      const L = hasPanelLens(rt.spec) && rt.spec.panelLens!.length === n ? rt.spec.panelLens! : null;
      const half = (ls: number[] | null, a: number, b: number, first: boolean) => {
        const m = n / 2, tot = ls ? ls.reduce((q, w) => q + w, 0) : m;
        let acc = 0;
        for (let i = first ? 0 : 1; i <= m; i++) { if (i > 0) acc += ls ? ls[i - 1]! : 1; nodes.push(i === m ? b : a + ((b - a) * (i === 0 ? 0 : acc)) / tot); }
      };
      half(L ? L.slice(0, n / 2) : null, x0, xR, true);
      half(L ? L.slice(n / 2) : null, xR, x1, false);
    } else nodes.push(...trussNodes(rt.spec, x0, x1));
    out.push({ x0, x1, xR, nodes, rafters, colL, colR, bay: cols.length > 2 ? k + 1 : 0 });
  }
  return out;
}
/** מפתח יחיד / ראשון (תאימות לאחור) */
export function roofTrussLayout(p: Project, members: Member[], frameId: string): RoofLayout | null {
  return roofTrussLayouts(p, members, frameId)[0] ?? null;
}

/** קורת הגג (TOS על הקו) — גובה ציר ושיפוע ב-x */
function rafterAt(rafters: Member[], x: number) {
  const r = rafters.find((m) => Math.min(m.start.x, m.end.x) - 1 <= x && Math.max(m.start.x, m.end.x) + 1 >= x) ?? rafters[0];
  const h = tryProfile(r.profile)?.props.h ?? 300;
  const m = (r.end.z - r.start.z) / ((r.end.x - r.start.x) || 1);
  const cos = 1 / Math.hypot(1, m);
  const zLine = r.start.z + m * (x - r.start.x);
  return { r, h, m, axis: r.anchor === 'top' ? zLine - (h / 2) / cos : zLine };
}

/** חיבורי המשך לקורות גג שהן חגורה עליונה ארוכה מהמוט: באמצע שדה (לא בצומת) — כך גם החגורה התחתונה נחתכת שם */
export function roofTrussRafterSplices(p: Project, members: Member[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const stock = p.settings.stockLength - 30;
  for (const fid of trussFrames(p)) for (const L of roofTrussLayouts(p, members, fid)) {
    for (const r of L.rafters) {
      const len = Math.hypot(r.end.x - r.start.x, r.end.z - r.start.z);
      if (len <= stock || r.id in p.splices || r.id in out) continue;
      const lo = Math.min(r.start.x, r.end.x), hi = Math.max(r.start.x, r.end.x);
      // תפר באמצע שדה (חופשי מצמתים), מוזז בתוך השדה הרחק מתומכי הפטות על הקורה
      const pxs = members.filter((m) => m.purlin).map((m) => m.start.x);
      const best = (a: number, b: number) => {
        let bx = (a + b) / 2, bd = -1;
        for (let k = 0; k <= 20; k++) { const x = a + 0.2 * (b - a) + (0.6 * (b - a) * k) / 20; const dd = Math.min(...pxs.map((q) => Math.abs(q - x)), 1e9); if (dd > bd + 1) { bd = dd; bx = x; } }
        return bd >= 220 ? bx : null;
      };
      const mids = L.nodes.slice(0, -1).map((x, i) => best(x, L.nodes[i + 1])).filter((x): x is number => x !== null && x > lo + 300 && x < hi - 300);
      const cos = Math.abs(r.end.x - r.start.x) / len;
      const tOf = (x: number) => Math.abs(x - r.start.x) / cos;
      const ts: number[] = []; let prev = 0;
      const cand = mids.map(tOf).sort((a, b) => a - b);
      for (let i = 0; i < cand.length; i++) if (cand[i + 1] === undefined ? len - prev > stock : cand[i + 1] - prev > stock) { if (cand[i] - prev > 500) { ts.push(Math.round(cand[i])); prev = cand[i]; } }
      if (ts.length) out[r.id] = ts;
    }
  }
  return out;
}

/** בניית מסבכי הגג: חגורה תחתונה (מקטעים + חיבורי המשך), אנכיים ואלכסונים, חיבור החגורה לעמודים */
export function buildRoofTrusses(p: Project, members: Member[], splices: Record<string, number[]>): { members: Member[]; connections: Connection[]; issues: ValidationIssue[]; skipKnee: Set<string> } {
  const res = { members: [] as Member[], connections: [] as Connection[], issues: [] as ValidationIssue[], skipKnee: new Set<string>() };
  const rt = p.building.roofTruss as RoofTrussParams | undefined;
  if (!rt?.enabled) return res;
  const mat = p.building.material;
  const spec = rt.spec;
  const pb = tryProfile(spec.profiles.bottom);
  if (!pb) { res.issues.push({ code: 'PROFILE', severity: 'error', message: `מסבך גג: חתך חגורה תחתונה לא מוכר ${spec.profiles.bottom}` }); return res; }
  for (const k of ['endDiag', 'diag', 'vert'] as const) if (!tryProfile(spec.profiles[k])) { res.issues.push({ code: 'PROFILE', severity: 'error', message: `מסבך גג: חתך לא מוכר ${spec.profiles[k]}` }); return res; }
  for (const fid of trussFrames(p)) {
    const Ls = roofTrussLayouts(p, members, fid);
    const fi = p.building.frames.findIndex((f) => f.id === fid) + 1;
    if (!Ls.length) { res.issues.push({ code: 'TRUSS_FRAME', severity: 'warning', message: `מסבך גג מסגרת ${fi}: לא נמצאו שני עמודים וקורת גג במפתח` }); continue; }
    res.skipKnee.add(fid);
    for (const L of Ls) {
    // מזהים: מפתח יחיד — כמו קודם; רב-מפתחי — סיומת .S<מפתח>
    const sx = L.bay ? `.S${L.bay}` : '';
    const bl = L.bay ? ` מפתח ${L.bay}` : '';
    const y = L.colL.start.y;
    const top = (x: number) => rafterAt(L.rafters, x).axis;
    const zEnd = Math.min(top(L.x0), top(L.x1)) - spec.depth;
    const rise = rt.shape === 'scissor' && L.xR !== null ? Math.max(0, rt.rise ?? 1000) : 0;
    const bz = rt.shape === 'parallel' ? (x: number) => top(x) - spec.depth
      : rise > 0 ? (x: number) => zEnd + rise * (1 - Math.abs(x - L.xR!) / (x < L.xR! ? L.xR! - L.x0 : L.x1 - L.xR!)) : () => zEnd;
    if (rt.shape === 'scissor' && L.xR === null) res.issues.push({ code: 'TRUSS_FRAME', severity: 'info', message: `מסבך "מספריים" מסגרת ${fi}: גג חד-שיפועי — חגורה תחתונה אופקית` });
    if (rise > 0 && top(L.xR!) - (zEnd + rise) < spec.depth * 0.6) res.issues.push({ code: 'TRUSS_ANGLE', severity: 'warning', message: `מסבך "מספריים" מסגרת ${fi}: הגבהה גדולה — גובה המסבך ברכס קטן מ-60% מהגובה בקצה` });
    // מקטעי החגורה התחתונה: נחתכים ברכס (parallel / גג דו-שיפועי) ובאורך מוט (להלן). 1.114 (החלטת בעלים 28.11.2026): חיבורי ההמשך של קורת הגג
    // (החגורה העליונה) אינם חותכים עוד את החגורה התחתונה — חלק אחד כשאורכה נכנס במוט.
    const cutsX = new Set<number>();
    if (L.xR !== null) cutsX.add(L.xR);
    void splices;
    const cuts = [...cutsX].filter((x) => x > L.x0 + 300 && x < L.x1 - 300).sort((a, b) => a - b);
    // אם החגורה התחתונה ארוכה מהמוט — חיתוך נוסף באמצע שדות
    const stock = p.settings.stockLength - 30;
    const bounds = [L.x0, ...cuts, L.x1];
    const extra: number[] = [];
    for (let i = 1; i < bounds.length; i++) {
      let a = bounds[i - 1];
      while (bounds[i] - a > stock) {
        const mids = L.nodes.slice(0, -1).map((x, j) => (x + L.nodes[j + 1]) / 2).filter((x) => x > a + 500 && x - a <= stock);
        const m = mids[mids.length - 1]; if (m === undefined) break; extra.push(m); a = m;
      }
    }
    const allCuts = [...cuts, ...extra].sort((a, b) => a - b);
    const segX = [L.x0, ...allCuts, L.x1];
    const bcIds: string[] = [];
    const bc: Member[] = [];
    for (let i = 1; i < segX.length; i++) {
      const xa = segX[i - 1], xb = segX[i];
      const id = `${fid}${sx}.BC.${i}`;
      const zA = bz(xa), zB = bz(xb);
      const vertPlane = (x: number): Plane => ({ point: v3(x, y, 0), normal: v3(1, 0, 0) });
      const m: Member = {
        id, kind: 'beam', label: `חגורה תחתונה מסבך מסגרת ${fi}${bl}${segX.length > 2 ? ` (${i}/${segX.length - 1})` : ''}`, start: v3(xa, y, zA), end: v3(xb, y, zB),
        profile: spec.profiles.bottom, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: Z, source: 'generated', manualPlacement: false, frameId: fid,
        startCut: vertPlane(xa + (i === 1 ? 0 : 15.2)), endCut: vertPlane(xb - (i === segX.length - 1 ? 0 : 15.2)),
      };
      bc.push(m); bcIds.push(id);
    }
    res.members.push(...bc);
    const bcAt = (x: number) => bc.find((m) => x >= m.start.x - 1 && x <= m.end.x + 1)?.id ?? bc[0].id;
    const rafAt = (x: number) => {
      const r = rafterAt(L.rafters, x).r;
      // חלק קורת הגג אחרי חיבור המשך — עדיין אותו אלמנט (הפיצול לחלקים לפי splices)
      return r.id;
    };
    const cid = `C.TR.${fid}${sx}`;
    const tp = buildTrussPlane({
      idBase: `TR.${fid}${sx}`, connId: cid, label: `מסבך גג מסגרת ${fi}${bl}`, origin: v3(0, y, 0), e: v3(1, 0, 0), nodes: L.nodes,
      top: { z: top, h: rafterAt(L.rafters, L.x0).h, memberAt: rafAt },
      bot: { z: bz, h: pb.props.h, memberAt: bcAt }, spec: { ...spec, cells: fitCells(spec, L.nodes.length - 1, L.xR !== null), verts: fitVerts(spec, L.nodes.length - 1, L.xR !== null) }, mat, ovOf: (id) => p.memberOverrides[id]?.profile,
    });
    res.members.push(...tp.members); res.connections.push(tp.connection); res.issues.push(...tp.issues);
    // חיבורי המשך בחגורה התחתונה
    for (let i = 1; i < bc.length; i++) {
      // פלטות אנכיות (החגורה נחתכת אנכית); בחגורה משופעת — גובה החתך האנכי h/cos
      const mx = Math.max(...[bc[i - 1], bc[i]].map((q) => Math.abs((q.end.z - q.start.z) / ((q.end.x - q.start.x) || 1))));
      const sp = chordSplice(`C.TRS.${fid}${sx}.${i}`, `חיבור המשך חגורה תחתונה מסבך מסגרת ${fi}${bl}`, bc[i - 1], bc[i], v3(segX[i], y, bz(segX[i])), v3(1, 0, 0), mat, pb.props.h * Math.hypot(1, mx));
      res.members.push(...sp.members); res.connections.push(sp.connection);
    }
    // חגורה תחתונה ↔ עמוד: פלטת קצה מרותכת לחגורה, 4×M16 דרך אגף העמוד (שטח)
    for (const [col, m, sgn] of [[L.colL, bc[0], 1], [L.colR, bc[bc.length - 1], -1]] as const) {
      const cpr = getProfile(col.profile);
      const xF = col.start.x + sgn * cpr.props.h / 2;
      const id = `C.TRE.${fid}${sx}.${sgn > 0 ? 'L' : 'R'}`;
      const z0 = sgn > 0 ? m.start.z : m.end.z;
      const T = 15, cb = cpr.props.b, hb = pb.props.h;
      const W = Math.min(cb, pb.props.b + 60), H = hb + 2 * 70;
      const xc = xF + sgn * T / 2;
      const ep: Member = { id: `${id}.EP`, kind: 'plate', label: `פלטת קצה חגורה תחתונה PL${T}×${Math.round(W)}×${Math.round(H)}`, start: v3(xc, y, z0 - H / 2), end: v3(xc, y, z0 + H / 2), profile: `PL${Math.round(W)}x${T}`, material: mat, rollDeg: 0, mirror: false, anchor: 'center', refUp: v3(1, 0, 0), source: 'generated', manualPlacement: false, connId: id, partDesc: `פלטת קצה חגורה תחתונה PL${T}×${Math.round(W)}×${Math.round(H)}` };
      // החגורה נעצרת בפני הפלטה
      if (sgn > 0) { m.start = v3(xF + T, y, m.start.z); m.startCut = { point: v3(xF + T, y, 0), normal: v3(1, 0, 0) }; }
      else { m.end = v3(xF - T, y, m.end.z); m.endCut = { point: v3(xF - T, y, 0), normal: v3(1, 0, 0) }; }
      const out: Member[] = [ep];
      const bolts: BoltInfo[] = [];
      let k = 0;
      for (const dy of [-(W / 2 - 30), W / 2 - 30]) for (const dz of [-(hb / 2 + 35), hb / 2 + 35]) {
        bolts.push(makeBolt(`${id}.B${++k}`, id, v3(xF + sgn * T, y + dy, z0 + dz), v3(-sgn, 0, 0), BOLT, T + (cpr.dims.tf ?? 10), 'site', [ep.id, col.id], Z, out));
      }
      res.members.push(...out);
      res.connections.push({ id, type: 'truss-end', label: `חגורה תחתונה ↔ עמוד מסבך מסגרת ${fi}${bl}`, members: [col.id, m.id], parts: out.map((x) => x.id), bolts,
        welds: [{ id: `${id}.W1`, connId: id, type: 'fillet', a: 5, length: Math.round(2 * (pb.props.b + hb)), location: 'shop', between: [m.id, ep.id], from: v3(xF + sgn * T, y, z0), to: v3(xF + sgn * T, y, z0) }],
        status: 'not-verified', fixity: 'pinned', overridden: false });
      if (W / 2 - 30 < pb.props.b / 2 + 10 && hb + 70 > H) res.issues.push({ code: 'TRUSS_END', severity: 'warning', elementId: id, message: `מסבך מסגרת ${fi}${bl}: ברגי החגורה התחתונה קרובים לחגורה — בדוק גישה` });
    }
    }
  }
  if (res.skipKnee.size) res.issues.push({ code: 'TRUSS_INFO', severity: 'info', message: `מסבכי גג ב-${res.skipKnee.size} מסגרות: צמתים מרותכים במסגריה, חיבורי המשך וחגורה–עמוד מוברגים בשטח. גיאומטריה והערכת גודל בלבד — לאישור מהנדס` });
  return res;
}

/** בגג דו-שיפועי: השדות הסמוכים לרכס — אלכסונים שנפגשים ברכס העליון (החגורה התחתונה נחתכת ברכס), ללא אנך ברכס */
function fitCells(spec: TrussSpec, n: number, ridge: boolean): TrussCell[] {
  const c = spec.cells.length === n ? [...spec.cells] : patternCells(spec.pattern && spec.pattern !== 'custom' ? spec.pattern : 'warren-v', n).cells;
  if (ridge) { c[n / 2 - 1] = '/'; c[n / 2] = '\\'; }
  return c;
}
function fitVerts(spec: TrussSpec, n: number, ridge: boolean): boolean[] {
  const v = spec.verts.length === n + 1 ? [...spec.verts] : patternCells(spec.pattern && spec.pattern !== 'custom' ? spec.pattern : 'warren-v', n).verts;
  if (ridge) v[n / 2] = false;
  return v;
}

// ------------------------------------------------------------------ הערכת ניצול (כללי אצבע)

export interface TrussUtil { group: keyof TrussSpec['profiles']; force: number; util: number; note: string }
/**
 * הערכה גסה: מומנט ← כוח בחגורות N = M/d; גזירה ← כוח באלכסון N = V/sinθ; לחיצה עם הקטנת קריסה (עקומה c, אורך = שדה/אלכסון).
 * עומסים: loads = כוחות נקודתיים בצמתים העליונים [s, P] (קנ"ט) או עומס אחיד q (קנ"ט/מ').
 */
export function trussUtil(spec: TrussSpec, span: number, opts: { q?: number; points?: [number, number][]; fy?: number; gamma?: number }): TrussUtil[] {
  const fy = opts.fy ?? 235, g = opts.gamma ?? 1.1;
  const L = span / 1000; // מ'
  let M = 0, V = 0;
  if (opts.q) { M = (opts.q * L * L) / 8; V = (opts.q * L) / 2; }
  for (const [s, P] of opts.points ?? []) { const a = s / 1000, b = L - a; M += (P * a * b) / L; V = Math.max(V, (P * b) / L, (P * a) / L) + (opts.q ? 0 : 0); }
  const d = spec.depth / 1000;
  const Nch = M / d; // קנ"ט
  // שדה מקסימלי קובע (קריסת חגורה עליונה, אורך אלכסון)
  const panel = Math.max(...trussPanelLens(spec, span));
  const diagL = Math.hypot(panel, spec.depth);
  const sin = spec.depth / diagL;
  const chi = (pr: string, Lk: number) => {
    const p = tryProfile(pr); if (!p) return 0.3;
    const i = Math.min(p.props.iy || 1, p.props.iz || 1);
    const lam = Lk / i / (93.9 * Math.sqrt(235 / fy));
    const a = 0.49, ph = 0.5 * (1 + a * (lam - 0.2) + lam * lam);
    return Math.min(1, 1 / (ph + Math.sqrt(Math.max(0, ph * ph - lam * lam))));
  };
  const cap = (pr: string, comp: boolean, Lk: number) => { const p = tryProfile(pr); if (!p) return 1e-9; return ((p.props.area * fy) / g / 1000) * (comp ? chi(pr, Lk) : 1); };
  const out: TrussUtil[] = [
    { group: 'top', force: -Nch, util: Nch / cap(spec.profiles.top, true, panel), note: `לחיצה ${Nch.toFixed(0)} קנ"ט · אורך קריסה ${Math.round(panel)}` },
    { group: 'bottom', force: Nch, util: Nch / cap(spec.profiles.bottom, false, panel), note: `מתיחה ${Nch.toFixed(0)} קנ"ט` },
    { group: 'endDiag', force: V / sin, util: V / sin / cap(spec.profiles.endDiag, true, diagL), note: `${(V / sin).toFixed(0)} קנ"ט · אורך ${Math.round(diagL)}` },
    { group: 'diag', force: (V * 0.6) / sin, util: (V * 0.6) / sin / cap(spec.profiles.diag, true, diagL), note: `≈${((V * 0.6) / sin).toFixed(0)} קנ"ט` },
    { group: 'vert', force: V * 0.5, util: (V * 0.5) / cap(spec.profiles.vert, true, spec.depth), note: `≈${(V * 0.5).toFixed(0)} קנ"ט` },
  ];
  return out;
}
export const TRUSS_GROUP_HE: Record<keyof TrussSpec['profiles'], string> = { top: 'חגורה עליונה', bottom: 'חגורה תחתונה', endDiag: 'אלכסוני קצה', diag: 'אלכסונים', vert: 'אנכיים' };
