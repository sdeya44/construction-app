/**
 * ייבוא / ייצוא קובץ ספריית מחברים (1.67).
 * פורמט: { format: 'kayan-connection-library', version: 1, details: CustomDetail[] } — או מערך גולמי של פרטים באותו מבנה.
 * בייבוא: בדיקת מבנה וסוגי פעולות; מזהה שכבר קיים בפרויקט מקבל מזהה חדש (לא דורס פרט קיים).
 */
import type { CustomDetail } from '../model/types';

export const LIB_FORMAT = 'kayan-connection-library';
const OPS = new Set(['cut', 'shift', 'plate', 'endplate', 'holes', 'bolts', 'slot', 'vent', 'rod', 'weld']);

export function exportLibrary(details: CustomDetail[]): string {
  return JSON.stringify({ format: LIB_FORMAT, version: 1, exportedAt: new Date().toISOString(), details }, null, 1);
}

export function importLibrary(text: string, existing: CustomDetail[]): { added: CustomDetail[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('הקובץ אינו JSON תקין'); }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && (raw as { format?: string }).format === LIB_FORMAT ? (raw as { details?: unknown }).details : null;
  if (!Array.isArray(list)) throw new Error('הקובץ אינו ספריית מחברים של KAYAN');
  const have = new Set(existing.map((x) => x.id));
  const added: CustomDetail[] = [];
  list.forEach((x, i) => {
    const d = x as CustomDetail;
    if (!d || typeof d.id !== 'string' || typeof d.name !== 'string' || !Array.isArray(d.vars) || !Array.isArray(d.ops)) throw new Error(`פרט ${i + 1}: חסרים שדות (id, name, vars, ops)`);
    for (const op of d.ops) if (!OPS.has((op as { k?: string }).k ?? '')) throw new Error(`פרט "${d.name}": פעולה לא מוכרת ${(op as { k?: string }).k}`);
    for (const v of d.vars) if (typeof v?.name !== 'string' || typeof v?.expr !== 'string') throw new Error(`פרט "${d.name}": משתנה לא תקין`);
    if (d.params !== undefined) {
      if (!Array.isArray(d.params)) throw new Error(`פרט "${d.name}": params חייב להיות מערך`);
      for (const q of d.params) {
        if (typeof q?.name !== 'string' || typeof q?.label !== 'string' || !['number', 'select', 'toggle'].includes(q?.kind)) throw new Error(`פרט "${d.name}": פרמטר לא תקין`);
        if (!d.vars.some((v) => v.name === q.name)) throw new Error(`פרט "${d.name}": הפרמטר "${q.name}" לא מתאים לאף משתנה`);
        if (q.kind === 'select' && !(Array.isArray(q.options) && q.options.every((o) => typeof o?.value === 'number' && typeof o?.label === 'string'))) throw new Error(`פרט "${d.name}": אפשרויות הפרמטר "${q.name}" לא תקינות`);
      }
    }
    const c = structuredClone(d);
    if (have.has(c.id)) c.id = `cd-${Date.now().toString(36)}-${i}`;
    have.add(c.id);
    added.push(c);
  });
  return { added };
}
