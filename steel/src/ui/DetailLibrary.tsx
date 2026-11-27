import { useState } from 'react';
import { addDetails, deleteDetail, saveDetail } from '../commands/commands';
import { detailPresets } from '../geometry/detail';
import { exportLibrary, importLibrary } from '../geometry/detailLibrary';
import { downloadText, pickFile, safeFileName } from '../persist/files';
import { store, useStore } from '../store';

/** ספריית פרטי החיבור של הפרויקט: שם, שימוש, שכפול, מחיקה ופתיחה בסטודיו */
export function DetailLibrary() {
  const p = useStore((s) => s.project);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const doImport = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const { added } = importLibrary(await f.text(), p.customDetails ?? []);
      store.exec(addDetails(added));
      setMsg({ ok: true, text: `יובאו ${added.length} פרטים: ${added.map((x) => x.name).join(', ')}` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const builtin = detailPresets().filter((x) => x.id.startsWith('lib-'));
  const addBuiltin = () => {
    const names = new Set((p.customDetails ?? []).map((x) => x.name));
    const add = builtin.filter((x) => !names.has(x.name)).map((x, i) => ({ ...structuredClone(x), id: `cd-${Date.now().toString(36)}-${i}` }));
    if (!add.length) { setMsg({ ok: true, text: 'כל פרטי הספרייה המובנית כבר בפרויקט' }); return; }
    store.exec(addDetails(add));
    setMsg({ ok: true, text: `נוספו ${add.length} פרטים מהספרייה המובנית` });
  };
  const lib = p.customDetails ?? [];
  const uses = (id: string) => Object.entries(p.detailAssign ?? {}).filter(([, v]) => v === id).map(([k]) => k);
  return (
    <div className="panel-body" data-testid="detail-library">
      <button className="btn" style={{ width: '100%', marginBottom: 8 }} data-testid="open-conn-library" onClick={() => store.set({ connLibraryOpen: true })}>הגדרות שמורות לחיבורים (פרט + ערכי פרמטרים) ←</button>
      <div className="panel-title">ספריית פרטים ({lib.length})</div>
      <div className="hint" data-testid="lib-explain">פרטים שנבנו בסטודיו או יובאו. לשמירת פרט יחד עם ערכי פרמטרים — "הגדרות שמורות לחיבורים" למעלה.</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <button className="btn small" data-testid="lib-export" disabled={!lib.length} title="שמירת פרטי הספרייה (לא ההגדרות השמורות) לקובץ — להעברה לפרויקט אחר או למחשב אחר"
          onClick={() => downloadText(`${safeFileName(p.meta.name)}-פרטים.json`, exportLibrary(lib))}>ייצוא פרטים</button>
        <button className="btn small" data-testid="lib-import" title="טעינת פרטים מקובץ ספרייה (פרטים קיימים לא נדרסים)" onClick={doImport}>ייבוא פרטים</button>
        <button className="btn small" data-testid="lib-add-builtin" title={builtin.map((x) => x.name).join(' · ')} onClick={addBuiltin}>＋ {builtin.length} פרטים מוכנים</button>
      </div>
      {msg && <div className={msg.ok ? 'hint' : 'hint warn'} data-testid="lib-msg">{msg.text}</div>}
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
