/**
 * שמירה אוטומטית לקובץ בתיקייה שהמשתמש בוחר (Chrome/Edge — File System Access API), וגיבוי.
 * ידית הקובץ נשמרת בזיכרון לכל פרויקט; בדפדפן ללא תמיכה — הורדת קובץ.
 */
import type { Project } from '../model/types';
import { toFileJson } from '../model/migrate';
import { downloadText, safeFileName } from './files';

type Handle = { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>; name: string; queryPermission?: (o: object) => Promise<string>; requestPermission?: (o: object) => Promise<string> };
const handles = new Map<string, Handle>();
export const fsSupported = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;
export const linkedName = (projectId: string) => handles.get(projectId)?.name ?? null;

const BK = (id: string) => `ksp-backup-${id}`;
export function lastBackup(projectId: string): number { try { return Number(localStorage.getItem(BK(projectId)) || 0); } catch { return 0; } }
function markBackup(projectId: string) { try { localStorage.setItem(BK(projectId), String(Date.now())); } catch { /* */ } }

/** בחירת קובץ יעד ושמירה ראשונה; לאחר מכן כל שמירה אוטומטית נכתבת גם לקובץ */
export async function linkToFile(p: Project): Promise<string | null> {
  if (!fsSupported()) { backupDownload(p); return null; }
  const h = await (window as unknown as { showSaveFilePicker: (o: object) => Promise<Handle> }).showSaveFilePicker({
    suggestedName: `${safeFileName(p.meta.name)}.ksp.json`,
    types: [{ description: 'פרויקט KAYAN STEEL', accept: { 'application/json': ['.json'] } }],
  });
  handles.set(p.id, h);
  await writeLinked(p);
  return h.name;
}

/** כתיבה לקובץ המקושר (אם יש); מחזיר true אם נכתב */
export async function writeLinked(p: Project): Promise<boolean> {
  const h = handles.get(p.id);
  if (!h) return false;
  try {
    if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') return false;
    const w = await h.createWritable();
    await w.write(toFileJson(p));
    await w.close();
    markBackup(p.id);
    return true;
  } catch { return false; }
}

export function backupDownload(p: Project) {
  downloadText(`${safeFileName(p.meta.name)}_${new Date().toISOString().slice(0, 10)}.ksp.json`, toFileJson(p));
  markBackup(p.id);
}

/** תזכורת גיבוי: לא גובה לקובץ מעולם או לפני יותר מ-3 ימים, ויש בפרויקט תוכן שעודכן מאז */
export function needsBackup(p: Project): boolean {
  if (handles.has(p.id)) return false;
  const last = lastBackup(p.id);
  const upd = Date.parse(p.meta.updatedAt || '') || 0;
  return upd > last && Date.now() - last > 3 * 864e5 && Date.now() - (Date.parse(p.meta.createdAt || '') || Date.now()) > 30 * 60e3;
}
