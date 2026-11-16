import { I_SERIES, U_SERIES, type ITuple } from './catalog';
import { catalogRow, getUserCatalog } from './userCatalog';
import BUILTIN_RAW from './data/builtin.json';
import {
  chsShape, cShape, iShape, lShape, plateShape, rhsShape, sectionProps, uShape, zShape,
  type Outline, type SectionProps,
} from './section';

export type Family =
  | 'IPE' | 'HEA' | 'HEB' | 'HEM' | 'INP' | 'UPN' | 'UPE'
  | 'SHS' | 'RHS' | 'CHS' | 'L' | 'C' | 'Z' | 'PL' | 'RD' | 'HX';

export interface Profile {
  name: string;            // שם קנוני, לדוגמה "IPE200", "SHS160x6", "Z200x70x20x2.5"
  family: Family;
  dims: Record<string, number>;
  outline: Outline;
  props: SectionProps;
  /** שם מקור הנתונים; לא מאומת עד ייבוא קטלוג מוסמך. */
  source: string;
  verified: boolean;
  /** הערה הנדסית על קירוב (אגפים משופעים, רדיוסי כיפוף). */
  note?: string;
  /** משקל למטר מהקטלוג (אם קיים) */
  catalogMass?: number;
}

export const FAMILY_LABEL: Record<Family, string> = {
  IPE: 'IPE', HEA: 'HEA', HEB: 'HEB', HEM: 'HEM', INP: 'INP', UPN: 'UPN', UPE: 'UPE',
  SHS: 'SHS – ריבועי חלול', RHS: 'RHS – מלבני חלול', CHS: 'CHS – צינור', L: 'L – זוויתן',
  C: 'C – מכופף בקר', Z: 'Z – מכופף בקר', PL: 'PL – פלטה', RD: 'RD – מוט עגול', HX: 'HX – משושה',
};

const cache = new Map<string, Profile>();

export class ProfileError extends Error {}

/** נרמול שם: אותיות גדולות, ללא רווחים, '*'/'×' → 'x'. */
export function normalizeName(raw: string): string {
  // סיומת ייצור (CF מכופף בקר / HF גמר חם) מושמטת — הקטלוג המובנה בוחר גרסה אחת לכל מידה
  return raw.trim().toUpperCase().replace(/\s+/g, '').replace(/,/g, '.').replace(/(\d)[*×X](?=\d)/g, '$1x').replace(/(\d)(CF|HF)$/, '$1');
}

function nums(s: string): number[] {
  if (!/^\d+(\.\d+)?(x\d+(\.\d+)?)*$/.test(s)) throw new ProfileError(`מידות לא תקינות: ${s}`);
  return s.split('x').map(Number);
}

function positive(...v: number[]) {
  if (v.some((x) => !(x > 0))) throw new ProfileError('כל המידות חייבות להיות חיוביות');
}

/** שורת קטלוג מובנה (מקובץ נתוני הפרופילים של המשתמש; scripts/import_profiles.py). יחידות mm. */
interface BuiltinRow {
  n: string; f: Family; src: string; d: string; m: string;
  h?: number; b?: number; b2?: number; tw?: number; tf?: number; t?: number; r?: number; ro?: number; c?: number;
  A: number; G?: number; Iy?: number; Iz?: number; Wy?: number; Wz?: number; iy?: number; iz?: number; It?: number; rv?: boolean;
}
const BUILTIN = BUILTIN_RAW as BuiltinRow[];
const builtinIdx = new Map<string, BuiltinRow>();
for (const r of BUILTIN) {
  builtinIdx.set(r.n, r);
  const alias = normalizeName(r.d.replace(/\s+(CF|HF)$/i, ''));
  if (!builtinIdx.has(alias)) builtinIdx.set(alias, r);
  // RHS ריבועי בשמות התוכנה (RHS80x80x4) = SHS בקטלוג
  if (r.f === 'SHS' && r.h && r.t && !builtinIdx.has(`RHS${r.h}x${r.h}x${r.t}`)) builtinIdx.set(`RHS${r.h}x${r.h}x${r.t}`, r);
}
export const builtinRow = (name: string) => builtinIdx.get(normalizeName(name));

