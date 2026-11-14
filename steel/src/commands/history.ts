import type { Project } from '../model/types';
import { CommandError, type Command } from './commands';

function sameModel(a: Project, b: Project) {
  const strip = (p: Project) => JSON.stringify({ ...p, meta: { ...p.meta, updatedAt: '' } });
  return strip(a) === strip(b);
}

/** היסטוריית מצבים לא משתנים. כל פקודה שמצליחה דוחפת מצב חדש. */
export class History {
  private past: { p: Project; label: string }[] = [];
  private future: { p: Project; label: string }[] = [];
  constructor(public current: Project, private limit = 200) {}

  exec(cmd: Command): Project {
    if (this.current.revision?.locked && !cmd.allowWhenLocked) {
      throw new CommandError(`מהדורה ${this.current.revision.current} מאושרת ונעולה. כדי לשנות — פתח מהדורה חדשה.`);
    }
    const next = cmd.run(this.current);
    // פקודה שאינה משנה דבר אינה נכנסת להיסטוריה
    if (sameModel(next, this.current)) return this.current;
    next.meta = { ...next.meta, updatedAt: new Date().toISOString() };
    this.past.push({ p: this.current, label: cmd.label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }
  undo(): string | null {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push({ p: this.current, label: e.label });
    this.current = e.p;
    return e.label;
  }
  redo(): string | null {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push({ p: this.current, label: e.label });
    this.current = e.p;
    return e.label;
  }
  reset(p: Project) { this.past = []; this.future = []; this.current = p; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past[this.past.length - 1]?.label; }
  get redoLabel() { return this.future[this.future.length - 1]?.label; }
}
