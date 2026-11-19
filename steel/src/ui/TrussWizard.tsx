import { useMemo } from 'react';
import { hasPanelLens, panelLocks, panelsOnFrames, patternCells, resizeSpec, setPanelLen, unlockPanel, TRUSS_GROUP_HE, TRUSS_PATTERNS, trussFractions, trussPanelLens, trussUtil } from '../geometry/truss';
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
export function TrussWizard({ spec, span, onChange, chordFamilies, loads, testId = 'tw', note, roof, frames, readOnlyProfiles }: {
  spec: TrussSpec; span: number; onChange: (s: TrussSpec) => void; chordFamilies: string[];
  loads: { q?: number; points?: [number, number][] }; testId?: string; note?: string;
  /** מסבך גג: צורת החגורות בשרטוט (רכס/חד-שיפועי, אופקית/מקבילה/מספריים) */
  roof?: { ridge: boolean; shape: 'flat' | 'parallel' | 'scissor'; rise: number; onRise: (v: number) => void };
  /** מיקומי מסגרות לאורך המסבך (מ"מ מההתחלה) — לכפתור "צמתים על המסגרות" */
  frames?: number[];
  /** החתכים נבחרים במקום אחר (חלון האלמנט) — כאן תצוגה בלבד */
  readOnlyProfiles?: boolean;
}) {
  const n = spec.panels;
  const W = 300, H = 124, x0 = 18, x1 = 282, yT = 36, yB = 84;
  // מיקום הצמתים — שדות שווים או לפי panelLens
  const fr = trussFractions(spec);
  const lens = trussPanelLens(spec, span);
  const px = (i: number) => x0 + (x1 - x0) * (fr[i] ?? i / n);
  // גובה החגורות בצמת i (שרטוט סכמטי)
  const tri = (i: number) => (roof?.ridge ? 1 - Math.abs(i - n / 2) / (n / 2) : fr[i] ?? i / n);
  const yTop = (i: number) => (roof ? yT - 14 * tri(i) : yT);
  const riseV = roof?.shape === 'scissor' && roof.ridge ? Math.min(0.75 * (yB - yT), ((yB - yT) * roof.rise) / Math.max(spec.depth, 1)) : 0;
  const yBot = (i: number) => (!roof ? yB : roof.shape === 'parallel' ? yTop(i) + (yB - yT) : yB - riseV * (roof.ridge ? 1 - Math.abs(i - n / 2) / (n / 2) : 0));
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
  /** שינוי אורך שדה i: השדה ננעל באורך שהוזן; שדות שנקבעו ידנית נשארים; החופשיים מתחלקים שווה ביתרה */
  const setLen = (i: number, v: number) => onChange(setPanelLen(spec, span, i, v));
  const locks = panelLocks(spec);
  const toggleLock = (i: number) => onChange(locks[i] ? unlockPanel(spec, span, i) : setPanelLen(spec, span, i, lens[i]));
  const util = useMemo(() => trussUtil(spec, span, loads), [spec, span, loads]);
  const uOf = (g: keyof TrussSpec['profiles']) => util.find((u) => u.group === g);
  // משקל משוער
  const kg = useMemo(() => {
    const kgm = (pr: string) => { const p = tryProfile(pr); return p ? massPerMeter(p, 7850) : 0; };
    let w = (span / 1000) * (kgm(spec.profiles.top) + kgm(spec.profiles.bottom));
    spec.cells.forEach((c, i) => { const diag = Math.hypot(lens[i] ?? span / n, spec.depth) / 1000; const k = (c === 'X' ? 2 : c ? 1 : 0) * diag * kgm(i === 0 || i === n - 1 ? spec.profiles.endDiag : spec.profiles.diag); w += k; });
    w += spec.verts.filter(Boolean).length * (spec.depth / 1000) * kgm(spec.profiles.vert);
    return w * 1.06; // + צמתים/פלטות
  }, [spec, span, n, lens]);
  const members = spec.cells.reduce((a, c) => a + (c === 'X' ? 3 : c ? 1 : 0), 0) + spec.verts.filter(Boolean).length;
  const dims: SDim[] = [
    { a: [x1 + 3, yTop(n)], b: [x1 + 3, yBot(n)], off: -6, value: spec.depth, testId: `${testId}-depth`, min: 300, onCommit: (v) => set({ depth: Math.round(v) }) },
    ...(roof?.shape === 'scissor' && roof.ridge ? [{ a: [px(n / 2) + 4, yB], b: [px(n / 2) + 4, yBot(n / 2)], off: -6, value: roof.rise, text: `${Math.round(roof.rise)} (הגבהה)`, testId: `${testId}-rise`, min: 0, onCommit: (v: number) => roof.onRise(Math.round(v)) } as SDim] : []),
    // אורך כל שדה — לחיצה לעריכה (השאר מתאימים את עצמם כך שסכום = מפתח); ברכס — בחלוקה סימטרית בלבד
    ...(n <= 16 ? lens.map((L, i) => ({ a: [px(i), yB + 14], b: [px(i + 1), yB + 14], off: 0, value: L, text: (n > 10 ? `${(L / 1000).toFixed(1)}` : `${Math.round(L)}`) + (locks[i] ? '*' : ''), testId: `${testId}-pl-${i}`, min: 200, max: span - 200 * (n - 1), onCommit: (v: number) => setLen(i, v) } as SDim))
      : [{ a: [px(0), yB + 14], b: [px(1), yB + 14], off: 0, value: lens[0], derived: true, text: `${Math.round(lens[0])} (שדה)` } as SDim]),
    { a: [px(0), yB + 26], b: [px(n), yB + 26], off: 0, value: span, derived: true, text: `${Math.round(span)} (מפתח)` },
  ];
  return (
    <div className="truss-wiz" data-testid={testId}>
      <Schematic w={W} h={H} dims={dims} testId={`${testId}-sch`} caption="לחיצה על שדה: ╱ ╲ X ריק · על צומת תחתון: אנך · על ✂ בחגורה: חיבור המשך · על ■/□ מתחת לשדה: קבוע/חופשי · על הגובה / אורך שדה ✎">
        {/* שדות לחיצה */}
        {Array.from({ length: n }, (_, i) => (
          <polygon key={`c${i}`} points={`${px(i) + 1},${yTop(i) + 1} ${px(i + 1) - 1},${yTop(i + 1) + 1} ${px(i + 1) - 1},${yBot(i + 1) - 1} ${px(i) + 1},${yBot(i) - 1}`} className="tw-cell" data-testid={`${testId}-cell-${i}`} onClick={() => setCell(i)} />
        ))}
        <polyline points={Array.from({ length: n + 1 }, (_, i) => `${px(i)},${yTop(i)}`).join(' ')} fill="none" stroke={COLORS.top} strokeWidth={3} />
        <polyline points={Array.from({ length: n + 1 }, (_, i) => `${px(i)},${yBot(i)}`).join(' ')} fill="none" stroke={COLORS.bottom} strokeWidth={3} />
        {spec.cells.map((c, i) => {
          const col = i === 0 || i === n - 1 ? COLORS.endDiag : COLORS.diag;
          return (
            <g key={`d${i}`} pointerEvents="none">
              {(c === '/' || c === 'X') && <line x1={px(i)} y1={yBot(i)} x2={px(i + 1)} y2={yTop(i + 1)} stroke={col} strokeWidth={1.8} />}
              {(c === '\\' || c === 'X') && <line x1={px(i)} y1={yTop(i)} x2={px(i + 1)} y2={yBot(i + 1)} stroke={col} strokeWidth={1.8} />}
              {c === '' && <text x={(px(i) + px(i + 1)) / 2} y={(yTop(i) + yBot(i + 1)) / 2} className="sm-lbl-s" textAnchor="middle">ריק</text>}
            </g>
          );
        })}
        {spec.verts.map((v, i) => v && <line key={`v${i}`} x1={px(i)} y1={yTop(i)} x2={px(i)} y2={yBot(i)} stroke={COLORS.vert} strokeWidth={1.6} pointerEvents="none" />)}
        {Array.from({ length: n + 1 }, (_, i) => (
          <g key={`n${i}`}>
            <circle cx={px(i)} cy={yTop(i)} r={1.6} className="tw-node" />
            <circle cx={px(i)} cy={yBot(i)} r={2.6} className={`tw-node click${spec.verts[i] ? ' on' : ''}`} data-testid={`${testId}-node-${i}`} onClick={() => setVert(i)} />
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => {
          const on = splices.includes(i), xm = (px(i) + px(i + 1)) / 2, ym = (yTop(i) + yTop(i + 1)) / 2;
          return (
            <g key={`s${i}`} className={`tw-spl${on ? ' on' : ''}`} data-testid={`${testId}-spl-${i}`} onClick={() => toggleSplice(i)}>
              <rect x={xm - 3.5} y={ym - 12} width={7} height={8} rx={1.5} />
              <text x={xm} y={ym - 6.6} textAnchor="middle">✂</text>
              {on && <line x1={xm} y1={ym - 3} x2={xm} y2={(yBot(i) + yBot(i + 1)) / 2 + 3} className="tw-spl-line" />}
            </g>
          );
        })}
        {/* קביעת שדה על השרטוט (1.35): ■ = קבוע, □ = מתחלק אוטומטית — לחיצה מחליפה */}
        {n <= 16 && lens.map((L, i) => {
          const xm = (px(i) + px(i + 1)) / 2;
          return (
            <g key={`k${i}`} className={`tw-pin${locks[i] ? ' on' : ''}`} data-testid={`${testId}-lock-${i}`} aria-pressed={locks[i]} role="button" onClick={() => toggleLock(i)}>
              <title>{locks[i] ? `שדה ${i + 1} קבוע (${Math.round(L)}) — לחיצה לשחרור` : `שדה ${i + 1} מתחלק אוטומטית — לחיצה לקיבוע`}</title>
              <rect x={xm - 3} y={yB + 4.5} width={6} height={5} rx={1} />
            </g>
          );
        })}
        <polygon points={`${x0},${yBot(0)} ${x0 - 4},${yBot(0) + 6} ${x0 + 4},${yBot(0) + 6}`} className="sm-host" />
        <polygon points={`${x1},${yBot(n)} ${x1 - 4},${yBot(n) + 6} ${x1 + 4},${yBot(n) + 6}`} className="sm-host" />
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
        <button className={`tbtn${!hasPanelLens(spec) ? ' on' : ''}`} data-testid={`${testId}-eq`} title="כל השדות באורך שווה" onClick={() => set({ panelLens: undefined, lockedLens: undefined })}>שדות שווים</button>
        {frames && frames.length > 0 && <button className="tbtn" data-testid={`${testId}-onframes`} title="חלוקה כך שכל קורת גג יושבת על צומת" onClick={() => onChange(panelsOnFrames(spec, span, frames))}>צמתים על המסגרות</button>}
      </div>
      <div className="hint" style={{ margin: '0 0 4px' }} data-testid={`${testId}-locks`}>אורך שדה שמוזן נקבע (■ מתחת לשדה, * במידה); השדות שלא נקבעו (□) מתחלקים שווה במה שנשאר. לחיצה על ■/□ מקבעת או משחררת. "שדות שווים" — מבטל את כל הקביעות.</div>
      <div className="tw-row">
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
              <td>{readOnlyProfiles ? <span className="mono" data-testid={`${testId}-pv-${g}`}>{spec.profiles[g]}</span> : <ProfilePicker testId={`${testId}-p-${g}`} value={spec.profiles[g]} families={g === 'top' || g === 'bottom' ? chordFamilies : ['SHS', 'RHS', 'CHS', 'L', 'UPN']} onCommit={(v) => set({ profiles: { ...spec.profiles, [g]: v } })} />}</td>
              <td className={`num ${cls}`} title={u?.note}>{u ? u.util.toFixed(2) : '—'}</td>
            </tr>
          );
        })}</tbody></table>
      <div className="hint" data-testid={`${testId}-sum`}>משקל ≈ {Math.round(kg).toLocaleString('en-US')} ק"ג · {members} מוטות במילוי · ניצול מקס' {Math.max(...util.map((u) => u.util)).toFixed(2)} — הערכת אצבע (כוח בחגורה = M/גובה), לא תכן. {note}</div>
    </div>
  );
}
