import type { CustomDetail, DetailOp } from '../model/types';

/**
 * הצמדות בסטודיו הפרטים (שלב ב'): פעולות עריכה טהורות על `CustomDetail` — מתרגמות כוונה ("פלטה על פלטה", "הצמד את קצה האלמנט לפלטה")
 * לפעולות הקיימות (`plate` עם `ref.on` = פלטה, `cut` מסוג `host`). אין שדה חדש במודל ואין שינוי בבניית הפרט.
 */
type PlateOp = Extract<DetailOp, { k: 'plate' }>;
export type MateResult = { det: CustomDetail; sel: string } | { error: string };

const nextPlateId = (ops: DetailOp[]) => { let n = 1; while (ops.some((o) => o.id === `P${n}`)) n++; return `P${n}`; };
const plateOf = (det: CustomDetail, id: string) => det.ops.find((o): o is PlateOp => o.k === 'plate' && o.id === id);

/** פלטה על פלטה: פלטה חדשה על פני z+ של הפלטה הנבחרת, מידותיה מקושרות למקור (`P1.w`, `P1.h`, `P1.t`) — שינוי במקור משנה את שתיהן. */
export function stackPlate(det: CustomDetail, plateId: string): MateResult {
  const src = plateOf(det, plateId);
  if (!src) return { error: 'בחרו פלטה' };
  const id = nextPlateId(det.ops);
  const op: PlateOp = { k: 'plate', id, name: 'פלטה על פלטה', ref: { on: plateId, face: 'z+', along: '0', across: '0' }, mode: 'flat', spin: '0', off: '0', shape: src.shape, w: `${plateId}.w`, h: `${plateId}.h`, t: `${plateId}.t`, ch: src.ch, corners: [...src.corners] };
  return { det: { ...det, ops: [...det.ops, op] }, sel: id };
}

/** הצמדת קצה האלמנט לפלטה: חיתוך "מקביל למארח" במרחק סכום עובי הפלטות מפני המארח עד הפלטה הזו (`P1.t + P2.t`). דורש ששרשרת הפלטות תתחיל על פני המארח. */
export function flushElementTo(det: CustomDetail, plateId: string): MateResult {
  const chain: string[] = [];
  let cur = plateOf(det, plateId);
  if (!cur) return { error: 'בחרו פלטה' };
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) return { error: 'שרשרת פלטות מעגלית' };
    seen.add(cur.id);
    chain.unshift(`${cur.id}.t`);
    if (cur.ref.on === 'host') {
      if (cur.ref.face !== 'hit') return { error: 'הפלטה צריכה לשבת על פני המגע של המארח' };
      break;
    }
    const parent: PlateOp | undefined = plateOf(det, cur.ref.on);
    if (!parent) return { error: 'הפלטה לא יושבת על המארח או על פלטה שיושבת עליו — אי אפשר להצמיד את קצה האלמנט' };
    cur = parent;
  }
  const at = chain.join(' + ');
  const cut = det.ops.find((o) => o.k === 'cut');
  if (cut) return { det: { ...det, ops: det.ops.map((o) => (o.id === cut.id ? ({ ...o, kind: 'host', at } as DetailOp) : o)) }, sel: cut.id };
  let n = 1; while (det.ops.some((o) => o.id === `C${n}`)) n++;
  const id = `C${n}`;
  return { det: { ...det, ops: [...det.ops, { k: 'cut', id, kind: 'host', at }] }, sel: id };
}

const num = (s: string) => /^-?\d+(\.\d+)?$/.test(s.trim());
const ident = (s: string) => /^[A-Za-z_]\w*$/.test(s.trim());
const plus = (expr: string, add: number) => (num(expr) ? String(Math.round((Number(expr) + add) * 100) / 100) : `${expr.trim()} + ${add}`);

/**
 * תיקון בלחיצה: הגדלת מידה (`w`/`h`) של פלטה ב-`add` מ"מ. אם המידה מקושרת לפלטה אחרת (`P1.w`) — מגדילים את המקור (שתי הפלטות נשארות זהות);
 * אם היא שם משתנה — מגדילים את המשתנה; אחרת — את הביטוי עצמו.
 */
export function growPlate(det: CustomDetail, plateId: string, field: 'w' | 'h', add: number, depth = 0): MateResult {
  const op = plateOf(det, plateId);
  if (!op) return { error: 'הפלטה לא קיימת' };
  if (depth > 8) return { error: 'קישור מעגלי בין מידות הפלטות' };
  const cur = String(op[field]);
  const link = new RegExp(`^([A-Za-z_]\\w*)\\.${field}$`).exec(cur.trim());
  if (link && plateOf(det, link[1]!)) return growPlate(det, link[1]!, field, add, depth + 1);
  if (ident(cur) && det.vars.some((v) => v.name === cur.trim())) {
    const name = cur.trim();
    return { det: { ...det, vars: det.vars.map((v) => (v.name === name ? { ...v, expr: plus(v.expr, add) } : v)) }, sel: plateId };
  }
  return { det: { ...det, ops: det.ops.map((o) => (o.id === plateId && o.k === 'plate' ? { ...o, [field]: plus(cur, add) } : o)) as DetailOp[] }, sel: plateId };
}

/**
 * "הפוך לפרמטר": מידה של פלטה (`w`/`h`/`t`) הופכת למשתנה בשם `${op}${field}` (למשל `P1w`) ולשדה באשף החיבורים עם תווית — בלי נוסחה.
 * `value` (הערך הנוכחי במ"מ) קובע את טווח השדה: חצי עד פי שלושה.
 */
export function promoteToParam(det: CustomDetail, plateId: string, field: 'w' | 'h' | 't', value?: number): MateResult {
  const op = plateOf(det, plateId);
  if (!op) return { error: 'בחרו פלטה' };
  const cur = String(op[field]).trim();
  if (ident(cur) && det.params?.some((p) => p.name === cur)) return { error: 'המידה כבר פרמטר' };
  let name = `${plateId}${field}`, n = 2;
  while (det.vars.some((v) => v.name === name)) name = `${plateId}${field}${n++}`;
  const label = `${field === 'w' ? 'רוחב' : field === 'h' ? 'גובה' : 'עובי'} ${op.name ?? 'פלטה'} ${plateId}`;
  const base = value !== undefined && Number.isFinite(value) && value > 0 ? value : num(cur) ? Number(cur) : 100;
  const param = { name, label, kind: 'number' as const, unit: 'מ"מ', min: Math.max(1, Math.floor(base / 2)), max: Math.ceil(base * 3), group: 'פלטות' };
  return {
    det: { ...det, vars: [...det.vars, { name, expr: cur, note: label }], params: [...(det.params ?? []), param], ops: det.ops.map((o) => (o.id === plateId && o.k === 'plate' ? { ...o, [field]: name } : o)) as DetailOp[] },
    sel: plateId,
  };
}
