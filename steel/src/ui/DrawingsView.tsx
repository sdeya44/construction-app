import { useEffect, useMemo, useRef, useState } from 'react';
import { numberParts, setDrawing, setSettings } from '../commands/commands';
import { buildSheet, drawingCatalog, sheetHash, type DrawingDef } from '../drawing/views';
import { sheetToSvg } from '../drawing/svg';
import { sheetToDxf } from '../drawing/dxf';
import { sheetsToPdf } from '../drawing/pdf';
import { useFab } from '../fab/useFab';
import type { DrawingRecord } from '../model/types';
import { downloadText, safeFileName } from '../persist/files';
import { store, useStore } from '../store';
import { Icon } from './icons';

const GROUPS: [DrawingDef['type'][], string][] = [
  [['cover', 'ga', 'erection', 'sequence', 'roof-plan', 'anchor-plan', 'frame', 'side', 'cladding', 'gutter'], 'תוכניות, חזיתות וחתכים'],
  [['connection'], 'פרטי חיבור'],
  [['assembly'], 'שרטוטי מכלול'],
  [['part'], 'שרטוטי חלק'],
  [['plates'], 'גיליונות פלטות'],
  [['labels'], 'תוויות סימון להדפסה'],
];
const ST: Record<DrawingRecord['status'], string> = { draft: 'טיוטה', 'for-review': 'לבדיקה', approved: 'מאושר' };

