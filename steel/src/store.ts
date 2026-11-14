import { useSyncExternalStore } from 'react';
import { History } from './commands/history';
import { CommandError, type Command } from './commands/commands';
import { generate } from './geometry/generate';
import { newProject } from './model/defaults';
import type { DerivedModel, MemberKind, Project } from './model/types';
import { saveProject } from './persist/idb';

export type ViewName = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top';
export type Tool = 'select' | 'measure';

export interface ViewState {
  projection: 'ortho' | 'persp';
  render: 'solid' | 'wire';
  grid: boolean;
  dims: boolean;
  labels: boolean;
  split: boolean;
  clip: { enabled: boolean; axis: 'X' | 'Y' | 'Z'; pos: number; flip: boolean };
}

export interface Toast { id: number; kind: 'ok' | 'error' | 'info'; text: string }

export interface AppState {
  project: Project;
  derived: DerivedModel;
  selection: string[];
  hidden: string[];
  isolated: string[] | null;
  filter: Record<MemberKind, boolean>;
  tool: Tool;
  view: ViewState;
  toasts: Toast[];
  saveState: 'saved' | 'dirty' | 'saving' | 'error';
  canUndo: boolean; canRedo: boolean;
  undoLabel?: string; redoLabel?: string;
  /** חיבור פתוח בעורך החיבורים */
  activeConn: string | null;
  measure: { a?: { x: number; y: number; z: number }; b?: { x: number; y: number; z: number } };
  revision: number;
}

type Listener = () => void;

class Store {
  private history: History;
  private listeners = new Set<Listener>();
  private toastNo = 0;
  private saveTimer: number | undefined;
  state: AppState;

  constructor(p: Project) {
    this.history = new History(p);
    this.state = {
      project: p, derived: generate(p), selection: [], hidden: [], isolated: null,
      filter: { column: true, rafter: true, beam: true, brace: true, purlin: true, cleat: true, plate: true, bolt: true, anchor: true },
      tool: 'select',
      view: {
        projection: 'persp', render: 'solid', grid: true, dims: true, labels: true, split: false,
        clip: { enabled: false, axis: 'Y', pos: 0, flip: false },
      },
      toasts: [], saveState: 'saved', canUndo: false, canRedo: false, measure: {}, revision: 0, activeConn: null,
    };
  }

  subscribe = (l: Listener) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  private emit() { for (const l of this.listeners) l(); }
  set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.emit();
  }

  private syncHistory(project: Project, dirty = true) {
    const derived = generate(project);
    const exists = new Set(derived.members.map((m) => m.id));
    this.set({
      project, derived,
      selection: this.state.selection.filter((id) => exists.has(id)),
      canUndo: this.history.canUndo, canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel, redoLabel: this.history.redoLabel,
      saveState: dirty ? 'dirty' : this.state.saveState,
    });
    if (dirty) this.scheduleSave();
  }

  /** מריץ פקודה; כשל מוצג כהודעה והמודל אינו משתנה. מחזיר true בהצלחה. */
  exec(cmd: Command): boolean {
    try {
      const p = this.history.exec(cmd);
      this.syncHistory(p);
      return true;
    } catch (e) {
      const msg = e instanceof CommandError ? e.message : `שגיאה: ${(e as Error).message}`;
      this.toast('error', msg);
      return false;
    }
  }
  undo() { const l = this.history.undo(); if (l) { this.syncHistory(this.history.current); this.toast('info', `בוטל: ${l}`); } }
  redo() { const l = this.history.redo(); if (l) { this.syncHistory(this.history.current); this.toast('info', `בוצע שוב: ${l}`); } }

  loadProject(p: Project, dirty = false) {
    this.history.reset(p);
    this.set({ selection: [], hidden: [], isolated: null, measure: {} });
    this.syncHistory(p, dirty);
    if (!dirty) this.set({ saveState: 'saved' });
  }

  select(ids: string[], mode: 'replace' | 'toggle' | 'add' = 'replace') {
    let sel: string[];
    if (mode === 'replace') sel = ids;
    else if (mode === 'add') sel = [...new Set([...this.state.selection, ...ids])];
    else {
      const s = new Set(this.state.selection);
      for (const id of ids) { if (s.has(id)) s.delete(id); else s.add(id); }
      sel = [...s];
    }
    this.set({ selection: sel });
  }

  setView(patch: Partial<ViewState>) { this.set({ view: { ...this.state.view, ...patch } }); }

  toast(kind: Toast['kind'], text: string) {
    const t = { id: ++this.toastNo, kind, text };
    this.set({ toasts: [...this.state.toasts, t] });
    setTimeout(() => this.set({ toasts: this.state.toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 7000 : 3500);
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow('שמירה אוטומטית'), 800);
  }
  async saveNow(reason = 'שמירה'): Promise<boolean> {
    window.clearTimeout(this.saveTimer);
    this.set({ saveState: 'saving' });
    try {
      await saveProject(this.state.project, reason);
      this.set({ saveState: 'saved' });
      return true;
    } catch (e) {
      this.set({ saveState: 'error' });
      this.toast('error', `השמירה נכשלה: ${(e as Error).message}`);
      return false;
    }
  }
}

export const store = new Store(newProject());

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.state), () => sel(store.state));
}

declare global { interface Window { __ksp?: any } }
