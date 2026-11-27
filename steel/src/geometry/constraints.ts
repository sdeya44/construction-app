import type { CustomDetail, DetailOp } from '../model/types';
import type { MateResult } from './mates';

/**
 * עורך אילוצים בסטודיו הפרטים: תצוגה וניהול של הקשרים שהצמדות (`mates.ts`) כבר יוצרות — קישור מידת פלטה לפלטה אחרת (`P1.w`),
 * ישיבה של פלטה על פלטה, וחיתוך קצה האלמנט הצמוד לעובי הפלטות. פונקציות טהורות על `CustomDetail`;
 * אין שדה חדש במודל ואין שינוי בבניית הפרט — כל אילוץ הוא ביטוי או הפניה קיימים בפעולות.
 */
type PlateOp = Extract<DetailOp, { k: 'plate' }>;
export type DimField = 'w' | 'h' | 't';
export type Constraint =
  | { id: string; kind: 'dim-link'; op: string; field: DimField; to: string; text: string }
  | { id: string; kind: 'dim-var'; op: string; field: DimField; name: string; text: string }
  | { id: string; kind: 'stack'; op: string; on: string; text: string }
  | { id: string; kind: 'flush'; op: string; plates: string[]; text: string };

const FIELD_HE: Record<DimField, string> = { w: 'רוחב', h: 'גובה', t: 'עובי' };
const isPlate = (o: DetailOp): o is PlateOp => o.k === 'plate';
const plateOf = (det: CustomDetail, id: string) => det.ops.find((o): o is PlateOp => isPlate(o) && o.id === id);
const num = (s: string) => /^-?\d+(\.\d+)?$/.test(s.trim());

/** כל האילוצים בפרט. סדר: לפי סדר הפעולות, בתוך פלטה — w, h, t, ישיבה. */
export function constraintsOf(det: CustomDetail): Constraint[] {
  const out: Constraint[] = [];
  const vars = new Set(det.vars.map((v) => v.name));
  for (const op of det.ops) {
    if (isPlate(op)) {
      for (const f of ['w', 'h', 't'] as DimField[]) {
        const cur = String(op[f]).trim();
        const link = /^([A-Za-z_]\w*)\.(w|h|t)$/.exec(cur);
        if (link && link[2] === f && plateOf(det, link[1]!)) {
          out.push({ id: `${op.id}.${f}`, kind: 'dim-link', op: op.id, field: f, to: link[1]!, text: `${FIELD_HE[f]} ${op.id} = ${FIELD_HE[f]} ${link[1]}` });
        } else if (/^[A-Za-z_]\w*$/.test(cur) && vars.has(cur)) {
          out.push({ id: `${op.id}.${f}`, kind: 'dim-var', op: op.id, field: f, name: cur, text: `${FIELD_HE[f]} ${op.id} = משתנה ${cur}` });
        }
      }
      if (plateOf(det, op.ref.on)) out.push({ id: `${op.id}.on`, kind: 'stack', op: op.id, on: op.ref.on, text: `${op.id} יושבת על ${op.ref.on} (${op.ref.face})` });
    } else if (op.k === 'cut' && op.kind === 'host') {
      const ids = [...String(op.at).matchAll(/([A-Za-z_]\w*)\.t\b/g)].map((m) => m[1]!).filter((id) => plateOf(det, id));
      if (ids.length) out.push({ id: `${op.id}.at`, kind: 'flush', op: op.id, plates: ids, text: `קצה האלמנט צמוד לפלטות ${ids.join(' + ')}` });
    }
  }
  return out;
}

/** האם הפניית `from.field` ל-`to.field` תיצור מעגל (`to` תלויה, ישירות או בשרשרת, ב-`from`) */
function wouldCycle(det: CustomDetail, from: string, to: string, field: DimField): boolean {
  const seen = new Set<string>();
  let cur: string | undefined = to;
  while (cur) {
    if (cur === from) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    const m: RegExpExecArray | null = new RegExp(`^([A-Za-z_]\\w*)\\.${field}$`).exec(String(plateOf(det, cur)?.[field] ?? '').trim());
    cur = m && plateOf(det, m[1]!) ? m[1] : undefined;
  }
  return false;
}

/** קישור מידה: `plateId.field` ⇐ `toId.field`. מונע קישור עצמי ומעגלי. */
export function linkDim(det: CustomDetail, plateId: string, field: DimField, toId: string): MateResult {
  const op = plateOf(det, plateId);
  if (!op) return { error: 'בחרו פלטה' };
  if (!plateOf(det, toId)) return { error: 'פלטת היעד לא קיימת' };
  if (toId === plateId) return { error: 'אי אפשר לקשר פלטה לעצמה' };
  if (wouldCycle(det, plateId, toId, field)) return { error: 'הקישור יוצר מעגל בין המידות' };
  return { det: { ...det, ops: det.ops.map((o) => (o.id === plateId && isPlate(o) ? { ...o, [field]: `${toId}.${field}` } : o)) as DetailOp[] }, sel: plateId };
}

/** שחרור קישור/משתנה: המידה הופכת למספר קבוע (`value` — הערך הנוכחי במ"מ). בלי ערך מחושב — נשארת הנוסחה ומוחזרת שגיאה. */
export function unlinkDim(det: CustomDetail, plateId: string, field: DimField, value?: number): MateResult {
  const op = plateOf(det, plateId);
  if (!op) return { error: 'בחרו פלטה' };
  if (num(String(op[field]))) return { error: 'המידה כבר קבועה' };
  if (value === undefined || !Number.isFinite(value) || value <= 0) return { error: 'אין ערך מחושב לשחרור' };
  const v = String(Math.round(value * 100) / 100);
  return { det: { ...det, ops: det.ops.map((o) => (o.id === plateId && isPlate(o) ? { ...o, [field]: v } : o)) as DetailOp[] }, sel: plateId };
}
