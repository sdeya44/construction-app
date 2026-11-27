import { useState } from 'react';
import { approveRevision, numberParts, openNewRevision, setSettings } from '../commands/commands';
import { boltsByNodeTable, bomTables, sequenceTable, toCsv, toXlsx } from '../fab/export';
import { connReportTable } from '../fab/connReport';
import { traceTable } from '../fab/traceability';
import { TracePanel } from './TracePanel';
import { CONN_TYPE } from './ConnectionEditor';
import { dstvZip } from '../fab/dstv';
import { NestingDialog } from './NestingDialog';
import { useFab } from '../fab/useFab';
import { downloadText, safeFileName } from '../persist/files';
import { store, useStore } from '../store';
import { LenField, NumField, TextField } from './fields';
import { Icon } from './icons';
import { computeQuote, DEFAULT_PRICING, type Pricing } from '../fab/quote';
import { claddingTakeoff } from '../geometry/cladding';
import { projectToIfc } from '../fab/ifc';
import { clientQuoteSheet, DEFAULT_TERMS } from '../fab/clientQuote';
import { sheetsToPdf } from '../drawing/pdf';
import { setMeta } from '../commands/commands';
import { boltGroups, partGroups } from '../fab/unify';
import { auditContacts, type AuditFinding } from '../geometry/audit';

