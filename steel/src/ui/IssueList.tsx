import { useState } from 'react';
import { applyIssueFixes, dismissIssues } from '../commands/commands';
import { ISSUE_LABEL, issueKey } from '../model/issues';
import type { Severity, ValidationIssue } from '../model/types';
import { store, useStore } from '../store';

const SEV_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const ic = (s: Severity) => (s === 'error' ? '✕' : s === 'warning' ? '!' : 'i');
const hasFix = (i: ValidationIssue) => !!(i.fix || i.cleatFix);
const fixLabel = (i: ValidationIssue) => i.fix?.label ?? i.cleatFix?.label ?? '';

function select(i: ValidationIssue) {
  if (!i.elementId) return;
  store.select([i.elementId]);
  setTimeout(() => window.__ksp?.viewport?.fitSelection(), 0);
}

/**
 * רשימת הודעות מקובצת לפי סוג: כותרת עם מספר, "תקן הכל" כשיש הצעות, "הסתר סוג" (לא לשגיאות), ופתיחה לפריטים.
 * כל פריט: מעבר לאלמנט, תיקון בלחיצה, הסתרה. בתחתית — הודעות מוסתרות עם שחזור.
 */
export function IssueList({ issues, testId }: { issues: ValidationIssue[]; testId?: string }) {
  const hidden = useStore((s) => s.derived.hiddenIssues) ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showHidden, setShowHidden] = useState(false);
  /** 1.44: הודעות "לידיעה" בסעיף מקופל — שגיאות ואזהרות למעלה */
  const [showInfo, setShowInfo] = useState(false);
  const groups = new Map<string, ValidationIssue[]>();
  for (const i of issues) {
    const k = `${i.severity}|${i.code}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  const sorted = [...groups].sort(([a], [b]) => SEV_ORDER[a.split('|')[0] as Severity] - SEV_ORDER[b.split('|')[0] as Severity] || (groups.get(b)!.length - groups.get(a)!.length));
  const fixable = issues.filter(hasFix);
  return (
    <div data-testid={testId}>
      {fixable.length > 1 && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="btn primary small" data-testid="fix-all" onClick={() => store.exec(applyIssueFixes(fixable))}>תקן הכל בלחיצה ({fixable.length})</button>
          <span className="hint" style={{ margin: 0 }}>ביטול (Ctrl+Z) מחזיר את כל התיקונים</span>
        </div>
      )}
      {!issues.length && <div className="hint" data-testid="no-issues">אין הודעות פתוחות.</div>}
      {issues.length > 0 && <div className="sev-sum" data-testid="sev-sum">
        {(['error', 'warning'] as Severity[]).map((sv) => { const n = issues.filter((i) => i.severity === sv).length; return <span key={sv} className={`sum-pill ${n ? (sv === 'error' ? 'bad' : 'warn') : ''}`}>{sv === 'error' ? 'שגיאות' : 'אזהרות'}: {n}</span>; })}
        {!issues.some((i) => i.severity !== 'info') && <span className="sum-pill">✓ אין שגיאות ואזהרות</span>}
      </div>}
      {sorted.map(([k, list], gi) => {
        const [sev, code] = k.split('|') as [Severity, string];
        const infoHead = sev === 'info' && (gi === 0 || sorted[gi - 1][0].split('|')[0] !== 'info');
        if (sev === 'info' && !showInfo) return infoHead ? <button key="info-toggle" className="info-toggle" data-testid="info-toggle" onClick={() => setShowInfo(true)}>▸ לידיעה ({issues.filter((i) => i.severity === 'info').length}) — הודעות שאינן דורשות פעולה</button> : null;
        const isOpen = open[k] ?? list.length <= 3;
        const fx = list.filter(hasFix);
        return (
          <div key={k}>{infoHead && <button className="info-toggle" onClick={() => setShowInfo(false)}>▾ לידיעה — קפל</button>}
          <div className={`igroup ${sev}`} data-testid={`igroup-${code}`}>
            <div className="igroup-h" onClick={() => setOpen({ ...open, [k]: !isOpen })}>
              <span className="ic">{ic(sev)}</span>
              <b>{ISSUE_LABEL[code] ?? code}</b>
              <span className="badge">{list.length}</span>
              <span className="grow" />
              {fx.length > 0 && <button className="btn small primary" data-testid={`gfix-${code}`} onClick={(e) => { e.stopPropagation(); store.exec(applyIssueFixes(fx)); }}>תקן {fx.length > 1 ? `הכל (${fx.length})` : ''}</button>}
              {sev !== 'error' && <button className="btn small" data-testid={`ghide-${code}`} title="הסתר את כל ההודעות מסוג זה בפרויקט" onClick={(e) => { e.stopPropagation(); store.exec(dismissIssues([`${code}|*`], true)); }}>הסתר סוג</button>}
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
            </div>
            {isOpen && list.slice(0, 200).map((i, n) => (
              <div key={n} className={`issue ${i.severity}`} onClick={() => select(i)} data-el={i.elementId}>
                <span className="ic">{ic(i.severity)}</span>
                <div className="grow">
                  <div>{i.message}</div>
                  <div className="hint" style={{ margin: 0, direction: 'ltr', textAlign: 'right' }}>{i.code}{i.elementId ? ` · ${i.elementId}` : ''}</div>
                  <div className="row" style={{ gap: 4, marginTop: 2 }}>
                    {hasFix(i) && <button className="btn small fix-btn" data-testid={`fix-${i.code}`} onClick={(e) => { e.stopPropagation(); store.exec(applyIssueFixes([i])); }}>תיקון: {fixLabel(i)}</button>}
                    {i.severity !== 'error' && <button className="btn small" data-testid={`hide-${i.code}`} onClick={(e) => { e.stopPropagation(); store.exec(dismissIssues([issueKey(i)], true)); }}>הסתר</button>}
                  </div>
                </div>
              </div>
            ))}
            {isOpen && list.length > 200 && <div className="hint">ועוד {list.length - 200}…</div>}
          </div></div>
        );
      })}
      {hidden.length > 0 && (
        <div className="igroup info" style={{ marginTop: 10 }}>
          <div className="igroup-h" onClick={() => setShowHidden(!showHidden)} data-testid="hidden-toggle">
            <span className="ic">–</span><b>הודעות מוסתרות</b><span className="badge">{hidden.length}</span><span className="grow" />
            <button className="btn small" data-testid="restore-all" onClick={(e) => { e.stopPropagation(); store.exec(dismissIssues(store.state.project.dismissedIssues ?? [], false)); }}>הצג הכל</button>
            <span className="chev">{showHidden ? '▾' : '▸'}</span>
          </div>
          {showHidden && hidden.slice(0, 200).map((i, n) => (
            <div key={n} className="issue info muted">
              <span className="ic">{ic(i.severity)}</span>
              <div className="grow"><div>{i.message}</div>
                <button className="btn small" onClick={() => store.exec(dismissIssues([issueKey(i), `${i.code}|*`], false))}>החזר</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
