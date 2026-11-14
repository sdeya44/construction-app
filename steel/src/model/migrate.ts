import type { Project } from './types';
import { SCHEMA_VERSION } from './types';

/**
 * מיגרציות סכמה. כל מפתח N ממיר קובץ מגרסה N לגרסה N+1.
 * הוספת גרסה: להגדיל SCHEMA_VERSION, להוסיף פונקציה כאן ובדיקה ב-tests/persist.test.ts.
 */
const MIGRATIONS: Record<number, (d: any) => any> = {
  // 1: (d) => ({ ...d, schemaVersion: 2, newField: default })
};

export class ProjectFileError extends Error {}

export function migrate(raw: any): Project {
  if (!raw || typeof raw !== 'object') throw new ProjectFileError('הקובץ אינו פרויקט תקין');
  let d = raw;
  if (d.format === 'kayan-steel-pro' && d.project) d = d.project; // מעטפת קובץ
  let v = d.schemaVersion;
  if (!Number.isInteger(v)) throw new ProjectFileError('חסרה גרסת סכמה בקובץ');
  if (v > SCHEMA_VERSION) throw new ProjectFileError(`הקובץ נוצר בגרסה חדשה יותר (${v}) של התוכנה`);
  while (v < SCHEMA_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) throw new ProjectFileError(`אין מיגרציה מגרסה ${v}`);
    d = fn(d);
    v = d.schemaVersion;
  }
  assertProject(d);
  return d as Project;
}

/** בדיקת מבנה בסיסית נגד קבצים פגומים. */
export function assertProject(d: any): asserts d is Project {
  const need = (cond: boolean, msg: string) => { if (!cond) throw new ProjectFileError(`קובץ פגום: ${msg}`); };
  need(typeof d.id === 'string', 'id');
  need(d.meta && typeof d.meta.name === 'string', 'meta');
  need(d.building && typeof d.building === 'object', 'building');
  need(Array.isArray(d.building.frames), 'frames');
  for (const f of d.building.frames) need(typeof f.id === 'string' && Number.isFinite(f.y), 'frame');
  for (const k of ['width', 'eaveLeft', 'eaveRight', 'ridgeX', 'slopeLeftPct']) need(Number.isFinite(d.building[k]), k);
  need(d.memberOverrides && typeof d.memberOverrides === 'object', 'memberOverrides');
  need(Array.isArray(d.manualMembers), 'manualMembers');
  need(Array.isArray(d.deleted), 'deleted');
  need(d.settings && Number.isFinite(d.settings.stockLength), 'settings');
}

/** קובץ JSON נייד: מעטפת עם שם פורמט וגרסת סכמה. */
export function toFileJson(p: Project): string {
  return JSON.stringify({ format: 'kayan-steel-pro', schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), project: p }, null, 1);
}

export function fromFileJson(text: string): Project {
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new ProjectFileError('הקובץ אינו JSON תקין'); }
  return migrate(raw);
}