export function ProductionView() {
  const p = useStore((s) => s.project);
  const { fab, bom, plans } = useFab();
  const pricing: Pricing = { ...DEFAULT_PRICING, ...(p.settings.pricing ?? {}) };
  const clad = claddingTakeoff(p, store.state.derived);
  const q = computeQuote(pricing, store.state.derived, fab, bom, plans, clad);
  const money = (n: number) => Math.round(n).toLocaleString('en-US');
  const quoteTable = {
    name: 'הצעת מחיר', headers: ['סעיף', 'כמות', 'יחידה', 'מחיר ליח\' (₪)', 'סה"כ (₪)'],
    rows: [
      ...q.lines.map((l) => [l.label, l.qty, l.unit, l.price, Math.round(l.total)] as (string | number)[]),
      ['סה"כ עלויות ישירות', '', '', '', Math.round(q.subtotal)],
      [`תקורה ${pricing.overheadPct}%`, '', '', '', Math.round(q.overhead)],
      [`רווח ${pricing.marginPct}%`, '', '', '', Math.round(q.margin)],
      ['סה"כ לפני מע"מ', '', '', '', Math.round(q.beforeVat)],
      [`מע"מ ${pricing.vatPct}%`, '', '', '', Math.round(q.vat)],
      ['סה"כ כולל מע"מ', '', '', '', Math.round(q.total)],
    ],
  };
  const cladTable = clad ? {
    name: 'חיפוי', headers: ['פריט', 'מיקום', 'כמות', 'אורך/שטח', 'יחידה'],
    rows: [
      ...clad.roofSheets.map((r) => ['פנל גג', `${r.where} · ${r.panel}`, r.count, Math.round(r.length) / 1000, 'מ\' לפנל'] as (string | number)[]),
      ...clad.wallSheets.map((r) => ['פנל קיר', `${r.where} · ${r.panel}`, r.count, Math.round(r.length) / 1000, 'מ\' לפנל'] as (string | number)[]),
      ...clad.flashings.map((f) => ['פח', f.name, 1, Math.round(f.length) / 1000, 'מ\''] as (string | number)[]),
      ...clad.gutters.map((g) => ['מזחלה', `${g.name} · ${g.downpipes} מרזבים`, 1, Math.round(g.length) / 1000, 'מ\''] as (string | number)[]),
      ['ברגי חיפוי', '', clad.screws, '', 'יח\''],
      ['סה"כ גג', '', '', Math.round(clad.roofArea * 10) / 10, 'מ"ר'], ['סה"כ קירות (נטו)', '', '', Math.round(clad.wallArea * 10) / 10, 'מ"ר'],
    ],
  } : null;
  const tables = [...bomTables(bom, plans), boltsByNodeTable(p, store.state.derived), sequenceTable(p, store.state.derived, fab), connReportTable(p, store.state.derived, CONN_TYPE), traceTable(p, store.state.derived, fab), ...(cladTable ? [cladTable] : []), quoteTable];
  const isQuote = (i: number) => i === tables.length - 1;
  const setPrice = (k: keyof Pricing, v: number) => store.exec(setSettings({ pricing: { ...(p.settings.pricing ?? {}), [k]: v } }));
  const PRICE_FIELDS: [keyof Pricing, string][] = [
    ['steelPerKg', 'פלדה פרופילים ₪/ק"ג'], ['platePerKg', 'פלטות ₪/ק"ג (0 = כמו פרופילים)'], ['plateWastePct', 'פחת פלטות %'], ['galvPerKg', 'גלוון ₪/ק"ג'],
    ['boltPerUnit', 'בורג ₪/יח\''], ['anchorPerUnit', 'מוט עיגון ₪/יח\''], ['fabHoursPerTon', 'ש"ע ייצור לטון'], ['hourRate', 'מחיר ש"ע ₪'],
    ['erectionPerTon', 'הרכבה ₪/טון'], ['transport', 'הובלה ₪'], ['overheadPct', 'תקורה %'], ['marginPct', 'רווח %'], ['vatPct', 'מע"מ %'],
    ...(clad ? [['roofPanelPerM2', 'פנל גג ₪/מ"ר'], ['wallPanelPerM2', 'פנל קיר ₪/מ"ר'], ['flashingPerM', 'פחים ₪/מ\''], ['gutterPerM', 'מזחלה ₪/מ\''], ['downpipePerUnit', 'מרזב ₪/יח\''], ['claddingScrewPerUnit', 'בורג חיפוי ₪'], ['claddingInstallPerM2', 'התקנת חיפוי ₪/מ"ר']] as [keyof Pricing, string][] : []),
  ];
  const [tab, setTab] = useState(0);
  const [nestOpen, setNestOpen] = useState(false);
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

          <div className="panel-title">בקרת אורכים ומגעים</div>
          <AuditPanel />

          <div className="panel-title">הצעות האחדה</div>
          <UnifyPanel />

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
          <button className="btn small" data-testid="export-dstv" title="קבצי NC1 ללייזר — פלטות בלבד (פרופילים נחתכים במסגריה). גרסת בטא, לאמת מול המכונה" onClick={() => {
            const { zip, count } = dstvZip(p, store.state.derived, fab);
            const blob = new Blob([zip as BlobPart], { type: 'application/zip' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${safeFileName(p.meta.name)}_DSTV.zip`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            store.toast('ok', `הופקו ${count} קבצי NC1 לפלטות (בטא — לאמת מול המכונה)`);
          }}><Icon name="download" />DSTV</button>
          <button className="btn small" data-testid="export-nest" title="ניסטינג פלטות ללייזר — קונטור אמיתי, DXF לכל לוח ודוח. לא מאומת מול מכונה" onClick={() => setNestOpen(true)}>ניסטינג</button>
          <button className="btn small" data-testid="export-ifc" title="מודל BIM ‏IFC4 — לפתיחה ב-Tekla / Revit / צופי IFC" onClick={() => {
            const txt = projectToIfc(p, store.state.derived, fab);
            downloadText(`${safeFileName(p.meta.name)}.ifc`, txt, 'application/octet-stream');
            store.toast('ok', 'הופק קובץ IFC4');
          }}><Icon name="download" />IFC</button>
          <button className="btn small" data-testid="export-csv" onClick={() => downloadText(`${safeFileName(p.meta.name)}_${t.name}.csv`, toCsv(t), 'text/csv')}><Icon name="download" />CSV</button>
          <button className="btn small primary" data-testid="export-xlsx" onClick={() => {
            const bytes = toXlsx(tables, p.meta.name);
            const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${safeFileName(p.meta.name)}_כמויות.xlsx`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          }}><Icon name="download" />Excel</button>
        </div>
        {t.name === 'עקיבות חומר' && <TracePanel />}
        {isQuote(tab) && <div className="quote-prices" data-testid="quote-prices">
          {PRICE_FIELDS.map(([k, lab]) => <div className="field" key={k}><label>{lab}</label><NumField testId={`qp-${k}`} value={pricing[k]} step={0.5} onCommit={(v) => setPrice(k, v)} /></div>)}
          <div className="quote-sum" data-testid="quote-total">
            <b>סה"כ כולל מע"מ: ₪{money(q.total)}</b>
            <span>משקל נטו {money(q.netKg)} ק"ג · רכש {money(q.buyKg)} ק"ג · {q.perKg ? `₪${q.perKg.toFixed(2)} לק"ג (לפני מע"מ)` : 'הזן מחירים'}</span>
          </div>
          <div className="hint">המחירים נשמרים בקובץ הפרויקט בלבד. אומדן — לא כולל עבודות בטון, צבע, מנופים ושינויים בשטח.</div>
          <div className="quote-client">
            <b>הצעת מחיר ללקוח (PDF)</b>
            <div className="field"><label>שם החברה</label><TextField testId="qc-company" value={p.settings.company ?? 'כיאן הנדסה'} onCommit={(v) => store.exec(setSettings({ company: v }))} /></div>
            <div className="field"><label>לקוח</label><TextField testId="qc-client" value={p.meta.client} onCommit={(v) => store.exec(setMeta({ client: v }))} /></div>
            <label className="hint">תנאים והערות (שורה לכל סעיף)</label>
            <textarea className="inp" rows={5} data-testid="qc-terms" defaultValue={p.settings.quoteTerms ?? DEFAULT_TERMS.join('\n')} onBlur={(e) => { if (e.target.value !== (p.settings.quoteTerms ?? DEFAULT_TERMS.join('\n'))) store.exec(setSettings({ quoteTerms: e.target.value })); }} />
            <button className="btn primary small" data-testid="qc-pdf" onClick={async () => {
              try {
                // תמונת תלת־ממד: מציגים את חלון המודל לרגע, מתאימים מבט ומצלמים
                const ws = document.querySelector('.workspace') as HTMLElement | null; const prev = ws?.style.display ?? '';
                if (ws) ws.style.display = '';
                const vp = (window as any).__ksp?.viewport;
                let png: Uint8Array | null = null;
                if (vp) { vp.resize(); vp.fitAll('iso'); await new Promise((r) => requestAnimationFrame(r)); const url: string = vp.presentationShot ? vp.presentationShot(1600, 1000, true) : vp.snapshot(); png = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0)); }
                if (ws) ws.style.display = prev;
                const { sheet, imageBox } = clientQuoteSheet(p, store.state.derived, q, clad, pricing.vatPct, (p.settings.quoteTerms ?? DEFAULT_TERMS.join('\n')).split('\n'), p.settings.company ?? 'כיאן הנדסה');
                const bytes = await sheetsToPdf([sheet], { title: `הצעת מחיר — ${p.meta.name}`, author: p.settings.company ?? '', images: png ? [{ page: 0, ...imageBox, png }] : [] });
                const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${safeFileName(p.meta.name)}_הצעת_מחיר.pdf`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
                store.toast('ok', 'הופקה הצעת מחיר ללקוח');
              } catch (e) { store.toast('error', `הפקת ההצעה נכשלה: ${(e as Error).message}`); }
            }}><Icon name="download" />הצעת מחיר ללקוח</button>
            <div className="hint">בהצעה ללקוח התקורה והרווח מגולמים במחירי הסעיפים ואינם מוצגים.</div>
          </div>
        </div>}
        <div className="prod-table">
          <table className="tbl big" data-testid="prod-table">
            <thead><tr>{t.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'n' : ''}>{typeof c === 'number' ? c.toLocaleString('en-US') : c}</td>)}</tr>)}</tbody>
          </table>
          {tab === 5 && <div className="hint" style={{ padding: 8 }}>{plans.map((pl) => `${pl.profile}: ${pl.bars.length} מוטות, ניצולת ${(pl.utilization * 100).toFixed(1)}%${pl.tooLong.length ? `, ${pl.tooLong.length} חלקים ארוכים מהמלאי` : ''}`).join(' · ')}</div>}
        </div>
      </section>
      {nestOpen && <NestingDialog onClose={() => setNestOpen(false)} />}
    </div>
  );
}

/** הצעות האחדה: ברגים באורכים קרובים (ניתן להחיל) וחלקים כמעט־זהים (המלצה לבדיקה) */
function UnifyPanel() {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const { fab } = useFab();
  const [tol, setTol] = useState(10);
  const on = (p.settings.boltUnify ?? 0) > 0;
  const bg = on ? [] : boltGroups(d, tol);
  const pg = partGroups(fab, tol);
  return <div data-testid="unify-panel">
    <div className="field"><label>סף הפרש (מ"מ)</label><NumField testId="unify-tol" value={tol} step={5} onCommit={(v) => setTol(Math.max(0, v))} /></div>
    <label className="row"><input type="checkbox" data-testid="bolt-unify" checked={on} onChange={(e) => store.exec(setSettings({ boltUnify: e.target.checked ? tol : 0 }))} /> האחד אורכי ברגים {on ? `(עד ${p.settings.boltUnify} מ"מ — פעיל)` : ''}</label>
    {!on && (bg.length
      ? <ul className="unify-list" data-testid="unify-bolts">{bg.map((g, i) => <li key={i}><span className="en">M{g.d}×{g.lengths.map((l) => `${l.length}(${l.qty})`).join(' / ')}</span> ← <b className="en">M{g.d}×{g.to}</b></li>)}</ul>
      : <div className="hint">אין אורכי ברגים קרובים לאיחוד.</div>)}
    <label className="row" style={{ marginTop: 6 }}><input type="checkbox" data-testid="mark-tol" checked={(p.settings.markTol ?? 0) > 0} onChange={(e) => store.exec(setSettings({ markTol: e.target.checked ? Math.min(tol, 5) : 0 }))} /> סבולת מספור לחלקים {(p.settings.markTol ?? 0) > 0 ? `(עד ${p.settings.markTol} מ"מ — פעיל)` : '(עד 5 מ"מ)'}</label>
    {(fab.unified?.length ?? 0) > 0 && <ul className="unify-list" data-testid="unify-applied">{fab.unified!.map((u, i) => <li key={i}><b className="en">{u.mark}</b> <span className="en">{u.profile} · {u.length}</span> ← <span className="en">{u.from.join(', ')}</span></li>)}</ul>}
    <div className="hint" style={{ marginTop: 6 }}>חלקים כמעט־זהים (אותו חתך ומספר חורים):</div>
    {pg.length
      ? <ul className="unify-list" data-testid="unify-parts">{pg.slice(0, 12).map((g, i) => <li key={i} title={g.note}><b className="en">{g.marks.map((m) => `${m.mark}×${m.qty}`).join(' ≈ ')}</b> <span className="en">{g.profile} · {g.marks.map((m) => m.length).join('/')}</span><br /><small>{g.note}</small></li>)}</ul>
      : <div className="hint" data-testid="unify-parts-none">לא נמצאו חלקים כמעט־זהים.</div>}
    <div className="hint">ברגים: כל בורג בקבוצה מקבל את האורך הארוך — משפיע על כתב הכמויות ועל השרטוטים. חלקים: עם סבולת מספור, חלקים שאורכם ומיקום חוריהם שונים עד הסבולת מקבלים סימון אחד ומיוצרים כמו החלק הנפוץ בקבוצה (ההפרש נבלע במרווח החור — לכן הסבולת מוגבלת ל-5 מ"מ). אחרי הפעלה — "הרץ מספור".</div>
  </div>;
}

/** בקרת ייצור: כל ריתוך — החלקים נוגעים; כל בורג — עובר בכל החלקים ובתוך השפה. אורך שגוי מתגלה כקצה שלא מגיע */
function AuditPanel() {
  const d = useStore((s) => s.derived);
  const [res, setRes] = useState<{ d: unknown; f: AuditFinding[] } | null>(null);
  const cur = res && res.d === d ? res.f : null;
  return <div data-testid="audit-panel">
    <button className="btn small" data-testid="audit-run" onClick={() => setRes({ d, f: auditContacts(d) })}>הרץ בקרה</button>
    {cur && (cur.length === 0
      ? <div className="issue info" data-testid="audit-ok"><span className="ic">✓</span>כל {d.connections.reduce((s, c) => s + c.welds.length, 0)} הריתוכים נוגעים וכל {d.connections.reduce((s, c) => s + c.bolts.length, 0)} הברגים עוברים בחלקים — לא נמצאו קצוות קצרים/ארוכים</div>
      : <ul className="unify-list" data-testid="audit-list">{cur.slice(0, 40).map((f, i) => <li key={i} style={{ cursor: 'pointer' }} onClick={() => store.select([f.a, ...(f.b ? [f.b] : [])].filter((x) => d.byId.has(x)))}>{f.message}</li>)}{cur.length > 40 && <li>…ועוד {cur.length - 40}</li>}</ul>)}
    <div className="hint">בודק כל ריתוך (שני החלקים נוגעים) וכל בורג (עובר דרך כל החלקים, החור בתוך השפה). אלמנט קצר או ארוך מדי מתגלה כקצה שלא מגיע לפלטה/לחלק שלו. בדיקה גיאומטרית — לא חוזק.</div>
  </div>;
}