function downloadBytes(name: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function DrawingsView() {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const { fab, bom } = useFab();
  const cat = useMemo(() => drawingCatalog(p, d, fab), [p, d, fab]);
  const focus = useStore((s) => s.drawingFocus ?? null);
  const [cur, setCur] = useState<string>(() => store.state.drawingFocus ?? 'D-ROOF');
  useEffect(() => { if (focus) { setCur(focus); store.set({ drawingFocus: null }); } }, [focus]);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const def = cat.find((c) => c.id === cur) ?? cat[0];
  const rec = p.drawings.find((x) => x.id === def?.id);
  const sheet = useMemo(() => (def ? buildSheet(def, p, d, fab, bom, rec) : null), [def, p, d, fab, bom, rec]);
  const svg = useMemo(() => (sheet ? sheetToSvg(sheet) : ''), [sheet]);
  const hash = useMemo(() => (sheet ? sheetHash(sheet) : ''), [sheet]);
  const changed = rec?.status === 'approved' && rec.approvedHash && rec.approvedHash !== hash;
  const box = useRef<HTMLDivElement>(null);
  const provisional = fab.parts.some((x) => x.provisional);
  // מספור אוטומטי בכניסה לשרטוטים (סימונים זמניים בפרויקט לא נעול)
  useEffect(() => { if (provisional && !p.revision.locked && store.exec(numberParts())) store.toast('info', 'החלקים מוספרו אוטומטית'); }, [provisional, p.revision.locked]);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set(['שרטוטי מכלול', 'שרטוטי חלק']));

  const exportPdf = async (defs: DrawingDef[], name: string) => {
    setBusy(true);
    try {
      const sheets = defs.map((x) => buildSheet(x, p, d, fab, bom, p.drawings.find((r) => r.id === x.id)));
      // סימניות לפי קבוצות השרטוטים
      const outline = GROUPS.map(([types, title]) => ({ title, items: defs.map((x, i) => ({ x, i })).filter(({ x }) => types.includes(x.type)).map(({ x, i }) => ({ title: `${x.number} — ${x.title}`, page: i })) }));
      const bytes = await sheetsToPdf(sheets, { title: `${p.meta.name} – ${name}`, author: p.meta.designer, outline });
      downloadBytes(`${safeFileName(p.meta.name)}_${safeFileName(name)}.pdf`, bytes, 'application/pdf');
      store.toast('ok', `הופק PDF: ${sheets.length} גיליונות`);
    } catch (e) { store.toast('error', `הפקת PDF נכשלה: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  const setStatus = (status: DrawingRecord['status']) => {
    if (!def) return;
    if (status === 'approved' && !confirm('אישור לייצור הוא החלטה של המשתמש. התוכנה לא ביצעה בדיקת חוזק. לאשר?')) return;
    store.exec(setDrawing(def.id, { id: def.id, number: def.number, type: def.type, title: def.title, ref: def.ref }, { status, ...(status === 'approved' ? { approvedHash: hash } : {}) }));
  };
  if (!def || !sheet) return <div className="panel-body">אין שרטוטים — המודל ריק או שגוי.</div>;
  return (
    <div className="dwg" data-testid="drawings-view">
      <aside className="dwg-list">
        <div className="panel-body">
          {provisional && <div className="issue warning" style={{ marginBottom: 8 }}><span className="ic">!</span><div>סימוני חלקים זמניים. <button className="btn small" data-testid="dwg-number" onClick={() => store.exec(numberParts())}>הרץ מספור</button></div></div>}
          <input className="inp" style={{ width: '100%', marginBottom: 6 }} placeholder="חיפוש שרטוט (מספר, סימון, כותרת)…" data-testid="dwg-search" value={q} onChange={(e) => setQ(e.target.value)} />
          {GROUPS.map(([types, title]) => {
            const ql = q.trim().toLowerCase();
            const items = cat.filter((c) => types.includes(c.type) && (!ql || `${c.number} ${c.title} ${c.ref ?? ''}`.toLowerCase().includes(ql)));
            if (!items.length) return null;
            const isClosed = !ql && closed.has(title) && !items.some((c) => c.id === def.id);
            return (
              <div key={title}>
                <div className="panel-title" style={{ cursor: 'pointer' }} data-testid={`dwg-group-${types[0]}`} onClick={() => { const n = new Set(closed); if (isClosed) n.delete(title); else n.add(title); setClosed(n); }}>{isClosed ? '◂' : '▾'} {title} <span className="badge">{items.length}</span></div>
                {!isClosed && items.map((c) => {
                  const r = p.drawings.find((x) => x.id === c.id);
                  return (
                    <div key={c.id} className={`tree-item${c.id === def.id ? ' sel' : ''}`} style={{ paddingInlineStart: 6 }} onClick={() => setCur(c.id)} data-testid={`dwg-${c.id}`}>
                      <input type="checkbox" checked={checked.has(c.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => { const n = new Set(checked); if (e.target.checked) n.add(c.id); else n.delete(c.id); setChecked(n); }} />
                      <span className="id">{c.number}</span><span>{c.title}</span>
                      {r && <span className={`badge ${r.status === 'approved' ? 'ok' : r.status === 'for-review' ? 'warn' : ''}`} style={{ marginInlineStart: 'auto' }}>{ST[r.status]}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>
      <section className="dwg-main">
        <div className="dwg-bar">
          <b data-testid="dwg-title">{def.number} · {def.title}</b>
          <span className="badge" data-testid="dwg-scale">קנ"מ {sheet.title.scale}</span>
          <span className={`badge ${rec?.status === 'approved' ? 'ok' : ''}`} data-testid="dwg-status">{ST[rec?.status ?? 'draft']} · מהדורה {rec?.rev ?? p.revision.current}</span>
          {changed && <span className="badge err" data-testid="dwg-changed">השתנה מאז האישור</span>}
          <span style={{ flex: 1 }} />
          <select className="inp" style={{ width: 110 }} data-testid="dwg-paper" title="נייר מועדף לכל הסט: A4 (מדפסת ביתית — גיליון שלא נכנס בקנ&quot;מ סביר עולה ל-A3) או A3" value={p.settings.paper ?? 'A4'} onChange={(e) => store.exec(setSettings({ paper: e.target.value as 'A4' | 'A3' }))}>
            <option value="A4">סט: A4 מועדף</option><option value="A3">סט: A3</option>
          </select>
          <select className="inp" style={{ width: 96 }} data-testid="dwg-sheet" title="גודל גיליון זה" value={rec?.sheet ?? ''} onChange={(e) => store.exec(setDrawing(def.id, { id: def.id, number: def.number, type: def.type, title: def.title, ref: def.ref }, { sheet: (e.target.value || undefined) as DrawingRecord['sheet'] }))}>
            <option value="">{`אוטו' (${sheet.size})`}</option>
            {['A4', 'A3', 'A2', 'A1', 'A0'].map((x) => <option key={x}>{x}</option>)}
          </select>
          <select className="inp" style={{ width: 110 }} data-testid="dwg-set-status" value={rec?.status ?? 'draft'} onChange={(e) => setStatus(e.target.value as DrawingRecord['status'])}>
            <option value="draft">טיוטה</option><option value="for-review">לבדיקה</option><option value="approved">מאושר לייצור</option>
          </select>
          <select className="inp" style={{ width: 92 }} data-testid="dwg-color" title="הדפסה בשחור-לבן (ברירת מחדל) או בצבע" value={p.settings.drawingColor ? 'color' : 'mono'} onChange={(e) => store.exec(setSettings({ drawingColor: e.target.value === 'color' }))}>
            <option value="mono">שחור-לבן</option><option value="color">צבע</option>
          </select>
          <select className="inp" style={{ width: 74 }} data-testid="dwg-exc" title="דרגת ביצוע לפי EN 1090-2" value={p.settings.execClass ?? 'EXC2'} onChange={(e) => store.exec(setSettings({ execClass: e.target.value as 'EXC1' | 'EXC2' | 'EXC3' }))}>
            <option>EXC1</option><option>EXC2</option><option>EXC3</option>
          </select>
          <button className="btn small" onClick={() => setZoom((z) => Math.min(8, z * 1.4))}>+</button>
          <button className="btn small" onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))}>−</button>
          <button className="btn small" onClick={() => setZoom(1)}>התאם</button>
          <button className="btn small primary" disabled={busy} data-testid="dwg-pdf" onClick={() => exportPdf([def], def.number)}><Icon name="download" />PDF</button>
          <button className="btn small" data-testid="dwg-dxf" onClick={() => { downloadText(`${safeFileName(p.meta.name)}_${def.number}.dxf`, sheetToDxf(sheet), 'application/dxf'); store.toast('ok', 'הופק DXF'); }}><Icon name="download" />DXF</button>
          <button className="btn small" disabled={busy} data-testid="dwg-pdf-all" title="כל הגיליונות בקובץ אחד, עם סימניות לפי סוג" onClick={() => exportPdf(cat, 'סט שרטוטים מלא')}><Icon name="download" />סט מלא</button>
          <button className="btn small" disabled={busy || !checked.size} data-testid="dwg-pdf-batch" onClick={() => exportPdf(cat.filter((c) => checked.has(c.id)), 'סט שרטוטים')}>PDF למסומנים ({checked.size})</button>
        </div>
        <div className="dwg-canvas" ref={box} onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); setZoom((z) => Math.max(0.5, Math.min(8, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); } }}>
          <div className="dwg-paper" style={{ width: `${zoom * 100}%` }} data-testid="dwg-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </section>
    </div>
  );
}
