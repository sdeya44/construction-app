// ============================================================================
// שכבת אחסון מקומי - IndexedDB (דרך idb-keyval)
// כל הנתונים נשמרים במחשב המקומי בלבד. אין שרת ואין ענן.
// ============================================================================

import { get, set, del, keys, createStore } from 'idb-keyval';
import type { Project, ProjectSummary } from '../types';

const store = createStore('quantity-calculator-db', 'projects');

const KEY_PREFIX = 'project:';
const LAST_OPENED = 'qc:lastOpenedProjectId';

export async function saveProject(project: Project): Promise<void> {
  await set(KEY_PREFIX + project.id, project, store);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return get<Project>(KEY_PREFIX + id, store);
}

export async function deleteProject(id: string): Promise<void> {
  await del(KEY_PREFIX + id, store);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const allKeys = (await keys(store)) as string[];
  const ids = allKeys.filter((k) => typeof k === 'string' && k.startsWith(KEY_PREFIX));
  const items: ProjectSummary[] = [];
  for (const k of ids) {
    const p = await get<Project>(k, store);
    if (p) {
      items.push({
        id: p.id,
        name: p.name,
        projectNumber: p.projectNumber,
        updatedAt: p.updatedAt,
      });
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

export function setLastOpened(id: string) {
  localStorage.setItem(LAST_OPENED, id);
}

export function getLastOpened(): string | null {
  return localStorage.getItem(LAST_OPENED);
}
