import { useState } from 'react';
import type { BuildingParams } from '../model/types';
import { LenField, NumField } from './fields';

export type TriCalc = 'col' | 'top' | 'slope';

/**
 * גובה עמוד / גובה רכס / שיפוע (בקשת משתמש 18.11.2026): מזינים שניים — השלישי מחושב.
 * השדה המחושב מסומן בכפתור "מחושב" בשורה שלו (אפשר להעביר לשדה אחר בלחיצה) ומוצג לקריאה בלבד.
 * col/top במ"מ, slope ב-%; run = מרחק אופקי בין נקודות הייחוס.
 */
export function TriDims({ col, top, run, calc, onCalc, onCommit, unit, labels, testId = 'tri', fieldIds }: {
  col: number; top: number; run: number; calc: TriCalc; onCalc: (c: TriCalc) => void;
  onCommit: (v: { col: number; top: number }) => void; unit: 'm' | 'mm';
  labels: { col: string; top: string }; testId?: string;
  /** מזהי בדיקה לשדות הקלט (ברירת מחדל: testId-col / -top / -slope) */
  fieldIds?: Partial<Record<TriCalc, string>>;
}) {
  const fid = (f: TriCalc) => fieldIds?.[f] ?? `${testId}-${f}`;
  const slope = run > 0 ? ((top - col) / run) * 100 : 0;
  const fmtLen = (mm: number) => (unit === 'm' ? (mm / 1000).toFixed(3) : String(Math.round(mm)));
  const edit = (f: TriCalc, v: number) => {
    // השדה שלא נערך ואינו מחושב — נשמר; המחושב מתעדכן
    if (f === 'slope') return onCommit(calc === 'col' ? { col: top - (v / 100) * run, top } : { col, top: col + (v / 100) * run });
    if (f === 'col') return onCommit(calc === 'top' ? { col: v, top: v + (slope / 100) * run } : { col: v, top });
    return onCommit(calc === 'col' ? { col: v - (slope / 100) * run, top: v } : { col, top: v });
  };
  const row = (f: TriCalc, label: string, field: JSX.Element, shown: string) => (
    <div className={`tri-row${calc === f ? ' calc' : ''}`} data-testid={`${testId}-row-${f}`}>
      <label>{label}</label>
      {calc === f ? <span className="tri-out mono" data-testid={`${fid(f)}-out`}>{shown}</span> : field}
      <button type="button" className={`tri-calc${calc === f ? ' on' : ''}`} role="radio" aria-checked={calc === f} data-testid={`${testId}-calc-${f}`}
        title={calc === f ? 'השדה הזה מחושב משני האחרים' : 'לחץ כדי שהשדה הזה יחושב (ושני האחרים יוזנו)'} onClick={() => onCalc(f)}>
        {calc === f ? '= מחושב' : 'חשב'}
      </button>
    </div>
  );
  return (
    <div className="tri" role="radiogroup" aria-label="מה מחושב" data-testid={testId}>
      {row('col', labels.col, <LenField testId={fid('col')} mm={col} unit={unit} onCommit={(v) => edit('col', v)} />, fmtLen(col))}
      {row('top', labels.top, <LenField testId={fid('top')} mm={top} unit={unit} onCommit={(v) => edit('top', v)} />, fmtLen(top))}
      {row('slope', 'שיפוע', <NumField testId={fid('slope')} value={Math.round(slope * 1000) / 1000} suffix="%" onCommit={(v) => edit('slope', v)} />, `${slope.toFixed(2)}%`)}
    </div>
  );
}

/**
 * מבנה 2 צירים (קלאסי): דו-שיפועי — גובה עמוד א / גובה רכס / שיפוע שמאל (עמוד ב באותו גובה, אלא אם בוטל);
 * חד-שיפועי — גובה עמוד א / גובה עמוד ב / שיפוע.
 */
export function ClassicRoofDims({ b, unit, set, testId = 'cl', ids }: {
  b: Pick<BuildingParams, 'roofType' | 'eaveLeft' | 'eaveRight' | 'ridgeX' | 'slopeLeftPct' | 'width'>; unit: 'm' | 'mm';
  set: (p: Partial<BuildingParams>) => void; testId?: string; ids?: { col?: string; top?: string; slope?: string; right?: string };
}) {
  const [calc, setCalc] = useState<TriCalc>('top');
  const linked = Math.abs(b.eaveRight - b.eaveLeft) < 0.5;
  const [sameR, setSameR] = useState<boolean>(linked);
  if (b.roofType === 'mono') {
    return (<>
      <TriDims testId={testId} unit={unit} col={b.eaveLeft} top={b.eaveRight} run={b.width} calc={calc} onCalc={setCalc}
        labels={{ col: 'גובה עמוד א (שמאל)', top: 'גובה עמוד ב (ימין)' }} fieldIds={{ col: ids?.col ?? 'eaveLeft', top: ids?.top ?? 'eaveRight', slope: ids?.slope ?? 'slopeLeft' }}
        onCommit={(v) => set({ eaveLeft: v.col, eaveRight: v.top })} />
      <HeightNote />
    </>);
  }
  const run = Math.max(1, b.ridgeX);
  const ridge = b.eaveLeft + (b.slopeLeftPct / 100) * run;
  return (
    <>
      <TriDims testId={testId} unit={unit} col={b.eaveLeft} top={ridge} run={run} calc={calc} onCalc={setCalc}
        labels={{ col: sameR ? 'גובה עמודים (א, ב)' : 'גובה עמוד א (שמאל)', top: 'גובה רכס' }} fieldIds={{ col: ids?.col ?? 'eaveLeft', top: ids?.top ?? 'ridgeZ', slope: ids?.slope ?? 'slopeLeft' }}
        onCommit={(v) => set({ eaveLeft: v.col, slopeLeftPct: Math.round(((v.top - v.col) / run) * 100 * 10000) / 10000, ...(sameR ? { eaveRight: v.col } : {}) })} />
      <label className="row" style={{ margin: '2px 0' }}><input type="checkbox" data-testid={`${testId}-same-r`} checked={sameR} onChange={(e) => { setSameR(e.target.checked); if (e.target.checked) set({ eaveRight: b.eaveLeft }); }} />עמוד ב (ימין) באותו גובה — גג סימטרי בגובה</label>
      {!sameR && <div className="field"><label>גובה עמוד ב (ימין)</label><LenField testId={ids?.right ?? 'eaveRight'} mm={b.eaveRight} unit={unit} onCommit={(v) => set({ eaveRight: v })} /></div>}
      <HeightNote />
    </>
  );
}

/** הבהרה: "גובה עמוד" = פני עליון קורת הגג בציר העמוד (לא ראש העמוד ולא פני הגג) */
export function HeightNote() {
  return <div className="hint" data-testid="height-note">הגבהים כאן — <b>פני עליון קורת הגג (פלדה) בציר העמוד</b>. ראש העמוד נמוך יותר בעומק הקורה ובפלטות החיבור; פני הגג הגמור גבוהים יותר בפטה ובפנל. בשרטוט החתך ("צירים, מסגרות וגבהים") אפשר לבחור לאיזה מפלס הגבהים מתייחסים.</div>;
}
