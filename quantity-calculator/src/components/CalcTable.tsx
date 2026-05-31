import { useMemo } from 'react';
import type { CalcRow, Project } from '../types';
import { calcTypeMeta } from '../types';
import { useStore } from '../store/projectStore';
import { computeRow, fmt, round } from '../lib/calc';

interface Props {
  project: Project;
  activeFilter: string | null | 'all';
  onEdit: (row: CalcRow) => void;
  onAddManual: () => void;
  onHoverRow?: (id: string | null) => void;
}

export function CalcTable({ project, activeFilter, onEdit, onAddManual, onHoverRow }: Props) {
  const { deleteRow, duplicateRow } = useStore();

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return project.rows;
    return project.rows.filter((r) => r.sectionId === (activeFilter === null ? null : activeFilter));
  }, [project.rows, activeFilter]);

  // קיבוץ לפי סעיף לפי סדר ספריית הסעיפים
  const groups = useMemo(() => {
    const order: (string | null)[] = [...project.sections.map((s) => s.id), null];
    const byId = new Map<string | null, CalcRow[]>();
    for (const r of filtered) {
      const arr = byId.get(r.sectionId) ?? [];
      arr.push(r);
      byId.set(r.sectionId, arr);
    }
    return order
      .filter((id) => byId.has(id))
      .map((id) => ({ id, rows: byId.get(id)! }));
  }, [filtered, project.sections]);

  function sectionInfo(id: string | null) {
    const s = project.sections.find((x) => x.id === id);
    return s ? { code: s.code, name: s.name, unit: s.unit } : { code: '', name: 'ללא סעיף', unit: '' };
  }

  // מיפוי מספר שורה רציף לפי כל הפרויקט
  const rowIndex = useMemo(() => {
    const m = new Map<string, number>();
    project.rows.forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [project.rows]);

  return (
    <div className="panel calc-panel">
      <div className="panel-head">
        <h2>טבלת חישובים {activeFilter !== 'all' && <span className="filter-tag">מסונן</span>}</h2>
        <button className="btn btn-sm btn-primary" onClick={onAddManual}>+ חישוב ידני</button>
      </div>

      <div className="table-scroll">
        <table className="calc-table">
          <thead>
            <tr>
              <th>מס׳</th>
              <th>תיאור החישוב</th>
              <th>תוכנית</th>
              <th>עמוד</th>
              <th>סוג</th>
              <th>אורך</th>
              <th>רוחב</th>
              <th>גובה</th>
              <th>יח׳</th>
              <th>מקדם</th>
              <th>נוסחה</th>
              <th>כמות</th>
              <th>יחידה</th>
              <th>הערות</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr><td colSpan={15} className="empty-row">אין שורות חישוב. הוסף חישוב ידני או מדוד מהתוכנית.</td></tr>
            )}
            {groups.map((g) => {
              const info = sectionInfo(g.id);
              const subtotal = round(g.rows.reduce((a, r) => a + computeRow(r).quantity, 0));
              return (
                <GroupBlock
                  key={String(g.id)}
                  info={info}
                  rows={g.rows}
                  subtotal={subtotal}
                  rowIndex={rowIndex}
                  onEdit={onEdit}
                  onDelete={deleteRow}
                  onDuplicate={duplicateRow}
                  onHoverRow={onHoverRow}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupBlock({
  info, rows, subtotal, rowIndex, onEdit, onDelete, onDuplicate, onHoverRow,
}: {
  info: { code: string; name: string; unit: string };
  rows: CalcRow[];
  subtotal: number;
  rowIndex: Map<string, number>;
  onEdit: (r: CalcRow) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onHoverRow?: (id: string | null) => void;
}) {
  return (
    <>
      <tr className="group-head">
        <td colSpan={15}>
          {info.code && <span className="gh-code">{info.code}</span>}
          <span className="gh-name">{info.name}</span>
        </td>
      </tr>
      {rows.map((r) => {
        const { quantity, formula } = computeRow(r);
        const meta = calcTypeMeta(r.type);
        const isDed = r.kind === 'deduction';
        return (
          <tr
            key={r.id}
            className={isDed ? 'row-deduction' : ''}
            onDoubleClick={() => onEdit(r)}
            onMouseEnter={() => onHoverRow?.(r.id)}
            onMouseLeave={() => onHoverRow?.(null)}
          >
            <td>{rowIndex.get(r.id)}</td>
            <td className="cell-desc">{r.description || <span className="muted">—</span>}</td>
            <td className="cell-thumb">
              {r.cropDataUrl ? <img className="row-thumb" src={r.cropDataUrl} alt="קטע מהתוכנית" /> : <span className="muted">—</span>}
            </td>
            <td>{r.page}</td>
            <td className="cell-type">{meta.label}</td>
            <td>{r.length ?? ''}</td>
            <td>{r.width ?? ''}</td>
            <td>{r.height ?? ''}</td>
            <td>{r.count}</td>
            <td>{r.coefficient}</td>
            <td className="cell-formula">{formula}</td>
            <td className="cell-qty">{fmt(quantity)}</td>
            <td>{r.unit}</td>
            <td className="cell-note">{r.note}</td>
            <td className="cell-actions">
              <button className="mini-btn" title="עריכה" onClick={() => onEdit(r)}>✎</button>
              <button className="mini-btn" title="שכפול" onClick={() => onDuplicate(r.id)}>⧉</button>
              <button className="mini-btn danger" title="מחיקה" onClick={() => { if (confirm('למחוק את השורה?')) onDelete(r.id); }}>🗑</button>
            </td>
          </tr>
        );
      })}
      <tr className="subtotal-row">
        <td colSpan={11}>סיכום סעיף ({info.name})</td>
        <td className="cell-qty">{fmt(subtotal)}</td>
        <td>{info.unit}</td>
        <td colSpan={2}></td>
      </tr>
    </>
  );
}