/** חתך מתוך שורת הקטלוג המובנה: גיאומטריה מהמידות, תכונות חתך ומשקל מהטבלה */
function fromBuiltin(key: string, r: BuiltinRow): Profile {
  const fam: Family = r.f === 'SHS' && key.startsWith('RHS') ? 'RHS' : r.f;
  const h = r.h ?? 0, b = r.b ?? h, t = r.t ?? 0;
  let outline: Outline, dims: Record<string, number>, note: string | undefined;
  if (fam in I_SERIES || fam in U_SERIES) {
    const isU = fam === 'UPN' || fam === 'UPE';
    dims = { h, b, tw: r.tw ?? 0, tf: r.tf ?? 0, r: r.r ?? 0 };
    outline = isU ? uShape(h, b, dims.tw, dims.tf, dims.r) : iShape(h, b, dims.tw, dims.tf, dims.r);
    if (fam === 'INP' || fam === 'UPN') note = 'אגפים משופעים מיוצגים בעובי ממוצע (התכונות מהטבלה)';
  } else if (fam === 'RHS' || fam === 'SHS') { dims = { h, b, t }; outline = rhsShape(h, b, t); }
  else if (fam === 'CHS') { dims = { d: h, t }; outline = chsShape(h, t); }
  else if (fam === 'L') { dims = { a: h, b, t }; outline = lShape(h, b, t); }
  else if (fam === 'C' || fam === 'Z') {
    dims = { h, b, c: r.c ?? 0, t };
    outline = fam === 'C' ? cShape(h, b, r.c ?? 0, t) : zShape(h, b, r.c ?? 0, t);
    note = r.src === 'SIGMA' ? 'פרופיל סיגמה — הגיאומטריה בקירוב C; התכונות מהטבלה' : r.b2 ? `אגפים לא שווים (${b}/${r.b2}) — הגיאומטריה בקירוב; התכונות מהטבלה` : undefined;
  } else return build(key);
  const g = sectionProps(outline);
  const props = { ...g, area: r.A, Iy: r.Iy ?? g.Iy, Iz: r.Iz ?? g.Iz, Wy: r.Wy ?? g.Wy, Wz: r.Wz ?? g.Wz, iy: r.iy ?? g.iy, iz: r.iz ?? g.iz };
  return {
    name: fam === 'RHS' && r.f === 'SHS' ? key : r.n, family: fam, dims, outline, props, catalogMass: r.G, note,
    verified: !r.rv, source: `קטלוג פרופילים (${r.d}${r.m === 'CF' ? ', מכופף בקר' : r.m === 'HF' ? ', גמר חם' : ''})${r.rv ? ' — דורש בדיקה' : ''}`,
  };
}

export function getProfile(raw: string): Profile {
  const key = normalizeName(raw);
  const hit = cache.get(key);
  if (hit) return hit;
  const br = builtinIdx.get(key);
  const p = applyCatalog(br ? fromBuiltin(key, br) : build(key));
  cache.set(key, p);
  cache.set(p.name, p);
  return p;
}

export function clearProfileCache() { cache.clear(); }

/** החלת נתוני הקטלוג המאומת: מידות גיאומטריה (לחתכי I/U) ותכונות חתך מהטבלה. */
function applyCatalog(p: Profile): Profile {
  const r = catalogRow(p.name);
  if (!r) return p;
  let outline = p.outline;
  const dims = { ...p.dims };
  const isI = p.family in I_SERIES, isU = p.family in U_SERIES;
  if ((isI || isU) && r.h && r.b && r.tw && r.tf) {
    Object.assign(dims, { h: r.h, b: r.b, tw: r.tw, tf: r.tf, r: r.r ?? dims.r });
    outline = isU ? uShape(r.h, r.b, r.tw, r.tf, dims.r) : iShape(r.h, r.b, r.tw, r.tf, dims.r);
  }
  const g = sectionProps(outline);
  const props = {
    ...g,
    area: r.A ?? g.area, Iy: r.Iy ?? g.Iy, Iz: r.Iz ?? g.Iz, Wy: r.Wy ?? g.Wy, Wz: r.Wz ?? g.Wz, iy: r.iy ?? g.iy, iz: r.iz ?? g.iz,
  };
  const src = getUserCatalog();
  return { ...p, dims, outline, props, verified: true, source: `קטלוג משתמש: ${src?.source ?? ''}`, note: undefined, catalogMass: r.mass };
}

