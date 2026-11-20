import { useMemo, useState } from 'react';
import { CommandError } from '../commands/commands';
import { uniformFrames } from '../model/defaults';
import type { BuildingParams, Project } from '../model/types';
import { validateBuilding } from '../model/validate';
import { store, useStore } from '../store';
import { LenField, NumField, ProfilePicker, TextField } from './fields';
import type { NavKey } from './SideNav';

/**
 * גיליון פרמטרים: כל המספרים המרכזיים של המבנה בטבלה אחת.
 * עריכה בטבלה משנה את המודל מייד; "חריגים" = אלמנטים עם חתך משלהם; השוואה למהדורה המאושרת האחרונה.
 */
type Kind = 'len' | 'num' | 'pct' | 'profile' | 'bool' | 'text' | 'ro' | { opts: [string, string][] };
interface Row {
  g: string; label: string; kind: Kind; nav: NavKey;
  get: (p: Project) => unknown;
  mut?: (b: BuildingParams, v: never) => void;
  show?: (p: Project) => boolean;
  /** סוג אלמנט — לספירת חריגי חתך */
  ovKind?: string;
  fam?: string[];
}

const len = (p: Project) => { const f = p.building.frames; return f.length ? f[f.length - 1]!.y - f[0]!.y : 0; };
const uniform = (p: Project) => { const f = p.building.frames; if (f.length < 2) return true; const d = f[1]!.y - f[0]!.y; return f.every((x, i) => !i || Math.abs(x.y - f[i - 1]!.y - d) < 1); };
const classic = (p: Project) => !p.building.section;
const gable = (p: Project) => classic(p) && p.building.roofType === 'gable';
const ROOF_HE: Record<string, string> = { gable: 'דו־שיפועי', mono: 'חד־שיפועי' };
const CLEAT_OPTS: [string, string][] = [['run', 'זוויתן שוכב'], ['stand', 'זוויתן עומד'], ['plate', 'פלטה + משולש']];
const LAYOUT_OPTS: [string, string][] = [['fixed', 'מרווח קבוע'], ['even', 'חלוקה שווה']];

