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
  reset(p: Project) { this.past = []; this.future = []; this.current = p; this.txMark = null; }

  // ---- 1.57: טרנזקציה של אשף — שינוי חי, אישור = פעולת Undo אחת, ביטול = חזרה למצב שלפני ----
  private txMark: number | null = null;
  get inTx() { return this.txMark !== null; }
  /** מספר הצעדים שבוצעו מאז פתיחת הטרנזקציה */
  get txSteps() { return this.txMark === null ? 0 : Math.max(0, this.past.length - this.txMark); }
  txBegin() { this.txMark = this.past.length; }
  /** אישור: כל הצעדים מאז הפתיחה — צעד אחד בהיסטוריה (עם התווית הנתונה) */
  txCommit(label: string) {
    const m = this.txMark; this.txMark = null;
    if (m === null) return;
    const mk = Math.min(m, this.past.length);
    if (this.past.length - mk > 1) this.past = [...this.past.slice(0, mk), { p: this.past[mk].p, label }];
    else if (this.past.length - mk === 1) this.past[mk] = { ...this.past[mk], label };
  }
  /** ביטול: חזרה למצב שלפני פתיחת הטרנזקציה, בלי אפשרות "בצע שוב" לשינויים שבוטלו */
  txCancel(): boolean {
    const m = this.txMark; this.txMark = null;
    if (m === null) return false;
    const mk = Math.min(m, this.past.length);
    if (this.past.length === mk) return false;
    this.current = this.past[mk].p;
    this.past = this.past.slice(0, mk);
    this.future = [];
    return true;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past[this.past.length - 1]?.label; }
  get redoLabel() { return this.future[this.future.length - 1]?.label; }
}
