// ============================================================================
// ניהול המצב המרכזי (Zustand) + שמירה אוטומטית + Undo
// ============================================================================

import { create } from 'zustand';
import type { CalcRow, PageScale, PlanPage, Project, ProjectSummary, Section } from '../types';
import { SCHEMA_VERSION } from '../types';
import * as db from './db';
import { createEmptyProject, createSampleProject, uid } from './factory';

type Producer = (draft: Project) => void;

interface UIState {
  selectedPageId: string | null;
}

interface StoreState {
  project: Project | null;
  list: ProjectSummary[];
  ui: UIState;
  history: string[]; // snapshots ל-Undo
  saving: boolean;
  toast: string | null;

  // lifecycle
  init: () => Promise<void>;
  refreshList: () => Promise<void>;
  newProject: (meta?: Partial<Project>) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  importProject: (json: unknown) => Promise<void>;
  saveNow: () => Promise<void>;

  // editing
  mutate: (fn: Producer) => void;
  updateMeta: (partial: Partial<Project>) => void;
  undo: () => void;

  // sections
  addSection: (s?: Partial<Section>) => string;
  updateSection: (id: string, partial: Partial<Section>) => void;
  deleteSection: (id: string) => void;

  // rows
  addRow: (r: Partial<CalcRow>) => string;
  updateRow: (id: string, partial: Partial<CalcRow>) => void;
  deleteRow: (id: string) => void;
  duplicateRow: (id: string) => void;

  // pages
  addPages: (pages: PlanPage[]) => void;
  removePage: (id: string) => void;
  setPageScale: (id: string, scale: PageScale | undefined) => void;
  selectPage: (id: string | null) => void;

  showToast: (msg: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const HISTORY_LIMIT = 50;

export const useStore = create<StoreState>((set, get) => {
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), 600);
  }

  function pushHistory() {
    const { project, history } = get();
    if (!project) return;
    const snap = JSON.stringify(project);
    const next = [...history, snap];
    if (next.length > HISTORY_LIMIT) next.shift();
    set({ history: next });
  }

  function applyMutation(fn: Producer) {
    const { project } = get();
    if (!project) return;
    pushHistory();
    const draft: Project = JSON.parse(JSON.stringify(project));
    fn(draft);
    draft.updatedAt = Date.now();
    set({ project: draft });
    scheduleSave();
  }

  return {
    project: null,
    list: [],
    ui: { selectedPageId: null },
    history: [],
    saving: false,
    toast: null,

    async init() {
      await get().refreshList();
      const lastId = db.getLastOpened();
      const { list } = get();
      if (lastId && list.some((p) => p.id === lastId)) {
        await get().openProject(lastId);
      } else if (list.length === 0) {
        // טעינה ראשונה - יוצרים פרויקט דוגמה
        const sample = createSampleProject();
        await db.saveProject(sample);
        db.setLastOpened(sample.id);
        await get().refreshList();
        set({ project: sample, history: [] });
      } else {
        await get().openProject(list[0].id);
      }
    },

    async refreshList() {
      set({ list: await db.listProjects() });
    },

    async newProject(meta) {
      const p = createEmptyProject(meta);
      await db.saveProject(p);
      db.setLastOpened(p.id);
      await get().refreshList();
      set({ project: p, history: [], ui: { selectedPageId: null } });
      get().showToast('פרויקט חדש נוצר');
    },

    async openProject(id) {
      const p = await db.loadProject(id);
      if (!p) return;
      db.setLastOpened(id);
      const firstPage = p.pages[0]?.id ?? null;
      set({ project: p, history: [], ui: { selectedPageId: firstPage } });
    },

    async deleteProject(id) {
      await db.deleteProject(id);
      if (get().project?.id === id) {
        set({ project: null });
      }
      await get().refreshList();
      const { list } = get();
      if (!get().project && list.length) await get().openProject(list[0].id);
      get().showToast('הפרויקט נמחק');
    },

    async importProject(json) {
      const data = json as Partial<Project>;
      if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) {
        get().showToast('קובץ לא תקין');
        return;
      }
      const imported: Project = {
        ...createEmptyProject(),
        ...data,
        id: uid('prj'),
        schemaVersion: SCHEMA_VERSION,
        updatedAt: Date.now(),
        sections: data.sections ?? [],
        rows: data.rows ?? [],
        pages: data.pages ?? [],
      } as Project;
      await db.saveProject(imported);
      db.setLastOpened(imported.id);
      await get().refreshList();
      set({ project: imported, history: [], ui: { selectedPageId: imported.pages[0]?.id ?? null } });
      get().showToast('הפרויקט יובא בהצלחה');
    },

