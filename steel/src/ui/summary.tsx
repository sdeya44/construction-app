import { useState, type ReactNode } from 'react';
import type { ValidationIssue } from '../model/types';
import { store } from '../store';

/**
 * תשתית "סיכום קודם, עריכה בלחיצה" (1.42): כל תפריט נפתח במסך אחד — התראות בראש, כרטיסי סיכום (קבוצות במקום מופעים),
 * ועריכה בלשוניות (נושא אחד = מסך אחד) עם "← חזרה". אותה שפה בכל התפריטים ובאשף החיבורים.
 */

export interface Pill { text: string; tone?: 'ok' | 'warn' | 'bad' | 'muted' }

export function Pills({ items }: { items: Pill[] }) {
  return <div className="sum-pills">{items.map((p, i) => <span key={i} className={`sum-pill ${p.tone ?? 'ok'}`}>{p.text}</span>)}</div>;
}

/** כרטיס סיכום: כותרת, שורת ערכים, תגיות מצב ולחצן עריכה */
export function SumCard({ title, sub, pills, onEdit, editLabel = 'ערוך', hi, badge, testId, children }: {
  title: ReactNode; sub?: ReactNode; pills?: Pill[]; onEdit?: () => void; editLabel?: string; hi?: boolean; badge?: Pill; testId?: string; children?: ReactNode;
}) {
  return (
    <div className={`sum-card${hi ? ' hi' : ''}`} data-testid={testId}>
      <div className="sum-main">
        <div className="sum-title">{title}{badge && <span className={`sum-pill ${badge.tone ?? 'warn'}`}>{badge.text}</span>}</div>
        {sub && <div className="sum-sub">{sub}</div>}
        {pills && pills.length > 0 && <Pills items={pills} />}
        {children}
      </div>
      {onEdit && <button className="btn small sum-edit" data-testid={testId ? `${testId}-edit` : undefined} onClick={onEdit}>{editLabel}</button>}
    </div>
  );
}

/** התראות בראש המסך — רק הרלוונטיות לתפריט; לחיצה בוחרת את האלמנט */
export function PanelAlerts({ issues, okText, testId }: { issues: ValidationIssue[]; okText?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const bad = issues.filter((i) => i.severity !== 'info');
  if (!bad.length) return okText ? <div className="sum-alert ok" data-testid={testId}>✓ {okText}</div> : null;
  const shown = open ? bad : bad.slice(0, 2);
  return (
    <div className={`sum-alert ${bad.some((i) => i.severity === 'error') ? 'bad' : 'warn'}`} data-testid={testId}>
      {shown.map((i, k) => <div key={k} className="sum-alert-row" onClick={() => i.elementId && store.select([i.elementId])} style={{ cursor: i.elementId ? 'pointer' : undefined }}>⚠ {i.message}</div>)}
      {bad.length > 2 && <button className="link-btn" onClick={() => setOpen(!open)}>{open ? 'פחות' : `ועוד ${bad.length - 2}…`}</button>}
    </div>
  );
}

export interface EditorTab { key: string; label: string; render: () => ReactNode; hidden?: boolean }

/** עורך בלשוניות: כותרת + חזרה, לשונית לכל נושא (ללא גלילה ארוכה) */
export function TabbedEditor({ title, crumb, onBack, tabs, testId, footer, initial }: {
  title: ReactNode; crumb?: ReactNode; onBack?: () => void; tabs: EditorTab[]; testId?: string; footer?: ReactNode; initial?: string;
}) {
  const vis = tabs.filter((t) => !t.hidden);
  const [tab, setTab] = useState(initial && vis.some((t) => t.key === initial) ? initial : vis[0]?.key);
  const cur = vis.find((t) => t.key === tab) ?? vis[0];
  return (
    <div className="tab-ed" data-testid={testId}>
      {(onBack || title) && <div className="tab-ed-hd">
        {crumb && <span className="tab-ed-crumb">{crumb} ›</span>}<b>{title}</b>
        {onBack && <button className="btn small" style={{ marginInlineStart: 'auto' }} data-testid={testId ? `${testId}-back` : undefined} onClick={onBack}>← חזרה</button>}
      </div>}
      {vis.length > 1 && <div className="tab-ed-tabs" role="tablist">
        {vis.map((t) => <button key={t.key} role="tab" aria-selected={t.key === cur?.key} className={`tab-ed-tab${t.key === cur?.key ? ' on' : ''}`} data-testid={testId ? `${testId}-tab-${t.key}` : undefined} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>}
      <div className="tab-ed-body">{cur?.render()}</div>
      {footer && <div className="tab-ed-ft">{footer}</div>}
    </div>
  );
}

/** קיבוץ פריטים זהים לפי מפתח חתימה, בסדר ההופעה */
export function groupBy<T>(items: T[], sig: (t: T) => string): { key: string; items: T[] }[] {
  const m = new Map<string, T[]>();
  for (const it of items) { const k = sig(it); const a = m.get(k); if (a) a.push(it); else m.set(k, [it]); }
  return [...m].map(([key, items2]) => ({ key, items: items2 }));
}

/** רשימה מקופלת: N ראשונים + "פתח רשימה" */
export function Collapsed<T>({ items, render, first = 3, label = 'פתח רשימה', testId }: { items: T[]; render: (t: T, i: number) => ReactNode; first?: number; label?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, first);
  return (
    <div className="sum-list" data-testid={testId}>
      {shown.map(render)}
      {items.length > first && <button className="link-btn" data-testid={testId ? `${testId}-more` : undefined} onClick={() => setOpen(!open)}>{open ? 'קפל ▴' : `ועוד ${items.length - first} — ${label} ▾`}</button>}
    </div>
  );
}
