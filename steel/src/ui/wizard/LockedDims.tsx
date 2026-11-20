import { useEffect, useState } from 'react';
import { LockIc } from '../LiveView3D';

/**
 * 1.60: מערכת מידות נעולות כללית (DimSystem) למשולש ישר-זווית — אלכסון שמוגדר בשני פרמטרים: ירידה (v) וזווית (ang).
 * ארבע מידות: v (אנכי), h (אופקי), ang (זווית מהאופק), L (אורך צירי). שתי מידות נעולות קובעות את השאר.
 * הפתרון אנליטי ומדויק; צמד שאין לו פתרון (למשל אורך קטן מהאנכי) — מסומן "לא תקין" ולא נשמר.
 */
export type TDim = 'v' | 'h' | 'ang' | 'L';
const ORDER: TDim[] = ['v', 'h', 'ang', 'L'];
const R = Math.PI / 180;
export function triMeasure(v: number, ang: number): Record<TDim, number> {
  const h = v / Math.tan(ang * R), L = v / Math.sin(ang * R);
  return { v, h, ang, L };
}
/** שתי מידות → (v, ang); null אם אין פתרון */
export function triSolve(a: TDim, av: number, b: TDim, bv: number): { v: number; ang: number } | null {
  const g: Partial<Record<TDim, number>> = { [a]: av, [b]: bv };
  if (a === b || !(av > 0) || !(bv > 0)) return null;
  const { v, h, ang, L } = g;
  let out: { v: number; ang: number } | null = null;
  if (v != null && ang != null) out = { v, ang };
  else if (v != null && h != null) out = { v, ang: Math.atan2(v, h) / R };
  else if (v != null && L != null) out = L > v ? { v, ang: Math.asin(v / L) / R } : null;
  else if (h != null && ang != null) out = { v: h * Math.tan(ang * R), ang };
  else if (h != null && L != null) out = L > h ? { v: Math.sqrt(L * L - h * h), ang: Math.acos(h / L) / R } : null;
  else if (ang != null && L != null) out = { v: L * Math.sin(ang * R), ang };
  if (!out || !(out.ang > 5 && out.ang < 85) || !(out.v > 0)) return null;
  return out;
}

export function LockedDims({ v, ang, labels, onCommit, testPre = 'ld', initLocks = ['v', 'ang'] }: {
  v: number; ang: number; labels: Record<TDim, { t: string; sub: string }>; onCommit: (v: number, ang: number) => void; testPre?: string; initLocks?: [TDim, TDim];
}) {
  const [locks, setLocks] = useState<TDim[]>(initLocks);
  const [bad, setBad] = useState<string | null>(null);
  const m = triMeasure(v, ang);
  const toggle = (k: TDim) => setLocks((L) => (L.includes(k) ? L : [L[L.length - 1], k]));
  const commit = (k: TDim, val: number) => {
    if (!Number.isFinite(val)) return;
    const L2 = locks.includes(k) ? locks : [locks[locks.length - 1], k];
    setLocks(L2);
    const other = L2.find((x) => x !== k)!;
    const r = triSolve(k, val, other, m[other]);
    if (!r) { setBad(`אין אלכסון עם ${labels[k].t} ${Math.round(val)} ו${labels[other].t} ${Math.round(m[other])} — בחרו ערך אחר או מידה קובעת אחרת`); return; }
    setBad(null);
    onCommit(Math.round(r.v), Math.round(r.ang * 10) / 10);
  };
  return (
    <div className="ld" data-testid={`${testPre}-dims`}>
      <div className="ks-note">שתי מידות קובעות (מנעול סגור) — השאר נגזרות. מידות צירים (ציר לציר).</div>
      {ORDER.map((k) => (
        <div key={k} className={`ks-dim${locks.includes(k) ? ' lk' : ''}`} data-state={locks.includes(k) ? 'locked' : 'computed'} data-testid={`${testPre}-row-${k}`}>
          <button className={`ks-lock${locks.includes(k) ? ' on' : ''}`} onClick={() => toggle(k)} aria-pressed={locks.includes(k)} aria-label={`${labels[k].t} — ${locks.includes(k) ? 'קובעת' : 'נגזרת'}`} data-testid={`${testPre}-lock-${k}`}><LockIc on={locks.includes(k)} /></button>
          <span className="ks-dl"><b>{labels[k].t}</b><small>{labels[k].sub}</small></span>
          <Inp k={k} v={m[k]} onCommit={(x) => commit(k, x)} testId={`${testPre}-${k}`} />
          <span className="ks-u">{k === 'ang' ? '°' : 'מ"מ'}</span>
        </div>
      ))}
      {bad && <div className="ks-pair-bad" data-testid={`${testPre}-bad`}>{bad}</div>}
    </div>
  );
}
function Inp({ k, v, onCommit, testId }: { k: TDim; v: number; onCommit: (v: number) => void; testId: string }) {
  const f = (x: number) => (k === 'ang' ? x.toFixed(1) : String(Math.round(x)));
  const [t, setT] = useState(f(v));
  useEffect(() => setT(f(v)), [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="inp num ks-in" value={t} data-testid={testId} inputMode="decimal" onChange={(e) => setT(e.target.value)}
    onKeyDown={(e) => { if (e.key === 'Enter') onCommit(Number(t.replace(',', '.'))); if (e.key === 'Escape') setT(f(v)); }} onBlur={() => { if (t !== f(v)) onCommit(Number(t.replace(',', '.'))); }} />;
}