    async saveNow() {
      const { project } = get();
      if (!project) return;
      set({ saving: true });
      await db.saveProject(project);
      await get().refreshList();
      set({ saving: false });
    },

    mutate(fn) {
      applyMutation(fn);
    },

    updateMeta(partial) {
      applyMutation((d) => Object.assign(d, partial));
    },

    undo() {
      const { history } = get();
      if (history.length === 0) {
        get().showToast('אין פעולה לביטול');
        return;
      }
      const prev = history[history.length - 1];
      const restored: Project = JSON.parse(prev);
      set({ project: restored, history: history.slice(0, -1) });
      scheduleSave();
      get().showToast('הפעולה בוטלה');
    },

    addSection(s) {
      const id = uid('sec');
      applyMutation((d) => {
        d.sections.push({
          id,
          code: s?.code ?? '',
          name: s?.name ?? 'סעיף חדש',
          unit: s?.unit ?? 'מ״ק',
          description: s?.description ?? '',
        });
      });
      return id;
    },

    updateSection(id, partial) {
      applyMutation((d) => {
        const sec = d.sections.find((x) => x.id === id);
        if (sec) Object.assign(sec, partial);
      });
    },

    deleteSection(id) {
      applyMutation((d) => {
        d.sections = d.sections.filter((x) => x.id !== id);
        // שורות שהיו משויכות - נשארות אך ללא סעיף
        d.rows.forEach((r) => {
          if (r.sectionId === id) r.sectionId = null;
        });
      });
    },

    addRow(r) {
      const id = uid('row');
      applyMutation((d) => {
        d.rows.push({
          id,
          sectionId: r.sectionId ?? null,
          description: r.description ?? '',
          page: r.page ?? '',
          type: r.type ?? 'box_volume',
          length: r.length ?? null,
          width: r.width ?? null,
          height: r.height ?? null,
          count: r.count ?? 1,
          coefficient: r.coefficient ?? 1,
          unit: r.unit ?? 'מ״ק',
          note: r.note ?? '',
          kind: r.kind ?? 'normal',
          measuredValue: r.measuredValue,
          createdAt: Date.now(),
        });
      });
      return id;
    },

    updateRow(id, partial) {
      applyMutation((d) => {
        const row = d.rows.find((x) => x.id === id);
        if (row) Object.assign(row, partial);
      });
    },

    deleteRow(id) {
      applyMutation((d) => {
        d.rows = d.rows.filter((x) => x.id !== id);
      });
    },

    duplicateRow(id) {
      applyMutation((d) => {
        const idx = d.rows.findIndex((x) => x.id === id);
        if (idx === -1) return;
        const copy: CalcRow = { ...JSON.parse(JSON.stringify(d.rows[idx])), id: uid('row'), createdAt: Date.now() };
        copy.description = copy.description + ' (העתק)';
        d.rows.splice(idx + 1, 0, copy);
      });
    },

    addPages(pages) {
      applyMutation((d) => {
        d.pages.push(...pages);
      });
      if (!get().ui.selectedPageId && pages.length) {
        set({ ui: { selectedPageId: pages[0].id } });
      }
    },

    removePage(id) {
      applyMutation((d) => {
        d.pages = d.pages.filter((p) => p.id !== id);
      });
      if (get().ui.selectedPageId === id) {
        set({ ui: { selectedPageId: get().project?.pages[0]?.id ?? null } });
      }
    },

    setPageScale(id, scale) {
      applyMutation((d) => {
        const page = d.pages.find((p) => p.id === id);
        if (page) page.scale = scale;
      });
    },

    selectPage(id) {
      set({ ui: { selectedPageId: id } });
    },

    showToast(msg) {
      set({ toast: msg });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null });
      }, 2600);
    },
  };
});
