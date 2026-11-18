import { Help } from './fields';
import { useState } from 'react';
import { buildRows, detectMapping, FIELDS, readCsv, readXlsx, type Cell, type Field } from '../profiles/importTable';
import { clearProfileCache, getProfile, profileWithoutCatalog } from '../profiles/library';
import { getUserCatalog, setUserCatalog, type CatalogRow } from '../profiles/userCatalog';
import { clearPureCache } from '../drawing/solidCache';
import { clearSceneCache } from '../view/scene';
import { saveCatalog } from '../persist/idb';
import { pickFile } from '../persist/files';
import { store } from '../store';
import { Dialog } from './Dialogs';
import { Icon } from './icons';

const pct = (a?: number, b?: number) => (a && b ? ((a - b) / b) * 100 : null);

/** השוואה בין ערכי הטבלה לחישוב הגיאומטרי של התוכנה. */
export function compareRow(r: CatalogRow) {
  const g = profileWithoutCatalog(r.name);
  if (!g) return { name: r.name, known: false as const };
  return {
    name: r.name, known: true as const,
    A: pct(g.props.area, r.A), mass: pct((g.props.area / 1e6) * 7850, r.mass), Iy: pct(g.props.Iy, r.Iy), Iz: pct(g.props.Iz, r.Iz), Wy: pct(g.props.Wy, r.Wy),
  };
}

function apply(c: ReturnType<typeof getUserCatalog>) {
  setUserCatalog(c);
  clearProfileCache(); clearPureCache(); clearSceneCache();
  store.rederive();
}

export function CatalogDialog({ onClose }: { onClose: () => void }) {
  const cur = getUserCatalog();
  const [table, setTable] = useState<{ name: string; rows: Cell[][] } | null>(null);
  const [header, setHeader] = useState(0);
  const [map, setMap] = useState<Partial<Record<Field, number>>>({});
  const [units, setUnits] = useState<Partial<Record<Field, string>>>({});
  const [result, setResult] = useState<CatalogRow[] | null>(null);
  const load = async () => {
    const f = await pickFile('.xlsx,.csv,.txt');
    if (!f) return;
    try {
      const rows = /\.xlsx$/i.test(f.name) ? readXlsx(new Uint8Array(await f.arrayBuffer())) : readCsv(await f.text());
      const det = detectMapping(rows);
      setTable({ name: f.name, rows }); setHeader(det.header); setMap(det.map); setResult(null);
    } catch (e) { store.toast('error', `קריאת הקובץ נכשלה: ${(e as Error).message}`); }
  };
  const heads = table ? table.rows[header] ?? [] : [];
  const build = () => {
    if (!table) return;
    if (map.name === undefined) { store.toast('error', 'יש לבחור את עמודת שם החתך'); return; }
    const { rows, skipped } = buildRows(table.rows, header, map, units);
    setResult(rows);
    store.toast('info', `נקראו ${rows.length} חתכים${skipped ? `, ${skipped} שורות דולגו` : ''}`);
  };
  const save = async () => {
    if (!result || !table) return;
    const c = { source: table.name, importedAt: new Date().toISOString(), rows: result };
    await saveCatalog(c);
    apply(c);
    store.toast('ok', `קטלוג "${table.name}" נשמר — ${result.length} חתכים מסומנים כמאומתים`);
    onClose();
  };
  const cmp = result?.map(compareRow) ?? [];
  const bad = (v: number | null | undefined) => v !== null && v !== undefined && Math.abs(v) > 2;
  return (
    <Dialog title="ספריית חתכים מאומתת" onClose={onClose} wide testId="catalog-dialog"
      footer={<>
        <button className="btn" onClick={load} data-testid="cat-load"><Icon name="upload" />בחירת קובץ Excel / CSV</button>
        {table && <button className="btn" onClick={build} data-testid="cat-build">קריאה והשוואה</button>}
        {result && <button className="btn primary" onClick={save} data-testid="cat-save">שמירת הקטלוג</button>}
        {cur && <button className="btn danger" onClick={async () => { if (confirm('להסיר את הקטלוג? החתכים יחזרו לחישוב גיאומטרי "לא מאומת".')) { await saveCatalog(null); apply(null); onClose(); } }}>הסרת קטלוג</button>}
        <button className="btn" onClick={onClose}>סגירה</button>
      </>}>
      <Help>קטלוג נוכחי: {cur ? <b>{cur.source} · {cur.rows.length} חתכים · {new Date(cur.importedAt).toLocaleDateString('he-IL')}</b> : 'אין — כל החתכים מחושבים גיאומטרית ומסומנים "לא מאומת"'}</Help>
      {table && <>
        <div className="panel-title">מיפוי עמודות — {table.name}</div>
        <div className="field"><label>שורת כותרות</label>
          <select className="inp" value={header} onChange={(e) => setHeader(Number(e.target.value))}>
            {table.rows.slice(0, 15).map((r, i) => <option key={i} value={i}>{i + 1}: {r.slice(0, 5).join(' | ')}</option>)}
          </select>
        </div>
        <div className="grid2">
          {FIELDS.map((f) => (
            <div className="field" key={f.k}><label>{f.label}</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <select className="inp" data-testid={`map-${f.k}`} value={map[f.k] ?? ''} onChange={(e) => setMap({ ...map, [f.k]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">—</option>
                  {heads.map((h, i) => <option key={i} value={i}>{String(h ?? `עמודה ${i + 1}`)}</option>)}
                </select>
                {f.unitOpts && <select className="inp" style={{ width: 70 }} value={units[f.k] ?? f.unitOpts[0]} onChange={(e) => setUnits({ ...units, [f.k]: e.target.value })}>{f.unitOpts.map((u) => <option key={u}>{u}</option>)}</select>}
              </div>
            </div>
          ))}
        </div>
      </>}
      {result && <>
        <div className="panel-title">השוואה לחישוב התוכנה (סטייה %, חישוב מול טבלה)</div>
        <div className="list" style={{ maxHeight: 260 }}>
          <table className="tbl" data-testid="cat-compare">
            <thead><tr><th>חתך</th><th>A</th><th>משקל</th><th>Iy</th><th>Iz</th><th>Wy</th></tr></thead>
            <tbody>{cmp.map((c) => (
              <tr key={c.name}>
                <td style={{ direction: 'ltr', textAlign: 'right' }}>{c.name}</td>
                {c.known ? [c.A, c.mass, c.Iy, c.Iz, c.Wy].map((v, i) => <td key={i} style={{ color: bad(v) ? 'var(--err)' : undefined, direction: 'ltr', textAlign: 'right' }}>{v === null || v === undefined ? '—' : v.toFixed(2)}</td>)
                  : <td colSpan={5} className="hint">חתך לא מוכר לתוכנה — יישמר בקטלוג; גיאומטריה תדרוש סדרה נתמכת</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="hint">סטייה מעל 2% מסומנת באדום. בחתכי I/U מידות הגיאומטריה נלקחות מהטבלה; תכונות החתך והמשקל — מהטבלה כאשר קיימות.</div>
      </>}
    </Dialog>
  );
}
void getProfile;
