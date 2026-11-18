import { useMemo } from 'react';
import { restoreDeleted, restoreMembers } from '../commands/commands';
import { generate } from '../geometry/generate';
import { store, useStore } from '../store';
import { kindLabelOf } from './TreePanel';

/**
 * רשימת האלמנטים שנמחקו — שחזור אחד-אחד או הכל.
 * חלקים שנוצרו יחד עם אלמנט (פלטות/ברגים של חיבור שלו) מוצגים כחלק ממנו ומשוחזרים איתו.
 */
export function DeletedPanel({ onClose }: { onClose: () => void }) {
  const p = useStore((s) => s.project);
  const deleted = p.deleted;
  // שמות: מודל מלא ללא מחיקות (נבנה פעם אחת כשהרשימה נפתחת / משתנה)
  const full = useMemo(() => { try { return generate({ ...p, deleted: [] }); } catch { return null; } }, [p]);
  const rows = useMemo(() => {
    const del = new Set(deleted);
    const owner = (id: string) => deleted.find((o) => o !== id && (id.startsWith(`${o}.`) || id.startsWith(`C.${o}.`)));
    return deleted
      .filter((id) => !/\.(H|S|N)$/.test(id) || !del.has(id.replace(/\.(H|S|N)$/, '')) )
      .filter((id) => !owner(id) && !/\.B\d+\.(H|S|N)$/.test(id))
      .map((id) => {
        const m = full?.byId.get(id);
        const sub = deleted.filter((x) => x !== id && (x.startsWith(`${id}.`) || x.startsWith(`C.${id}.`))).length;
        return { id, label: m ? `${kindLabelOf(m)} — ${m.label}` : id, sub };
      });
  }, [deleted, full]);
  return (
    <div className="deleted-pop" role="dialog" aria-label="אלמנטים שנמחקו" data-testid="deleted-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>אלמנטים שנמחקו ({rows.length})</b>
        <button className="btn small" onClick={onClose} aria-label="סגור">✕</button>
      </div>
      <div className="deleted-list">
        {rows.map((r) => (
          <div className="deleted-row" key={r.id}>
            <span><span className="dl-lbl">{r.label}</span> <span className="muted mono">{r.id}</span>{r.sub ? <span className="muted"> · +{r.sub} חלקים</span> : null}</span>
            <button className="btn small primary" data-testid={`restore-${r.id}`} onClick={() => store.exec(restoreMembers([r.id]))}>החזר</button>
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span className="hint" style={{ margin: 0 }}>אלמנט שהוחזר חוזר עם הפלטות והברגים שלו.</span>
        <button className="btn small" data-testid="restore-all" onClick={() => { store.exec(restoreDeleted()); onClose(); }}>החזר הכל</button>
      </div>
    </div>
  );
}
