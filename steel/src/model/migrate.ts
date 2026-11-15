import type { Project } from './types';
import { SCHEMA_VERSION } from './types';
import { emptyMarks, defaultBraceConn, defaultPurlinSplice, defaultBracing, defaultCleat, defaultConnections, defaultPurlins, defaultPurlinSide } from './defaults';

/**
 * מיגרציות סכמה. כל מפתח N ממיר קובץ מגרסה N לגרסה N+1.
 * הוספת גרסה: להגדיל SCHEMA_VERSION, להוסיף פונקציה כאן ובדיקה ב-tests/persist.test.ts.
 */
const MIGRATIONS: Record<number, (d: any) => any> = {
  // v1 → v2: מערכת פטות וחיבורי המשך
  1: (d) => ({
    ...d, schemaVersion: 2, splices: {},
    building: { ...d.building, purlins: d.building.roofType === 'mono' ? { ...defaultPurlins(), left: { ...defaultPurlinSide(), first: 0 } } : defaultPurlins() },
  }),
  // v2 → v3: חיבורים, תומכים, ברגים
  2: (d) => {
    // ברירת המחדל של כיוון פתיחת C שונתה (החלטת משתמש 14.11.2026): פתיחה לכיוון המרזב
    const side = (x: any) => ({ ...x, opening: 'down', cleat: defaultCleat() });
    return {
      ...d, schemaVersion: 3,
      connectionDefaults: defaultConnections(), connectionOverrides: {}, connectionTemplates: [], cleatOverrides: {},
      building: { ...d.building, purlins: { ...d.building.purlins, left: side(d.building.purlins.left), right: side(d.building.purlins.right) } },
    };
  },
  // v3 → v4: קושרות ושורות קשירה; פלטת בסיס מבוטנת (החלטת משתמש 14.11.2026)
  3: (d) => ({
    ...d, schemaVersion: 4,
    building: { ...d.building, bracing: defaultBracing() },
    connectionDefaults: { ...d.connectionDefaults, base: defaultConnections().base },
  }),
  // v4 → v5: מספור, מהדורות, שרטוטים, אורכי חומר גלם וקרף
  4: (d) => ({
    ...d, schemaVersion: 5,
    settings: { stockLengths: [6000, 12000], kerf: 3, checkedBy: '', approvedBy: '', ...d.settings },
    marks: emptyMarks(), revision: { current: 'A', locked: false, log: [] }, drawings: [],
  }),
  // v5 → v6: פחי חיבור לקושרות ובורג בהצטלבות; חיבור המשך פטה בפלטה ו-4 ברגים (החלטת משתמש 15.11.2026)
  5: (d) => ({
    ...d, schemaVersion: 6,
    building: {
      ...d.building,
      bracing: { ...d.building.bracing, conn: defaultBraceConn() },
      purlins: { ...d.building.purlins, splice: defaultPurlinSplice() },
    },
  }),
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
  need(d.splices && typeof d.splices === 'object', 'splices');
  for (const v of Object.values(d.splices)) need(Array.isArray(v) && (v as unknown[]).every(Number.isFinite), 'splice');
  const pu = d.building.purlins;
  need(pu && pu.left && pu.right, 'purlins');
  for (const side of [pu.left, pu.right]) {
    for (const k of ['first', 'spacing', 'edgeOffset']) need(Number.isFinite(side[k]), `purlins.${k}`);
    need(typeof side.profile === 'string', 'purlins.profile');
    need(side.cleat && Number.isFinite(side.cleat.thickness), 'purlins.cleat');
  }
  need(d.connectionDefaults && d.connectionDefaults.eave && d.connectionDefaults.ridge && d.connectionDefaults.base, 'connectionDefaults');
  need(d.connectionOverrides && typeof d.connectionOverrides === 'object', 'connectionOverrides');
  need(Array.isArray(d.connectionTemplates), 'connectionTemplates');
  need(d.cleatOverrides && typeof d.cleatOverrides === 'object', 'cleatOverrides');
  need(d.marks && d.marks.parts && d.marks.counters, 'marks');
  need(d.revision && typeof d.revision.current === 'string', 'revision');
  need(Array.isArray(d.drawings), 'drawings');
  const br = d.building.bracing;
  need(br && br.roof && br.walls && br.purlinTies && Array.isArray(br.roof.bays) && br.conn && br.conn.bolt, 'bracing');
  need(pu.splice && Number.isFinite(pu.splice.plateT), 'purlins.splice');
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