export function tryProfile(raw: string): Profile | null {
  try { return getProfile(raw); } catch { return null; }
}

function build(key: string): Profile {
  const m = /^(IPE|HEA|HEB|HEM|INP|UPN|UPE|SHS|RHS|CHS|PL|RD|HX|L|C|Z)(.*)$/.exec(key);
  if (!m) throw new ProfileError(`סדרת חתך לא מוכרת: ${key}`);
  const fam = m[1] as Family;
  const rest = m[2];
  const src = 'ידע כללי לפי סדרות EN — לא מאומת';
  const mk = (name: string, dims: Record<string, number>, outline: Outline, note?: string): Profile => ({
    name, family: fam, dims, outline, props: sectionProps(outline), source: src, verified: false as boolean, note,
  });

  if (fam in I_SERIES || fam in U_SERIES) {
    const table = (I_SERIES as Record<string, Record<string, ITuple>>)[fam] ?? (U_SERIES as Record<string, Record<string, ITuple>>)[fam];
    const t = table[rest];
    if (!t) throw new ProfileError(`${fam}${rest} אינו בטבלה. זמינים: ${Object.keys(table).join(', ')}`);
    const [h, b, tw, tf, r] = t;
    const isU = fam === 'UPN' || fam === 'UPE';
    const note = fam === 'INP' || fam === 'UPN' ? 'אגפים משופעים מיוצגים בעובי ממוצע' : undefined;
    return mk(`${fam}${rest}`, { h, b, tw, tf, r }, isU ? uShape(h, b, tw, tf, r) : iShape(h, b, tw, tf, r), note);
  }
  const n = nums(rest);
  switch (fam) {
    case 'SHS': {
      // SHS a x t  או  SHS a x a x t
      const [a, t] = n.length === 2 ? n : n.length === 3 && n[0] === n[1] ? [n[0], n[2]] : [NaN, NaN];
      if (!Number.isFinite(a)) throw new ProfileError('SHS: יש להזין צלע x עובי, לדוגמה SHS160x6');
      positive(a, t); if (2 * t >= a) throw new ProfileError('עובי דופן גדול מדי');
      return mk(`SHS${a}x${t}`, { h: a, b: a, t }, rhsShape(a, a, t), 'רדיוסי פינה בקירוב');
    }
    case 'RHS': {
      if (n.length !== 3) throw new ProfileError('RHS: גובה x רוחב x עובי, לדוגמה RHS200x100x5');
      const [h, b, t] = n; positive(h, b, t);
      if (2 * t >= Math.min(h, b)) throw new ProfileError('עובי דופן גדול מדי');
      return mk(`RHS${h}x${b}x${t}`, { h, b, t }, rhsShape(h, b, t), 'רדיוסי פינה בקירוב');
    }
    case 'CHS': {
      if (n.length !== 2) throw new ProfileError('CHS: קוטר x עובי, לדוגמה CHS114.3x4');
      const [d, t] = n; positive(d, t); if (2 * t >= d) throw new ProfileError('עובי דופן גדול מדי');
      return mk(`CHS${d}x${t}`, { d, t }, chsShape(d, t));
    }
    case 'L': {
      const [a, b, t] = n.length === 2 ? [n[0], n[0], n[1]] : n.length === 3 ? n : [NaN, NaN, NaN];
      if (!Number.isFinite(t)) throw new ProfileError('L: רגל x עובי או רגל x רגל x עובי');
      positive(a, b, t); if (t >= Math.min(a, b)) throw new ProfileError('עובי גדול מהרגל');
      const name = a === b ? `L${a}x${t}` : `L${a}x${b}x${t}`;
      return mk(name, { a, b, t }, lShape(a, b, t), 'ללא רדיוס שורש');
    }
    case 'C':
    case 'Z': {
      // h x b x c x t (עם שפה) או h x b x t (ללא שפה)
      let h: number, b: number, c: number, t: number;
      if (n.length === 4) [h, b, c, t] = n; else if (n.length === 3) { [h, b, t] = n; c = 0; }
      else throw new ProfileError(`${fam}: גובה x רוחב x שפה x עובי, לדוגמה ${fam}200x70x20x2.5`);
      positive(h, b, t); if (c < 0 || c >= h / 2) throw new ProfileError('שפה לא תקינה');
      if (2 * t >= b || 2 * t >= h) throw new ProfileError('עובי גדול מדי');
      const name = c > 0 ? `${fam}${h}x${b}x${c}x${t}` : `${fam}${h}x${b}x${t}`;
      const ol = fam === 'C' ? cShape(h, b, c, t) : zShape(h, b, c, t);
      return mk(name, { h, b, c, t }, ol, 'פרופיל מכופף בקר — פינות חדות (רדיוס כיפוף מוזנח)');
    }
    case 'RD': {
      if (n.length !== 1) throw new ProfileError('RD: קוטר');
      const [d] = n; positive(d);
      const o = chsShape(d, d / 2 - 1e-6, 16);
      return mk(`RD${d}`, { d }, { outer: o.outer, holes: [] });
    }
    case 'HX': {
      // משושה לפי מידה בין פאות (ראש בורג/אום)
      if (n.length !== 1) throw new ProfileError('HX: מידה בין פאות');
      const [s] = n; positive(s);
      const r = s / Math.sqrt(3);
      const outer = Array.from({ length: 6 }, (_, k) => ({ u: r * Math.cos((Math.PI / 3) * k), v: r * Math.sin((Math.PI / 3) * k) }));
      return mk(`HX${s}`, { s }, { outer, holes: [] });
    }
    case 'PL': {
      if (n.length !== 2) throw new ProfileError('PL: רוחב x עובי, לדוגמה PL230x20');
      const [b, t] = n; positive(b, t);
      return mk(`PL${b}x${t}`, { b, t }, plateShape(b, t));
    }
  }
  throw new ProfileError(`סדרה לא נתמכת: ${fam}`);
}

