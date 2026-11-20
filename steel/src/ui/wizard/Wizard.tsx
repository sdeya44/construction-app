import { useEffect, type ReactNode } from 'react';
import { store, useStore } from '../../store';
import type { ValidationIssue as Issue } from '../../model/types';
import { setMeta } from '../../commands/commands';
import { stepMarks } from '../steps';

/**
 * 1.57: KAYAN Unified Engineering Wizard System — רכיבים משותפים.
 * כל אשף בנוי מהם, באותו סדר: סוג → "השינויים יחולו על" → 1 מיקום · 2 גיאומטריה · 3 חתך ומחברים → פעולות.
 * העיצוב — רק מהטוקנים --wz-* (app.css). אין עיצוב עצמאי לאשף.
 */

// ---------------- סוג ----------------
export interface WzType<K extends string> { key: K; title: string; sub?: string; pic?: ReactNode; testId?: string; disabled?: string }
export function WizardTypeSelector<K extends string>({ types, value, onPick, label, extra, vertical }: { types: WzType<K>[]; value: K | null; onPick: (k: K) => void; label: string; extra?: ReactNode; vertical?: boolean }) {
  return (
    <div className={`wz-types${vertical ? ' v' : ''}`} role="radiogroup" aria-label={label} style={{ ['--n' as string]: types.length }}>
      {types.map((t) => (
        <button key={t.key} role="radio" aria-checked={value === t.key} disabled={!!t.disabled} title={t.disabled ?? t.sub}
          className={`wz-type${value === t.key ? ' on' : ''}`} onClick={() => onPick(t.key)} data-testid={t.testId}>
          {t.pic}<b>{t.title}</b>{t.sub && <small>{t.sub}</small>}
        </button>
      ))}
      {extra && <div className="wz-type-x">{extra}</div>}
    </div>
  );
}

// ---------------- תחולה ----------------
export interface WzScope<K extends string> { key: K; title: string; count?: number; disabled?: string; testId?: string }
export function WizardScopeSelector<K extends string>({ scopes, value, onPick, after, note }: { scopes: WzScope<K>[]; value: K; onPick: (k: K) => void; after?: ReactNode; note?: ReactNode }) {
  return (
    <div className="wz-scope" role="radiogroup" aria-label="השינויים יחולו על" data-testid="ks-scope">
      <span className="wz-lbl">השינויים יחולו על:</span>
      {scopes.map((o) => (
        <button key={o.key} role="radio" aria-checked={value === o.key} disabled={!!o.disabled} title={o.disabled}
          className={`wz-sc${value === o.key ? ' on' : ''}`} onClick={() => onPick(o.key)} data-testid={o.testId}>
          {o.title}{o.count != null && <i>{o.count}</i>}
        </button>
      ))}
      {after}
      {note && <span className="wz-scope-note" data-testid="wz-scope-note">{note}</span>}
    </div>
  );
}

// ---------------- שלוש קבוצות ההגדרות ----------------
export type WzSec = 'loc' | 'geo' | 'conn';
export const WZ_SECS: { k: WzSec; n: number; t: string }[] = [{ k: 'loc', n: 1, t: 'מיקום במבנה' }, { k: 'geo', n: 2, t: 'גיאומטריה' }, { k: 'conn', n: 3, t: 'חתך ומחברים' }];
export function WizardNavigation({ value, onPick, subs }: { value: WzSec; onPick: (k: WzSec) => void; subs: Partial<Record<WzSec, string>> }) {
  return (
    <div className="wz-secs" role="tablist">
      {WZ_SECS.map((s) => (
        <button key={s.k} role="tab" aria-selected={value === s.k} className={`wz-sec${value === s.k ? ' on' : ''}`} onClick={() => onPick(s.k)} data-testid={`ks-sec-${s.k}`}>
          <span className="wz-n">{s.n}</span><span className="wz-st"><b>{s.t}</b><small>{subs[s.k] ?? ''}</small></span>
        </button>
      ))}
    </div>
  );
}
export function WizardSection({ id, children, className }: { id: WzSec; children: ReactNode; className?: string }) {
  return <div className={`wz-panel${className ? ` ${className}` : ''}`} data-testid={`ks-${id}`} role="tabpanel">{children}</div>;
}

// ---------------- תקינות ----------------
export function WizardValidation({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <div className="wz-valid ok" data-testid="wz-valid"><i />ללא הערות לרכיב</div>;
  const err = issues.filter((i) => i.severity === 'error').length, warn = issues.filter((i) => i.severity === 'warning').length;
  return (
    <details className={`wz-valid ${err ? 'err' : 'warn'}`} data-testid="wz-valid">
      <summary><i />{err ? `${err} שגיאות` : ''}{err && warn ? ' · ' : ''}{warn ? `${warn} אזהרות` : ''}{!err && !warn ? `${issues.length} הערות` : ''}</summary>
      <ul>{issues.slice(0, 12).map((i, k) => <li key={k} className={i.severity}>{i.message}</li>)}</ul>
    </details>
  );
}

// ---------------- פעולות + טרנזקציה ----------------
/** פתיחת האשף פותחת טרנזקציה; סגירה (✕ או מעבר לרכיב אחר) = אישור. שינוי מוצג חי. */
export function useWizardTx(label: string) {
  useEffect(() => {
    store.txBegin();
    return () => { store.txCommit(label); };
  }, [label]);
}
/** 1.59: אישור באשף מסמן את שלב העבודה כ"הושלם" (נשמר בפרויקט, באותה פעולת Undo) */
export function markStepDone(step: string) {
  const st = store.state;
  const marks = stepMarks(st.project, st.derived);
  if (marks[step] === 'done' && st.project.meta.steps) return;
  try { store.exec(setMeta({ steps: { ...marks, [step]: 'done' } })); } catch { /* מהדורה נעולה — אין סימון */ }
}
export function WizardActions({ label, onClose, children, step, create }: { label: string; onClose: () => void; children?: ReactNode; step?: string | null; /** 1.60: מצב הוספה — "הוספה למבנה" / "ביטול ההוספה" */ create?: boolean }) {
  const steps = useStore((s) => s.txSteps ?? 0);
  return (
    <div className="wz-actions" data-testid="wz-actions">
      <span className="wz-live"><i />{steps ? `${steps} שינויים — מוצגים במודל, נשמרים באישור` : 'כל שינוי מוצג מיד במודל'}</span>
      {children}
      <span className="sp" />
      <button className="wz-btn" disabled={!steps} onClick={() => store.txUndo()} data-testid="wz-undo" title="ביטול הצעד האחרון בתוך האשף">↶ שחזור</button>
      <button className="wz-btn" onClick={() => { store.txCancel(); onClose(); }} data-testid="wz-cancel" title={create ? 'הרכיב לא יתווסף — המודל חוזר למצב שלפני' : 'ביטול כל השינויים מאז פתיחת האשף'}>{create ? 'ביטול ההוספה' : 'ביטול'}</button>
      <button className="wz-btn pri" onClick={() => { if (step) markStepDone(step); store.txCommit(label); onClose(); }} data-testid="wz-ok" title={step ? 'שמירה וסימון השלב כהושלם' : undefined}>{create ? 'הוספה למבנה' : 'אישור'}</button>
    </div>
  );
}

// ---------------- העתקת הגדרות ----------------
const clip = new Map<string, unknown>();
export function wizardCopy(family: string, payload: unknown) { clip.set(family, structuredClone(payload)); store.toast('info', 'ההגדרות הועתקו'); }
export function wizardClip<T>(family: string): T | undefined { return clip.get(family) as T | undefined; }
