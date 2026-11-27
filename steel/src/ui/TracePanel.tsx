import { useState } from 'react';
import { setTraceability } from '../commands/commands';
import { autoAssign, compatibleLots, lotKey, LOT_CSV_TEMPLATE, parseLotsCsv, traceOf, traceRows } from '../fab/traceability';
import { downloadText, pickFile } from '../persist/files';
import { store, useStore } from '../store';
import { useFab } from '../fab/useFab';
import type { StockLot } from '../model/types';

/** עקיבות חומר בייצור: ליטים (היתך + תעודה), הקצאה לפי סימון והקצאה אוטומטית — `fab/traceability.ts` */
export function TracePanel() {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const { fab } = useFab();
  const t = traceOf(p);
  const rows = traceRows(p, d, fab);
  const [f, setF] = useState({ heat: '', cert: '', profile: '', material: p.building.material });
  const save = (lots: StockLot[], assign: Record<string, string>) => store.exec(setTraceability({ lots, assign }));
  const add = () => {
    const heat = f.heat.trim(), profile = f.profile.trim(), material = f.material.trim();
    if (!heat || !profile || !material) { store.toast('info', 'חסרים היתך, חתך או חומר'); return; }
    if (t.lots.some((l) => l.heat === heat && lotKey(l.profile) === lotKey(profile) && l.material === material)) { store.toast('info', 'ליט זהה כבר קיים'); return; }
    let n = t.lots.length + 1; while (t.lots.some((l) => l.id === `L${n}`)) n++;
    save([...t.lots, { id: `L${n}`, heat, cert: f.cert.trim() || undefined, profile, material }], t.assign);
    setF({ ...f, heat: '', cert: '' });
  };
  const auto = () => {
    const r = autoAssign(p, d, fab);
    save(t.lots, r.assign);
    store.toast(r.added ? 'ok' : 'info', `הוקצו ${r.added} סימונים${r.ambiguous.length ? ` · ${r.ambiguous.length} עם כמה ליטים מתאימים (בחרו ידנית)` : ''}${r.none.length ? ` · ${r.none.length} בלי ליט מתאים` : ''}`);
  };
  const [csvMsg, setCsvMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const importCsv = async () => {
    const f = await pickFile('.csv,.txt,text/csv'); if (!f) return;
    const r = parseLotsCsv(await f.text(), t.lots);
    const errs = r.errors.slice(0, 5).map((e) => (e.line ? `שורה ${e.line}: ${e.reason}` : e.reason)).join(' · ') + (r.errors.length > 5 ? ` · ועוד ${r.errors.length - 5}` : '');
    if (r.added.length) save([...t.lots, ...r.added], t.assign);
    setCsvMsg({ ok: !r.errors.length, text: `נוספו ${r.added.length} ליטים · כפולים שלא נוספו: ${r.duplicates} · שורות לא תקינות: ${r.errors.length}${errs ? ` (${errs})` : ''}` });
  };
  const profiles = [...new Set(rows.map((r) => r.profile.startsWith('PL') ? lotKey(r.profile) : r.profile))];
  return (
    <div className="quote-prices" data-testid="trace-panel">
      <b>עקיבות חומר — היתך ותעודות מפעל</b>
      <div className="hint">רישום של המשתמש בלבד — אינו אימות תעודות (EN 10204). פלטות לפי עובי (PL15); הקצאה אוטומטית רק כשיש ליט מתאים אחד.</div>
      <div className="field"><label>היתך</label><input className="inp" data-testid="tr-heat" value={f.heat} onChange={(e) => setF({ ...f, heat: e.target.value })} /></div>
      <div className="field"><label>תעודה</label><input className="inp" data-testid="tr-cert" value={f.cert} onChange={(e) => setF({ ...f, cert: e.target.value })} /></div>
      <div className="field"><label>חתך</label><input className="inp" data-testid="tr-profile" list="tr-profiles" value={f.profile} onChange={(e) => setF({ ...f, profile: e.target.value })} /><datalist id="tr-profiles">{profiles.map((x) => <option key={x} value={x} />)}</datalist></div>
      <div className="field"><label>חומר</label><input className="inp" data-testid="tr-material" value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} /></div>
      <button className="btn small primary" data-testid="tr-add" onClick={add}>הוסף ליט</button>
      <button className="btn small" data-testid="tr-auto" disabled={!t.lots.length} onClick={auto}>הקצאה אוטומטית</button>
      <button className="btn small" data-testid="tr-csv" title="ייבוא ליטים מקובץ CSV: עמודות היתך, חתך, חומר (חובה), תעודה והערה. ליטים זהים לקיימים לא נוספים" onClick={importCsv}>ייבוא CSV</button>
      <button className="btn small" data-testid="tr-csv-template" title="קובץ CSV עם שורת הכותרת הנדרשת" onClick={() => downloadText('lots-template.csv', '\uFEFF' + LOT_CSV_TEMPLATE, 'text/csv')}>תבנית CSV</button>
      {csvMsg && <div className={csvMsg.ok ? 'hint' : 'hint warn'} data-testid="tr-csv-msg">{csvMsg.text}</div>}
      {t.lots.length > 0 && <table className="tbl" data-testid="tr-lots"><tbody>{t.lots.map((l) => <tr key={l.id}><td>{l.id}</td><td>{l.heat}</td><td>{l.cert ?? '—'}</td><td>{l.profile}</td><td>{l.material}</td><td><button className="btn small" data-testid={`tr-del-${l.id}`} onClick={() => save(t.lots.filter((x) => x.id !== l.id), t.assign)}>מחק</button></td></tr>)}</tbody></table>}
      {rows.length > 0 && t.lots.length > 0 && <table className="tbl" data-testid="tr-assign"><tbody>{rows.map((r) => (
        <tr key={r.mark}><td>{r.mark}</td><td>{r.profile}</td><td>{r.material}</td>
          <td><select className="inp" data-testid={`tr-sel-${r.mark}`} value={t.assign[r.mark] ?? ''} onChange={(e) => { const a = { ...t.assign }; if (e.target.value) a[r.mark] = e.target.value; else delete a[r.mark]; save(t.lots, a); }}>
            <option value="">— לא מוקצה —</option>
            {compatibleLots(p, r).map((l) => <option key={l.id} value={l.id}>{l.heat}{l.cert ? ` · ${l.cert}` : ''}</option>)}
            {r.lot && !compatibleLots(p, r).includes(r.lot) && <option value={r.lot.id}>{r.lot.heat} (לא תואם)</option>}
          </select></td></tr>))}</tbody></table>}
    </div>
  );
}