/** שמות לדפדוף בספרייה (סדרות טבלאיות) ודוגמאות לסדרות פרמטריות. */
export function catalogNames(): { family: Family; names: string[] }[] {
  const by = new Map<Family, string[]>();
  // C/Z מכופפים: רק בשם המקובל בן 4 חלקים (גובה×רוחב×שפה×עובי, למשל C120x40x13x2) — קודי יצרן לא מוצגים
  const czOk = (r: { f: string; n: string }) => !(r.f === 'C' || r.f === 'Z') || /^[CZ]\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/.test(r.n);
  for (const r of BUILTIN) { if (!czOk(r)) continue; if (!by.has(r.f)) by.set(r.f, []); by.get(r.f)!.push(r.n); }
  // RHS ריבועי זמין גם בשמות התוכנה (RHS80x80x4)
  const sq = BUILTIN.filter((r) => r.f === 'SHS' && r.h && r.t).map((r) => `RHS${r.h}x${r.h}x${r.t}`);
  by.set('RHS', [...(by.get('RHS') ?? []), ...sq]);
  for (const [f, t] of Object.entries({ ...I_SERIES, ...U_SERIES })) if (!by.has(f as Family)) by.set(f as Family, Object.keys(t).map((k) => `${f}${k}`));
  by.set('PL', ['PL100x10', 'PL150x10', 'PL200x15', 'PL230x20', 'PL300x20']);
  const order: Family[] = ['IPE', 'HEA', 'HEB', 'HEM', 'INP', 'UPN', 'UPE', 'RHS', 'SHS', 'CHS', 'L', 'C', 'Z', 'PL'];
  return order.filter((f) => by.has(f)).map((f) => ({ family: f, names: by.get(f)! }));
}

/** משקל למטר: מהקטלוג המאומת אם קיים, אחרת שטח × צפיפות. */
export function massPerMeter(p: Profile, density: number): number {
  return p.catalogMass ?? (p.props.area / 1e6) * density;
}

/** חתך מחושב גיאומטרית בלבד (ללא הקטלוג) — להשוואה מול הטבלה. */
export function profileWithoutCatalog(raw: string): Profile | null {
  try { return build(normalizeName(raw)); } catch { return null; }
}