const ROWS: Row[] = [
  { g: 'מבנה', label: 'סוג גג', kind: 'ro', nav: 's:geometry', get: (p) => (p.building.section ? 'חתך מודולרי' : ROOF_HE[p.building.roofType] ?? p.building.roofType) },
  { g: 'מבנה', label: 'רוחב (מפתח)', kind: 'len', nav: 's:geometry', show: classic, get: (p) => p.building.width, mut: (b, v: number) => { b.width = v; if (b.roofType === 'gable') b.ridgeX = v / 2; } },
  { g: 'מבנה', label: 'אורך המבנה', kind: 'len', nav: 's:geometry', get: len, mut: (b, v: number) => { const L = b.frames[b.frames.length - 1]!.y - b.frames[0]!.y; const y0 = b.frames[0]!.y; b.frames = b.frames.map((f) => ({ ...f, y: y0 + ((f.y - y0) * v) / (L || 1) })); } },
  { g: 'מבנה', label: 'מספר מסגרות', kind: 'num', nav: 's:geometry', get: (p) => p.building.frames.length, mut: (b, v: number) => { const L = b.frames[b.frames.length - 1]!.y - b.frames[0]!.y; const n = Math.round(v); if (n < 2 || n > 200) throw new CommandError('מספר מסגרות 2–200'); const fr = uniformFrames(n, L); b.frames = fr.map((f, i) => (b.frames[i] ? { ...f, id: b.frames[i]!.id } : f)); } },
  { g: 'מבנה', label: 'מרווח מסגרות', kind: 'ro', nav: 's:geometry', get: (p) => (uniform(p) ? `${(len(p) / Math.max(1, p.building.frames.length - 1) / 1000).toFixed(3)} מ' (אחיד)` : 'משתנה — בטבלת המסגרות') },
  { g: 'מבנה', label: 'גובה ציר א', kind: 'len', nav: 's:geometry', show: classic, get: (p) => p.building.eaveLeft, mut: (b, v: number) => { if (b.roofType === 'gable' && b.eaveLeft === b.eaveRight) b.eaveRight = v; b.eaveLeft = v; } },
  { g: 'מבנה', label: 'גובה ציר ב', kind: 'len', nav: 's:geometry', show: classic, get: (p) => p.building.eaveRight, mut: (b, v: number) => { b.eaveRight = v; } },
  { g: 'מבנה', label: 'שיפוע גג', kind: 'pct', nav: 's:geometry', show: gable, get: (p) => p.building.slopeLeftPct, mut: (b, v: number) => { b.slopeLeftPct = v; } },
  { g: 'מבנה', label: 'מפלס תחתית עמודים', kind: 'len', nav: 's:geometry', get: (p) => p.building.baseElevation, mut: (b, v: number) => { b.baseElevation = v; } },
  { g: 'מבנה', label: 'קונזולת קורה — שמאל', kind: 'len', nav: 's:geometry', show: classic, get: (p) => p.building.rafterOverhangLeft, mut: (b, v: number) => { b.rafterOverhangLeft = v; } },
  { g: 'מבנה', label: 'קונזולת קורה — ימין', kind: 'len', nav: 's:geometry', show: classic, get: (p) => p.building.rafterOverhangRight, mut: (b, v: number) => { b.rafterOverhangRight = v; } },
  { g: 'מבנה', label: 'קונזולת פטות — התחלה', kind: 'len', nav: 'r:left', get: (p) => p.building.purlinOverhangStart, mut: (b, v: number) => { b.purlinOverhangStart = v; } },
  { g: 'מבנה', label: 'קונזולת פטות — סוף', kind: 'len', nav: 'r:left', get: (p) => p.building.purlinOverhangEnd, mut: (b, v: number) => { b.purlinOverhangEnd = v; } },

  { g: 'חתכים וחומר', label: 'עמודים', kind: 'profile', fam: ['HEA', 'HEB', 'HEM', 'IPE', 'RHS', 'SHS'], ovKind: 'column', nav: 's:profiles', get: (p) => p.building.columnProfile, mut: (b, v: string) => { b.columnProfile = v; } },
  { g: 'חתכים וחומר', label: 'קורות גג', kind: 'profile', fam: ['IPE', 'HEA', 'HEB', 'RHS'], ovKind: 'rafter', nav: 's:profiles', get: (p) => p.building.rafterProfile, mut: (b, v: string) => { b.rafterProfile = v; } },
  { g: 'חתכים וחומר', label: 'חומר', kind: 'text', nav: 's:profiles', get: (p) => p.building.material, mut: (b, v: string) => { b.material = v; } },

  { g: 'גג ופטות', label: 'פטות — חתך', kind: 'profile', fam: ['C', 'Z', 'RHS', 'IPE'], ovKind: 'purlin', nav: 'r:left', get: (p) => p.building.purlins.left.profile, mut: (b, v: string) => { b.purlins.left.profile = v; if (b.roofType === 'gable') b.purlins.right.profile = v; } },
  { g: 'גג ופטות', label: 'פטות — מרווח', kind: 'len', nav: 'r:left', get: (p) => p.building.purlins.left.spacing, mut: (b, v: number) => { b.purlins.left.spacing = v; if (b.roofType === 'gable') b.purlins.right.spacing = v; } },
  { g: 'גג ופטות', label: 'פטות — מרחק ראשון', kind: 'len', nav: 'r:left', get: (p) => p.building.purlins.left.first, mut: (b, v: number) => { b.purlins.left.first = v; if (b.roofType === 'gable') b.purlins.right.first = v; } },
  { g: 'גג ופטות', label: 'פטות — חלוקה', kind: { opts: LAYOUT_OPTS }, nav: 'r:left', get: (p) => p.building.purlins.left.layout ?? 'fixed', mut: (b, v: 'fixed' | 'even') => { b.purlins.left.layout = v; if (b.roofType === 'gable') b.purlins.right.layout = v; } },
  { g: 'גג ופטות', label: 'תושבת פטה', kind: { opts: CLEAT_OPTS }, nav: 'r:left', get: (p) => p.building.purlins.left.cleat.style ?? 'run', mut: (b, v: 'run' | 'stand' | 'plate') => { b.purlins.left.cleat.style = v; if (b.roofType === 'gable') b.purlins.right.cleat.style = v; } },
  { g: 'גג ופטות', label: 'חומר פטות', kind: 'text', nav: 'r:left', get: (p) => p.building.purlins.material, mut: (b, v: string) => { b.purlins.material = v; } },

  { g: 'חיזוקים', label: 'אלכסוני עמוד-קורה', kind: 'bool', nav: 'b:knee', get: (p) => !!p.building.kneeBraces?.enabled, mut: (b, v: boolean) => { if (b.kneeBraces) b.kneeBraces.enabled = v; else if (v) throw new CommandError('יש להפעיל אלכסונים בפעם הראשונה מהמסך "אלכסוני עמוד-קורה"'); } },
  { g: 'חיזוקים', label: 'אלכסונים — חתך', kind: 'profile', fam: ['RHS', 'SHS', 'L', 'CHS'], nav: 'b:knee', show: (p) => !!p.building.kneeBraces?.enabled, get: (p) => p.building.kneeBraces?.profile ?? '', mut: (b, v: string) => { if (b.kneeBraces) b.kneeBraces.profile = v; } },
  { g: 'חיזוקים', label: 'קושרות גג', kind: 'bool', nav: 'b:roof', get: (p) => p.building.bracing.roof.enabled, mut: (b, v: boolean) => { b.bracing.roof.enabled = v; } },
  { g: 'חיזוקים', label: 'קושרות גג — חתך', kind: 'profile', fam: ['L', 'RHS', 'CHS', 'RD'], nav: 'b:roof', show: (p) => p.building.bracing.roof.enabled, get: (p) => p.building.bracing.roof.profile, mut: (b, v: string) => { b.bracing.roof.profile = v; } },
  { g: 'חיזוקים', label: 'קשיחות קירות', kind: 'bool', nav: 'b:walls', get: (p) => p.building.bracing.walls.enabled, mut: (b, v: boolean) => { b.bracing.walls.enabled = v; } },
  { g: 'חיזוקים', label: 'קשיחות קירות — חתך', kind: 'profile', fam: ['L', 'RHS', 'CHS', 'RD'], nav: 'b:walls', show: (p) => p.building.bracing.walls.enabled, get: (p) => p.building.bracing.walls.profile, mut: (b, v: string) => { b.bracing.walls.profile = v; } },

  { g: 'קירות וחיפוי', label: 'חיפוי גג', kind: 'bool', nav: 'w:roof', show: (p) => !!p.building.cladding, get: (p) => !!p.building.cladding?.roof.enabled, mut: (b, v: boolean) => { b.cladding!.roof.enabled = v; } },
  { g: 'קירות וחיפוי', label: 'חיפוי קירות', kind: 'bool', nav: 'w:walls', show: (p) => !!p.building.cladding, get: (p) => !!p.building.cladding?.walls.enabled, mut: (b, v: boolean) => { b.cladding!.walls.enabled = v; } },
  { g: 'קירות וחיפוי', label: 'פטות קיר — חתך', kind: 'profile', fam: ['C', 'Z', 'RHS'], ovKind: 'girt', nav: 'w:walls', show: (p) => !!p.building.cladding?.girts.enabled, get: (p) => p.building.cladding?.girts.profile ?? '', mut: (b, v: string) => { b.cladding!.girts.profile = v; } },
  { g: 'קירות וחיפוי', label: 'פטות קיר — מרווח', kind: 'len', nav: 'w:walls', show: (p) => !!p.building.cladding?.girts.enabled, get: (p) => p.building.cladding?.girts.spacing ?? 0, mut: (b, v: number) => { b.cladding!.girts.spacing = v; } },
  { g: 'קירות וחיפוי', label: 'עמודי רוח — מרווח מרבי', kind: 'len', nav: 'w:walls', show: (p) => !!p.building.cladding?.posts.enabled, get: (p) => p.building.cladding?.posts.maxSpacing ?? 0, mut: (b, v: number) => { b.cladding!.posts.maxSpacing = v; } },
];

