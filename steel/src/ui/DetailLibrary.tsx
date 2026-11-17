import { useState } from 'react';
import { deleteDetail, saveDetail } from '../commands/commands';
import { store, useStore } from '../store';

/** ספריית פרטי החיבור של הפרויקט: שם, שימוש, שכפול, מחיקה ופתיחה בסטודיו */
export function DetailLibrary() {
  const p = useStore((s) => s.project);
  const [confirm, setConfirm] = useState<string | null>(null);
  const lib = p.customDetails ?? [];
  const uses = (id: string) => Object.entries(p.detailAssign ?? {}).filter(([, v]) => v === id).map(([k]) => k);
  return (
    <div className="panel-body" data-testid="detail-library">
      <div className="panel-title">ספריית פרטים ({lib.length})</div>
      {!lib.length && <div className="hint">אין עדיין פרטים בספרייה. בוחרים אלמנט ← "סוג חיבור בכל קצה" ← "פרט חדש בסטודיו", או תושבת ← "סוג התושבת".</div>}
      {lib.length > 0 && (
        <table className="tbl" data-testid="lib-table">
          <thead><tr><th>שם הפרט</th><th>בשימוש</th><th /></tr></thead>
          <tbody>
            {lib.map((d) => {
              const u = uses(d.id);
              return (
                <tr key={d.id} data-testid={`lib-row-${d.id}`}>
                  <td><input className="inp" defaultValue={d.name} aria-label="שם הפרט" data-testid={`lib-name-${d.id}`}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.name) store.exec(saveDetail({ ...d, name: v })); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></td>
                  <td className="num">{u.length}{d.family === 'cleat' || u.some((k) => k.includes('|x:')) ? ' תושבות' : ' קצוות'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small" disabled={!u.length} title={u.length ? 'פתיחה בסטודיו על אחד הקצוות' : 'הפרט לא בשימוש — החילו אותו על קצה כדי לערוך בסטודיו'} onClick={() => store.set({ detailStudio: u[0] })} data-testid={`lib-edit-${d.id}`}>עריכה</button>
                    <button className="btn small" onClick={() => store.exec(saveDetail({ ...structuredClone(d), id: `cd-${Date.now().toString(36)}`, name: `${d.name} (עותק)` }))} data-testid={`lib-dup-${d.id}`}>שכפול</button>
                    {confirm === d.id
                      ? <button className="btn small danger" onClick={() => { store.exec(deleteDetail(d.id)); setConfirm(null); }} data-testid={`lib-del-ok-${d.id}`}>{u.length ? `מחק ושחרר ${u.length}` : 'מחק'}</button>
                      : <button className="btn small" onClick={() => setConfirm(d.id)} data-testid={`lib-del-${d.id}`}>מחיקה</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="hint">מחיקת פרט שבשימוש מחזירה את הקצוות שלו לפרט הרגיל. הספרייה נשמרת גם ב"סטנדרט המסגריה" (פרויקט והגדרות).</div>
    </div>
  );
}
