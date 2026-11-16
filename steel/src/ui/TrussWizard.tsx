import { useMemo } from 'react';
import { patternCells, resizeSpec, TRUSS_GROUP_HE, TRUSS_PATTERNS, trussUtil } from '../geometry/truss';
import type { TrussCell, TrussSpec } from '../model/types';
import { massPerMeter, tryProfile } from '../profiles/library';
import { ProfilePicker } from './fields';
import { Schematic, type SDim } from './Schematic';

const NEXT: Record<TrussCell, TrussCell> = { '/': '\\', '\\': 'X', X: '', '': '/' };
const MIRROR: Record<TrussCell, TrussCell> = { '/': '\\', '\\': '/', X: 'X', '': '' };
const COLORS = { top: '#1f5fa8', bottom: '#1b6e3d', endDiag: '#b00020', diag: '#c4600a', vert: '#555' };

/**
 * אשף מסבך: עורך שדות בלחיצה (שדה: ╱ ╲ X ריק · צומת: אנך · חגורה באמצע שדה: ✂ חיבור המשך), תבניות, סימטריה,
 * מספר שדות וגובה (מידה בלחיצה), פרופיל לכל קבוצה (סוג ← מידה) עם הערכת ניצול, משקל משוער.
 */
export function TrussWizard({ spec, span, onChange, chordFamilies, loads, testId = 'tw', note }: {
  spec: TrussSpec; span: number; onChange: (s: TrussSpec) => void; chordFamilies: string[];
  loads: { q?: number; points?: [number, number][] }; testId?: string; note?: string;
}) {
  const n = spec.panels;
  const W = 300, H = 118, x0 = 18, x1 = 282, yT = 30, yB = 78;
  const px = (i: number) => x0 + ((x1 - x0) * i) / n;
  const sym = spec.symmetric ?? true;
  const set = (patch: Partial<TrussSpec>) => onChange({ ...spec, ...patch });
  const setCell = (i: number) => {
    const cells = [...spec.cells]; const c = NEXT[cells[i] ?? ''];
    cells[i] = c; if (sym) cells[n - 1 - i] = MIRROR[c];
    set({ cells, pattern: 'custom' });
  };
  const setVert = (i: number) => {
    const verts = [...spec.verts]; verts[i] = !verts[i]; if (sym) verts[n - i] = verts[i];
    set({ verts, pattern: 'custom' });
  };
  const splices = Array.isArray(spec.splice) ? spec.splice : [];
  const toggleSplice = (i: number) => {
    const cur = new Set(splices); if (cur.has(i)) cur.delete(i); else cur.add(i);
    set({ splice: [...cur].sort((a, b) => a - b) });
  };
  const util = useMemo(() => trussUtil(spec, span, loads), [spec, span, loads]);
  const uOf = (g: keyof TrussSpec['profiles']) => util.find((u) => u.group === g);
  // משקל משוער
  const kg = useMemo(() => {
    const kgm = (pr: string) => { const p = tryProfile(pr); return p ? massPerMeter(p, 7850) : 0; };
    const panel = span / n, diag = Math.hypot(panel, spec.depth) / 1000;
    let w = (span / 1000) * (kgm(spec.profiles.top) + kgm(spec.profiles.bottom));
    spec.cells.forEach((c, i) => { const k = (c === 'X' ? 2 : c ? 1 : 0) * diag * kgm(i === 0 || i === n - 1 ? spec.profiles.endDiag : spec.profiles.diag); w += k; });
    w += spec.verts.filter(Boolean).length * (spec.depth / 1000) * kgm(spec.profiles.vert);
    return w * 1.06; // + צמתים/פלטות
  }, [spec, span, n]);
  const members = spec.cells.reduce((a, c) => a + (c === 'X' ? 3 : c ? 1 : 0), 0) + spec.verts.filter(Boolean).length;
  const dims: SDim[] = [
    { a: [x1 + 3, yT], b: [x1 + 3, yB], off: -6, value: spec.depth, testId: `${testId}-depth`, min: 300, onCommit: (v) => set({ depth: Math.round(v) }) },
    { a: [px(0), yB + 18], b: [px(1), yB + 18], off: 0, value: span / n, derived: true, text: `${Math.round(span / n)} (שדה)` },
    { a: [px(0), yB + 30], b: [px(n), yB + 30], off: 0, value: span, derived: true, text: `${Math.round(span)} (מפתח)` },
  ];
  return (
    <div className="truss-wiz" data-testid={testId}>
      <Schematic w={W} h={H} dims={dims} testId={`${testId}-sch`} caption="לחיצה על שדה: ╱ ╲ X ריק · על צומת תחתון: אנך · על ✂ בחגורה: חיבור המשך · על הגובה ✎">
        {/* שדות לחיצה */}
        {Array.from({ length: n }, (_, i) => (
          <rect key={`c${i}`} x={px(i) + 1} y={yT + 1} width={px(i + 1) - px(i) - 2} height={yB - yT - 2} className="tw-cell" data-testid={`${testId}-cell-${i}`} onClick={() => setCell(i)} />
        ))}
        <line x1={x0} y1={yT} x2={x1} y2={yT} stroke={COLORS.top} strokeWidth={3} />
        <line x1={x0} y1={yB} x2={x1} y2={yB} stroke={COLORS.bottom} strokeWidth={3} />
        {spec.cells.map((c, i) => {
          const col = i === 0 || i === n - 1 ? COLORS.endDiag : COLORS.diag;
          return (
            <g key={`d${i}`} pointerEvents="none">
              {(c === '/' || c === 'X') && <line x1={px(i)} y1={yB} x2={px(i + 1)} y2={yT} stroke={col} strokeWidth={1.8} />}
              {(c === '\\' || c === 'X') && <line x1={px(i)} y1={yT} x2={px(i + 1)} y2={yB} stroke={col} strokeWidth={1.8} />}
              {c === '' && <text x={(px(i) + px(i + 1)) / 2} y={(yT + yB) / 2} className="sm-lbl-s" textAnchor="middle">ריק</text>}
            </g>
          );
        })}
        {spec.verts.map((v, i) => v && <line key={`v${i}`} x1={px(i)} y1={yT} x2={px(i)} y2={yB} stroke={COLORS.vert} strokeWidth={1.6} pointerEvents="none" />)}
        {Array.from({ length: n + 1 }, (_, i) => (
          <g key={`n${i}`}>
            <circle cx={px(i)} cy={yT} r={1.6} className="tw-node" />
            <circle cx={px(i)} cy={yB} r={2.6} className={`tw-node click${spec.verts[i] ? ' on' : ''}`} data-testid={`${testId}-node-${i}`} onClick={() => setVert(i)} />
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => {
          const on = splices.includes(i), xm = (px(i) + px(i + 1)) / 2;
          return (
            <g key={`s${i}`} className={`tw-spl${on ? ' on' : ''}`} data-testid={`${testId}-spl-${i}`} onClick={() => toggleSplice(i)}>
              <rect x={xm - 3.5} y={yT - 12} width={7} height={8} rx={1.5} />
              <text x={xm} y={yT - 6.6} textAnchor="middle">✂</text>
              {on && <line x1={xm} y1={yT - 3} x2={xm} y2={yB + 3} className="tw-spl-line" />}
            </g>
          );
        })}
        <polygon points={`${x0},${yB} ${x0 - 4},${yB + 6} ${x0 + 4},${yB + 6}`} className="sm-host" />
        <polygon points={`${x1},${yB} ${x1 - 4},${yB + 6} ${x1 + 4},${yB + 6}`} className="sm-host" />
      </Schematic>
      <div className="tw-row">
        <span className="tw-lbl">תבנית:</span>
        {TRUSS_PATTERNS.map((p) => <button key={p.id} className={`tbtn${spec.pattern === p.id ? ' on' : ''}`} data-testid={`${testId}-pat-${p.id}`} onClick={() => set({ ...patternCells(p.id, n), pattern: p.id })}>{p.label}</button>)}
        <button className={`tbtn${sym ? ' on' : ''}`} data-testid={`${testId}-sym`} onClick={() => set({ symmetric: !sym })}>סימטרי ⇆</button>
      </div>
      <div className="tw-row">
        <span className="tw-lbl">שדות:</span>
        <button className="btn small" data-testid={`${testId}-n-`} onClick={() => n > 2 && onChange(resizeSpec(spec, n - 1))}>−</button><b data-testid={`${testId}-n`}>{n}</b>
        <button className="btn small" data-testid={`${testId}-n+`} onClick={() => onChange(resizeSpec(spec, n + 1))}>+</button>
        <span className="tw-lbl">חלוקה להובלה:</span>
        <select className="inp" data-testid={`${testId}-splice`} value={Array.isArray(spec.splice) ? 'manual' : spec.splice} onChange={(e) => set({ splice: e.target.value === 'manual' ? [] : (e.target.value as 'auto' | 'none') })}>
          <option value="auto">אוטומטית ≤ אורך מוט</option><option value="manual">ידנית (✂ על השדה)</option><option value="none">ללא</option>
        </select>
      </div>
      <table className="mini-table tw-prof"><thead><tr><th>קבוצה</th><th>פרופיל (סוג ← מידה)</th><th>ניצול</th></tr></thead>
        <tbody>{(Object.keys(TRUSS_GROUP_HE) as (keyof TrussSpec['profiles'])[]).map((g) => {
          const u = uOf(g);
          const cls = !u ? '' : u.util > 1 ? 'sz-small' : u.util < 0.3 ? 'sz-big' : 'sz-ok';
          return (
            <tr key={g}>
              <td><span className="tw-sw" style={{ background: COLORS[g] }} />{TRUSS_GROUP_HE[g]}</td>
              <td><ProfilePicker testId={`${testId}-p-${g}`} value={spec.profiles[g]} families={g === 'top' || g === 'bottom' ? chordFamilies : ['SHS', 'RHS', 'CHS', 'L', 'UPN']} onCommit={(v) => set({ profiles: { ...spec.profiles, [g]: v } })} /></td>
              <td className={`num ${cls}`} title={u?.note}>{u ? u.util.toFixed(2) : '—'}</td>
            </tr>
          );
        })}</tbody></table>
      <div className="hint" data-testid={`${testId}-sum`}>משקל ≈ {Math.round(kg).toLocaleString('en-US')} ק"ג · {members} מוטות במילוי · ניצול מקס' {Math.max(...util.map((u) => u.util)).toFixed(2)} — הערכת אצבע (כוח בחגורה = M/גובה), לא תכן. {note}</div>
    </div>
  );
}