const fmtVal = (r: Row, v: unknown): string => {
  if (typeof r.kind === 'object') return r.kind.opts.find(([k]) => k === v)?.[1] ?? String(v);
  if (r.kind === 'bool') return v ? 'פעיל' : 'כבוי';
  if (r.kind === 'len') return `${(Number(v) / 1000).toFixed(3)}`;
  if (r.kind === 'pct') return `${v}%`;
  return String(v ?? '');
};

function edit(r: Row, v: unknown) {
  store.exec({
    label: `גיליון פרמטרים: ${r.label}`,
    run: (p) => {
      const n = structuredClone(p);
      (r.mut as (b: BuildingParams, v: unknown) => void)(n.building, v);
      n.building.frames = [...n.building.frames].sort((a, b) => a.y - b.y);
      const errs = validateBuilding(n.building).filter((i) => i.severity === 'error');
      if (errs.length) throw new CommandError(errs.map((e) => e.message).join('\n'));
      return n;
    },
  });
}

export function ParamSheet() {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const [q, setQ] = useState('');
  const [onlyChg, setOnlyChg] = useState(false);
  const [openOv, setOpenOv] = useState<string | null>(null);
  const u = p.displayUnit;
  // המהדורה המאושרת האחרונה — להשוואה
  const rev = [...p.revision.log].reverse().find((e) => e.snapshot);
  const prev = useMemo<Project | null>(() => { try { return rev?.snapshot ? (JSON.parse(rev.snapshot) as Project) : null; } catch { return null; } }, [rev?.snapshot]);
  const ovOf = (kind: string) => d.members.filter((m) => m.kind === kind && p.memberOverrides[m.id]?.profile).map((m) => m.id);
  const go = (k: NavKey) => window.dispatchEvent(new CustomEvent('ksp-nav', { detail: k }));
  const clearOv = (ids: string[]) => store.exec({
    label: 'החזרת חתך לכללי',
    run: (pp) => { const n = structuredClone(pp); for (const id of ids) { const o = n.memberOverrides[id]; if (o) { delete o.profile; if (!Object.keys(o).length) delete n.memberOverrides[id]; } } return n; },
  });
  const rows = ROWS.filter((r) => !r.show || r.show(p)).map((r) => {
    const v = r.get(p);
    let pv: unknown;
    try { pv = prev ? r.get(prev) : undefined; } catch { pv = undefined; }
    const changed = prev ? JSON.stringify(pv) !== JSON.stringify(v) : false;
    const ov = r.ovKind ? ovOf(r.ovKind) : [];
    return { r, v, pv, changed, ov };
  }).filter((x) => (!q || `${x.r.g} ${x.r.label} ${fmtVal(x.r, x.v)}`.includes(q)) && (!onlyChg || x.changed || x.ov.length));
  const exportCsv = () => {
    const lines = [['קבוצה', 'פרמטר', 'ערך', 'חריגים', prev ? `מהדורה ${rev!.rev}` : ''].join(',')];
    for (const x of rows) lines.push([x.r.g, x.r.label, fmtVal(x.r, x.v), x.ov.length || '', x.changed ? fmtVal(x.r, x.pv) : ''].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `${p.meta.name || 'project'}-parameters.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  let lastG = '';
  return (
    <div className="panel-body ps-sheet" data-testid="param-sheet">
      <div className="panel-title">גיליון פרמטרים</div>
      <div className="ps-bar">
        <input className="inp" placeholder="חיפוש פרמטר…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש פרמטר" data-testid="ps-search" />
        <label className="row"><input type="checkbox" checked={onlyChg} onChange={(e) => setOnlyChg(e.target.checked)} data-testid="ps-only" />{prev ? `רק ששונו מאז מהדורה ${rev!.rev} / חריגים` : 'רק חריגים'}</label>
        <button className="btn small" onClick={exportCsv} data-testid="ps-csv" title="ייצוא לקובץ CSV שנפתח ב-Excel">ייצוא ל-Excel</button>
      </div>
      <table className="tbl ps-tbl">
        <thead><tr><th>פרמטר</th><th>ערך</th><th>חריגים</th>{prev && <th className="ps-rev">מהדורה {rev!.rev}</th>}<th /></tr></thead>
        <tbody>
          {rows.map(({ r, v, pv, changed, ov }) => {
            const head = r.g !== lastG ? (lastG = r.g, <tr className="ps-grp" key={`g-${r.g}`}><td colSpan={prev ? 5 : 4}>{r.g}</td></tr>) : null;
            const id = `ps-${r.label}`;
            const k = r.kind;
            // 1.55.2: לרכיב עם חלון משלו (קשיחות קירות, אלכסוני עמוד-קורה) — מקום עריכה יחיד: החלון. כאן תצוגה + פתיחה
            const win = r.nav === 'b:walls' || r.nav === 'b:knee' || r.nav === 'b:roof';
            const cell = win ? <button className="ps-open" onClick={() => go(r.nav)} data-testid={id}>{k === 'bool' ? (v ? 'פעיל' : 'כבוי') : String(v || '—')} <span>פתיחת החלון ←</span></button>
              : !r.mut || k === 'ro' ? <span className="muted">{String(v)}</span>
              : k === 'len' ? <LenField mm={v as number} unit={u} onCommit={(x) => edit(r, x)} testId={id} />
              : k === 'num' ? <NumField value={v as number} onCommit={(x) => edit(r, x)} testId={id} />
              : k === 'pct' ? <NumField value={v as number} suffix="%" onCommit={(x) => edit(r, x)} testId={id} />
              : k === 'profile' ? <ProfilePicker value={v as string} families={r.fam} onCommit={(x) => edit(r, x)} testId={id} />
              : k === 'text' ? <TextField value={v as string} onCommit={(x) => edit(r, x)} testId={id} ltr />
              : k === 'bool' ? <label className="row"><input type="checkbox" checked={!!v} onChange={(e) => edit(r, e.target.checked)} data-testid={id} />{v ? 'פעיל' : 'כבוי'}</label>
              : <select className="inp" value={String(v)} onChange={(e) => edit(r, e.target.value)} data-testid={id}>{k.opts.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>;
            return [head,
              <tr key={r.label} className={changed ? 'ps-chg' : ''} data-testid={`ps-row-${r.label}`}>
                <td>{r.label}</td>
                <td className="ps-val">{cell}</td>
                <td>{ov.length ? <button className="btn small" onClick={() => setOpenOv(openOv === r.label ? null : r.label)} data-testid={`ps-ov-${r.label}`}>{ov.length} {openOv === r.label ? '▾' : '▸'}</button> : <span className="muted">—</span>}</td>
                {prev && <td className="ps-rev">{changed ? <span className="ps-diff">{fmtVal(r, pv)}</span> : <span className="muted">ללא שינוי</span>}</td>}
                <td><button className="btn small" onClick={() => go(r.nav)} title="פתיחת ההגדרות המפורטות">←</button></td>
              </tr>,
              openOv === r.label && ov.length ? (
                <tr key={`${r.label}-ov`} className="ps-ovrow"><td colSpan={prev ? 5 : 4}>
                  <div className="ps-ovlist">{ov.slice(0, 40).map((mid) => <span key={mid} className="mono">{mid}: {p.memberOverrides[mid]?.profile}</span>)}{ov.length > 40 && <span>…</span>}</div>
                  <button className="btn small" onClick={() => store.select(ov)}>הראה במודל</button>
                  <button className="btn small" onClick={() => { clearOv(ov); setOpenOv(null); }} data-testid={`ps-ovclear-${r.label}`}>↺ כולם לכללי</button>
                </td></tr>
              ) : null];
          })}
        </tbody>
      </table>
      <div className="hint">עריכה בטבלה משנה את המודל מייד (Ctrl+Z לביטול). "חריגים" = אלמנטים שקיבלו חתך משלהם. ← פותח את ההגדרות המפורטות. מומלץ לפתוח במסך מלא (⤢).</div>
    </div>
  );
}
