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
