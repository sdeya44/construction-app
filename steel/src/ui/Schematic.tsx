import { useRef, useState, type ReactNode } from 'react';

/**
 * שרטוט סכמטי אינטראקטיבי: אלמנטים + מידות. מידה עם onCommit מסומנת ככפתור — לחיצה פותחת שדה עריכה במקום.
 * קואורדינטות: יחידות viewBox (y כלפי מטה). כל הטקסט בעברית/מספרים.
 */
export interface SDim {
  /** נקודות המדידה */
  a: [number, number]; b: [number, number];
  /** היסט קו המידה בניצב (יחידות viewBox; חיובי = שמאלה מכיוון a→b) */
  off: number;
  value: number;
  /** תווית לתצוגה (ברירת מחדל: הערך המעוגל) */
  text?: string;
  unit?: string;
  testId?: string;
  onCommit?: (v: number) => void;
  min?: number; max?: number;
  /** הצגת התווית בלבד (ללא קו) — למשל זווית */
  labelOnly?: boolean;
  /** מיקום תווית מפורש (labelOnly) */
  at?: [number, number];
  /** מידה מחושבת — אפורה */
  derived?: boolean;
}

export function Schematic({ w, h, children, dims, testId, caption }: { w: number; h: number; children: ReactNode; dims: SDim[]; testId?: string; caption?: string }) {
  const [edit, setEdit] = useState<{ i: number; v: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const label = (d: SDim) => d.text ?? `${Math.round(d.value * 10) / 10}${d.unit ?? ''}`;
  const geom = (d: SDim) => {
    const [ax, ay] = d.a, [bx, by] = d.b;
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / L, ny = (bx - ax) / L;
    const A = [ax + nx * d.off, ay + ny * d.off], B = [bx + nx * d.off, by + ny * d.off];
    const mid = d.at ?? [(A[0] + B[0]) / 2 + nx * 5, (A[1] + B[1]) / 2 + ny * 5];
    let ang = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    return { A, B, mid, ang, nx, ny };
  };
  const commit = () => {
    if (!edit) return;
    const d = dims[edit.i];
    let v = Number(edit.v.replace(',', '.'));
    if (Number.isFinite(v) && d.onCommit) {
      if (d.min !== undefined) v = Math.max(d.min, v);
      if (d.max !== undefined) v = Math.min(d.max, v);
      if (Math.abs(v - d.value) > 1e-9) d.onCommit(v);
    }
    setEdit(null);
  };
  const editPos = edit ? geom(dims[edit.i]).mid : null;
  return (
    <div className="schem" ref={box} data-testid={testId}>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={caption ?? 'שרטוט'}>
        <defs>
          <marker id="sarr" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" className="sd-arrow" /></marker>
        </defs>
        {children}
        {dims.map((d, i) => {
          const g = geom(d);
          const live = !!d.onCommit;
          return (
            <g key={i} className={`sdim${live ? ' live' : ''}${d.derived ? ' derived' : ''}`}>
              {!d.labelOnly && <>
                <line x1={d.a[0]} y1={d.a[1]} x2={g.A[0] + g.nx * 1.2 * Math.sign(d.off || 1)} y2={g.A[1] + g.ny * 1.2 * Math.sign(d.off || 1)} className="sd-ext" />
                <line x1={d.b[0]} y1={d.b[1]} x2={g.B[0] + g.nx * 1.2 * Math.sign(d.off || 1)} y2={g.B[1] + g.ny * 1.2 * Math.sign(d.off || 1)} className="sd-ext" />
                <line x1={g.A[0]} y1={g.A[1]} x2={g.B[0]} y2={g.B[1]} className="sd-line" markerStart="url(#sarr)" markerEnd="url(#sarr)" />
              </>}
              <text x={g.mid[0]} y={g.mid[1]} transform={d.labelOnly ? undefined : `rotate(${g.ang} ${g.mid[0]} ${g.mid[1]})`} className="sd-text" textAnchor="middle" dominantBaseline="middle"
                data-testid={d.testId} onClick={live ? () => setEdit({ i, v: String(Math.round(d.value * 10) / 10) }) : undefined} role={live ? 'button' : undefined}>
                {label(d)}{live ? ' ✎' : ''}
              </text>
            </g>
          );
        })}
      </svg>
      {edit && editPos && (
        <input className="inp num schem-inp" autoFocus value={edit.v} data-testid={dims[edit.i].testId ? `${dims[edit.i].testId}-inp` : undefined}
          style={{ left: `${(editPos[0] / w) * 100}%`, top: `${(editPos[1] / h) * 100}%` }}
          onChange={(e) => setEdit({ ...edit, v: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEdit(null); }}
          onBlur={commit} />
      )}
      {caption && <div className="schem-cap">{caption}</div>}
    </div>
  );
}

/** אלמנטים גרפיים נפוצים לשרטוט הסכמטי */
export const S = {
  /** פרופיל כפס עבה בין שתי נקודות */
  bar: (a: [number, number], b: [number, number], cls = 'sm-main', wdt = 3) => <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={cls} strokeWidth={wdt} />,
  plate: (pts: [number, number][], cls = 'sm-plate') => <polygon points={pts.map((p) => p.join(',')).join(' ')} className={cls} />,
  bolt: (c: [number, number], r = 1.6) => <circle cx={c[0]} cy={c[1]} r={r} className="sm-bolt" />,
  text: (p: [number, number], s: string, cls = 'sm-lbl', anchor: 'start' | 'middle' | 'end' = 'middle') => <text x={p[0]} y={p[1]} className={cls} textAnchor={anchor} dominantBaseline="middle">{s}</text>,
};
