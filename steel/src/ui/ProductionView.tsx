import { useState } from 'react';
import { approveRevision, numberParts, openNewRevision, setSettings } from '../commands/commands';
import { bomTables, toCsv, toXlsx } from '../fab/export';
import { useFab } from '../fab/useFab';
import { downloadText, safeFileName } from '../persist/files';
import { store, useStore } from '../store';
import { LenField, NumField, TextField } from './fields';
import { Icon } from './icons';

export function ProductionView() {
  const p = useStore((s) => s.project);
  const { fab, bom, plans } = useFab();
  const tables = bomTables(bom, plans);
  const [tab, setTab] = useState(0);
  const t = tables[tab];
  const prov = fab.parts.filter((x) => x.provisional).length;
  const rv = p.revision;
  return (
    <div className="prod" data-testid="production-view">
      <aside className="dwg-list">
        <div className="panel-body">
          <div className="panel-title">מספור</div>
          <dl className="kv">
            <dt>חלקים</dt><dd>{fab.parts.length} ({new Set(fab.parts.map((x) => x.mark)).size} סימונים)</dd>
            <dt>מכלולים</dt><dd>{fab.assemblies.length} ({new Set(fab.assemblies.map((x) => x.mark)).size} סימונים)</dd>
            <dt>סימונים זמניים</dt><dd data-testid="prov-count">{prov}</dd>
            <dt>מספור אחרון</dt><dd>{p.marks.numberedAt ? new Date(p.marks.numberedAt).toLocaleString('he-IL') : '—'}</dd>
          </dl>
          {fab.changed.length > 0 && <div className="issue warning"><span className="ic">!</span>{fab.changed.length} חלקים ישנו סימון במספור הבא (שינוי גיאומטרי).</div>}
          <button className="btn primary" data-testid="run-numbering" onClick={() => { if (store.exec(numberParts())) store.toast('ok', 'המספור עודכן'); }}>הרץ מספור</button>
          <div className="hint">חלקים זהים (חתך, חומר, אורך, חיתוכים, חורים) מקבלים אותו סימון. סימון קיים נשמר; שינוי בחלק יוצר סימון חדש ונרשם בהיסטוריה.</div>

          <div className="panel-title">חומר גלם וחיתוך</div>
          <div className="field"><label>אורכי מלאי (מ')</label><TextField ltr testId="stock-lengths" value={p.settings.stockLengths.map((x) => x / 1000).join(', ')} onCommit={(v) => {
            const arr = v.split(/[,\s]+/).filter(Boolean).map((x) => Number(x) * 1000);
            if (!arr.length || arr.some((x) => !(x > 0))) { store.toast('error', 'רשימת אורכים לא תקינה'); return; }
            store.exec(setSettings({ stockLengths: arr, stockLength: Math.max(...arr) }));
          }} /></div>
          <div className="field"><label>רוחב להב (קרף)</label><LenField mm={p.settings.kerf} unit="mm" onCommit={(v) => store.exec(setSettings({ kerf: v }))} /></div>
          <div className="hint">הנחות: First-Fit-Decreasing, המוט הקצר ביותר שמתאים, ללא שוליים בקצוות, ללא שאריות מפרויקטים אחרים. פלטות אינן מקוננות בגיליון.</div>

          <div className="panel-title">חתימות בשרטוטים</div>
          <div className="field"><label>בדק</label><TextField value={p.settings.checkedBy} onCommit={(v) => store.exec(setSettings({ checkedBy: v }))} /></div>
          <div className="field"><label>אישר</label><TextField value={p.settings.approvedBy} onCommit={(v) => store.exec(setSettings({ approvedBy: v }))} /></div>

          <div className="panel-title">מהדורות</div>
          <dl className="kv"><dt>מהדורה נוכחית</dt><dd data-testid="rev-current">{rv.current}</dd><dt>מצב</dt><dd data-testid="rev-locked">{rv.locked ? 'נעולה (מאושרת)' : 'פתוחה לעריכה'}</dd></dl>
          {!rv.locked
            ? <button className="btn" data-testid="rev-approve" onClick={() => { const note = prompt('הערה למהדורה המאושרת:', '') ?? ''; if (confirm(`לאשר ולנעול את מהדורה ${rv.current}? לא ניתן יהיה לשנות את המודל עד פתיחת מהדורה חדשה.`)) store.exec(approveRevision(note)); }}>אישור ונעילת מהדורה {rv.current}</button>
            : <button className="btn primary" data-testid="rev-new" onClick={() => { const note = prompt('תיאור השינויים במהדורה החדשה:', '') ?? ''; store.exec(openNewRevision(note)); }}>פתיחת מהדורה חדשה</button>}
          {rv.log.length > 0 && <table className="tbl" style={{ marginTop: 6 }}><thead><tr><th>מהדורה</th><th>תאריך</th><th>מצב</th><th>הערה</th></tr></thead>
            <tbody>{rv.log.map((r, i) => <tr key={i}><td>{r.rev}</td><td>{new Date(r.date).toLocaleDateString('he-IL')}</td><td>{r.status === 'approved' ? 'מאושר' : 'טיוטה'}</td><td>{r.note}</td></tr>)}</tbody></table>}
          {p.marks.history.length > 0 && <>
            <div className="panel-title">היסטוריית סימונים</div>
            <table className="tbl"><tbody>{p.marks.history.slice(-30).reverse().map((h, i) => <tr key={i}><td style={{ direction: 'ltr' }}>{h.id}</td><td>{h.from} ← {h.to}</td><td>{new Date(h.date).toLocaleDateString('he-IL')}</td></tr>)}</tbody></table>
          </>}
        </div>
      </aside>
      <section className="dwg-main">
        <div className="dwg-bar">
          <div className="tabs" style={{ border: 0 }}>{tables.map((x, i) => <button key={x.name} className={`tab${i === tab ? ' on' : ''}`} onClick={() => setTab(i)} data-testid={`prod-tab-${i}`}>{x.name}</button>)}</div>
          <span style={{ flex: 1 }} />
          <span className="badge blue" data-testid="total-weight">משקל כולל {Math.round(bom.totalWeight).toLocaleString('en-US')} ק"ג</span>
          <button className="btn small" data-testid="export-csv" onClick={() => downloadText(`${safeFileName(p.meta.name)}_${t.name}.csv`, toCsv(t), 'text/csv')}><Icon name="download" />CSV</button>
          <button className="btn small primary" data-testid="export-xlsx" onClick={() => {
            const bytes = toXlsx(tables, p.meta.name);
            const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${safeFileName(p.meta.name)}_כמויות.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          }}><Icon name="download" />Excel</button>
        </div>
        <div className="prod-table">
          <table className="tbl big" data-testid="prod-table">
            <thead><tr>{t.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'n' : ''}>{typeof c === 'number' ? c.toLocaleString('en-US') : c}</td>)}</tr>)}</tbody>
          </table>
          {tab === 5 && <div className="hint" style={{ padding: 8 }}>{plans.map((pl) => `${pl.profile}: ${pl.bars.length} מוטות, ניצולת ${(pl.utilization * 100).toFixed(1)}%${pl.tooLong.length ? `, ${pl.tooLong.length} חלקים ארוכים מהמלאי` : ''}`).join(' · ')}</div>}
        </div>
      </section>
    </div>
  );
}
void NumField;
