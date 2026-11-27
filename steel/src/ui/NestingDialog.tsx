import { useMemo, useState } from 'react';
import { Dialog } from './Dialogs';
import { store } from '../store';
import { useFab } from '../fab/useFab';
import { toCsv, toXlsx } from '../fab/export';
import { DEFAULT_NEST, nestParts, nestPlates, nestSheetDxf, nestTables, nestZip, type NestOptions, type NestResult } from '../fab/nesting';
import { safeFileName } from '../persist/files';

const KEY = 'ksp-nest-opts';
const SIZES: [string, number, number][] = [['1500×3000', 3000, 1500], ['1250×2500', 2500, 1250], ['1500×6000', 6000, 1500], ['2000×6000', 6000, 2000]];
const load = (): NestOptions => { try { return { ...DEFAULT_NEST, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<NestOptions>) }; } catch { return DEFAULT_NEST; } };
const save = (o: NestOptions) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* */ } };
const dl = (name: string, data: BlobPart, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };

/** ניסטינג ללייזר לפלטות: קונטור אמיתי, סיבוב 90°, DXF לכל לוח ודוח כמויות. אינו מאומת מול מכונה. */
export function NestingDialog({ onClose }: { onClose: () => void }) {
  const p = store.state.project, d = store.state.derived;
  const { fab } = useFab();
  const parts = useMemo(() => nestParts(d, fab), [d, fab]);
  const [o, setO] = useState<NestOptions>(load);
  const [res, setRes] = useState<NestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(1);
  const set = (patch: Partial<NestOptions>) => setO((x) => { const n = { ...x, ...patch }; save(n); return n; });
  const num = (v: string, dflt: number) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };
  const run = () => { setBusy(true); setTimeout(() => { try { setRes(nestPlates(parts, o)); setSel(1); } finally { setBusy(false); } }, 20); };
  const tables = res ? nestTables(parts, res) : [];
  const sheet = res?.sheets.find((s) => s.id === sel) ?? res?.sheets[0];
  const name = safeFileName(p.meta.name);
  const total = parts.reduce((a, x) => a + x.qty, 0);
  const totUtil = res && res.sheets.length ? res.sheets.reduce((a, s) => a + s.usedArea, 0) / res.sheets.reduce((a, s) => a + s.w * s.h, 0) : 0;
  return (
    <Dialog title="ניסטינג ללייזר — פלטות" onClose={onClose} wide testId="nest-dialog"
      footer={<div className="row" style={{ gap: 6 }}><button className="btn" onClick={onClose}>סגירה</button></div>}>
      <div className="hint" data-testid="nest-note">פלטות בלבד · קונטור אמיתי (כולל קיטומים; חורים נחתכים אך אינם משמשים לאריזה פנימית) · <b>אינו מאומת מול מכונה</b> — לבדוק ב-DXF לפני חיתוך.</div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 8, alignItems: 'end' }}>
        <label className="fld">גודל לוח<select className="inp" data-testid="nest-size" value={SIZES.find((s) => s[1] === o.sheetW && s[2] === o.sheetH)?.[0] ?? 'custom'} onChange={(e) => { const s = SIZES.find((x) => x[0] === e.target.value); if (s) set({ sheetW: s[1], sheetH: s[2] }); }}>
          {SIZES.map((s) => <option key={s[0]} value={s[0]}>{s[0]}</option>)}<option value="custom">מותאם</option></select></label>
        <label className="fld">אורך (מ"מ)<input className="inp" type="number" min={100} data-testid="nest-w" value={o.sheetW} onChange={(e) => set({ sheetW: Math.max(100, num(e.target.value, o.sheetW)) })} /></label>
        <label className="fld">רוחב (מ"מ)<input className="inp" type="number" min={100} data-testid="nest-h" value={o.sheetH} onChange={(e) => set({ sheetH: Math.max(100, num(e.target.value, o.sheetH)) })} /></label>
        <label className="fld">קרף / מרווח<input className="inp" type="number" min={0} data-testid="nest-kerf" value={o.kerf} onChange={(e) => set({ kerf: Math.max(0, num(e.target.value, o.kerf)) })} /></label>
        <label className="fld">שוליים<input className="inp" type="number" min={0} data-testid="nest-margin" value={o.margin} onChange={(e) => set({ margin: Math.max(0, num(e.target.value, o.margin)) })} /></label>
        <label className="fld">תא רסטר (מ"מ)<input className="inp" type="number" min={1} max={20} data-testid="nest-cell" value={o.cell} onChange={(e) => set({ cell: Math.min(20, Math.max(1, num(e.target.value, o.cell))) })} /></label>
        <label className="ss-radio"><input type="checkbox" data-testid="nest-rotate" checked={o.rotate} onChange={(e) => set({ rotate: e.target.checked })} />סיבוב 90°</label>
        <button className="btn primary" data-testid="nest-run" disabled={busy || !parts.length} onClick={run}>{busy ? 'מחשב…' : 'חשב ניסטינג'}</button>
      </div>
      <div className="hint" style={{ marginTop: 6 }} data-testid="nest-count">{parts.length ? `${parts.length} סימוני פלטות · ${total} חלקים` : 'אין פלטות בפרויקט.'}</div>
      {res && <div data-testid="nest-result" style={{ marginTop: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="badge blue" data-testid="nest-sheets">{res.sheets.length} לוחות</span>
          <span className="badge" data-testid="nest-util">ניצולת כוללת {(totUtil * 100).toFixed(1)}%</span>
          {res.unplaced.length > 0 && <span className="badge red" data-testid="nest-unplaced">{res.unplaced.reduce((a, u) => a + u.qty, 0)} חלקים לא הונחו</span>}
          <span style={{ flex: 1 }} />
          <button className="btn small" data-testid="nest-zip" disabled={!res.sheets.length} onClick={() => { const z = nestZip(res); dl(`${name}_nesting_DXF.zip`, z.zip as BlobPart, 'application/zip'); store.toast('ok', `הופקו ${z.count} קבצי DXF (לא מאומת מול מכונה)`); }}>DXF (ZIP)</button>
          <button className="btn small" data-testid="nest-xlsx" onClick={() => dl(`${name}_nesting.xlsx`, toXlsx(tables, 'ניסטינג') as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>Excel</button>
          <button className="btn small" data-testid="nest-csv" onClick={() => dl(`${name}_nesting.csv`, '﻿' + toCsv(tables[0]!), 'text/csv')}>CSV</button>
          {sheet && <button className="btn small" data-testid="nest-dxf1" onClick={() => dl(`${name}_sheet${sheet.id}.dxf`, nestSheetDxf(sheet, res.opts.margin), 'application/dxf')}>DXF לוח {sheet.id}</button>}
        </div>
        {res.unplaced.map((u, i) => <div key={i} className="fit-no" data-testid="nest-unplaced-row">● {u.mark} × {u.qty}: {u.reason}</div>)}
        <table className="tbl" style={{ marginTop: 8 }} data-testid="nest-table"><thead><tr>{tables[0]!.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{tables[0]!.rows.map((r, i) => <tr key={i} className={sheet && r[0] === sheet.id ? 'on' : ''} style={{ cursor: typeof r[0] === 'number' ? 'pointer' : undefined }} onClick={() => typeof r[0] === 'number' && setSel(r[0])}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
        {sheet && <svg data-testid="nest-svg" viewBox={`-20 -20 ${sheet.w + 40} ${sheet.h + 40}`} style={{ width: '100%', maxHeight: 340, marginTop: 8, background: 'var(--bg2, #f6f7f9)', border: '1px solid var(--line, #ccd)' }} role="img" aria-label={`לוח ${sheet.id}`}>
          <g transform={`translate(0 ${sheet.h}) scale(1 -1)`}>
            <rect x={0} y={0} width={sheet.w} height={sheet.h} fill="none" stroke="#888" strokeWidth={3} />
            {sheet.items.map((it, i) => <g key={i}><polygon points={it.poly.map((q) => `${q.x},${q.y}`).join(' ')} fill="#cfe0f5" stroke="#1f4e8c" strokeWidth={2} />{it.holes.map((h, k) => <circle key={k} cx={h.x} cy={h.y} r={h.d / 2} fill="#fff" stroke="#c0392b" strokeWidth={1.5} />)}</g>)}
          </g>
          {sheet.items.map((it, i) => { const cx = it.poly.reduce((a, q) => a + q.x, 0) / it.poly.length, cy = sheet.h - it.poly.reduce((a, q) => a + q.y, 0) / it.poly.length; return <text key={i} x={cx} y={cy} fontSize={Math.max(24, sheet.w / 90)} textAnchor="middle" fill="#123">{it.mark}</text>; })}
        </svg>}
      </div>}
    </Dialog>
  );
}
