import type { Project } from '../model/types';
import { assertProject, migrate } from '../model/migrate';

/**
 * שמירה מקומית Offline-first ב-IndexedDB.
 * projects: הפרויקט הנוכחי לכל מזהה. snapshots: גרסאות קודמות לשחזור (עד MAX_SNAPSHOTS לפרויקט).
 * כתיבה מבוצעת בטרנזקציה אחת (פרויקט + גרסה), כך שכשל באמצע אינו משאיר מצב חלקי.
 */
const DB = 'kayan-steel-pro';
const VER = 1;
const MAX_SNAPSHOTS = 30;

export interface ProjectSummary { id: string; name: string; number: string; updatedAt: string }
export interface SnapshotInfo { key: number; projectId: string; savedAt: string; reason: string }

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('snapshots')) {
        const s = db.createObjectStore('snapshots', { keyPath: 'key', autoIncrement: true });
        s.createIndex('byProject', 'projectId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function saveProject(p: Project, reason = 'שמירה'): Promise<void> {
  assertProject(p);
  const db = await open();
  const t = db.transaction(['projects', 'snapshots', 'kv'], 'readwrite');
  const json = JSON.stringify(p);
  t.objectStore('projects').put({ id: p.id, json, name: p.meta.name, number: p.meta.number, updatedAt: p.meta.updatedAt });
  t.objectStore('snapshots').add({ projectId: p.id, savedAt: new Date().toISOString(), reason, json });
  t.objectStore('kv').put(p.id, 'lastProject');
  await done(t);
  await pruneSnapshots(db, p.id);
  db.close();
}

async function pruneSnapshots(db: IDBDatabase, projectId: string) {
  const t = db.transaction('snapshots', 'readwrite');
  const keys = (await req(t.objectStore('snapshots').index('byProject').getAllKeys(projectId))) as number[];
  keys.sort((a, b) => a - b);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))) t.objectStore('snapshots').delete(k);
  await done(t);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await open();
  const all = (await req(db.transaction('projects').objectStore('projects').getAll())) as any[];
  db.close();
  return all.map(({ id, name, number, updatedAt }) => ({ id, name, number, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** טוען פרויקט; אם הרשומה פגומה — זורק שגיאה, והמשתמש יכול לשחזר גרסה. */
export async function loadProject(id: string): Promise<Project> {
  const db = await open();
  const rec = (await req(db.transaction('projects').objectStore('projects').get(id))) as any;
  db.close();
  if (!rec) throw new Error('הפרויקט לא נמצא');
  return migrate(JSON.parse(rec.json));
}

export async function lastProjectId(): Promise<string | null> {
  const db = await open();
  const id = (await req(db.transaction('kv').objectStore('kv').get('lastProject'))) as string | undefined;
  db.close();
  return id ?? null;
}

export async function listSnapshots(projectId: string): Promise<SnapshotInfo[]> {
  const db = await open();
  const all = (await req(db.transaction('snapshots').objectStore('snapshots').index('byProject').getAll(projectId))) as any[];
  db.close();
  return all.map(({ key, projectId: pid, savedAt, reason }) => ({ key, projectId: pid, savedAt, reason })).reverse();
}

export async function loadSnapshot(key: number): Promise<Project> {
  const db = await open();
  const rec = (await req(db.transaction('snapshots').objectStore('snapshots').get(key))) as any;
  db.close();
  if (!rec) throw new Error('הגרסה לא נמצאה');
  return migrate(JSON.parse(rec.json));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await open();
  const t = db.transaction(['projects', 'snapshots'], 'readwrite');
  t.objectStore('projects').delete(id);
  const keys = (await req(t.objectStore('snapshots').index('byProject').getAllKeys(id))) as number[];
  for (const k of keys) t.objectStore('snapshots').delete(k);
  await done(t);
  db.close();
}
