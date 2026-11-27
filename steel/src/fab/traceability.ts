import type { DerivedModel, Project, StockLot } from '../model/types';
import type { Fabrication } from './marks';
import type { Table } from './export';

/**
 * עקיבות חומר (1.106): כל סימון חלק מקושר לליט (מספר היתך + תעודת מפעל). רישום של המשתמש — אינו אימות תעודות.
 * ההקצאה לפי סימון (`Project.traceability.assign`); מספור מחדש של סימונים עלול לשבור הקצאה — הדוח מסמן "ליט חסר".
 * מפתח התאמה: פלטה — `PL<עובי>` (תעודה לפי עובי), פרופיל — שם החתך; ובנוסף — אותו חומר.
 */
export type TraceStatus = 'ok' | 'unassigned' | 'mismatch' | 'missing-lot';
export interface TraceRow { mark: string; desc: string; profile: string; key: string; material: string; qty: number; lot?: StockLot; status: TraceStatus }

/** מפתח התאמה לליט: פלטה לפי עובי, אחרת שם החתך */
export function lotKey(profile: string): string {
  const m = /^PL\s*(\d+(?:\.\d+)?)/i.exec(profile.trim());
  return m ? `PL${m[1]}` : profile.trim().toUpperCase();
}

export const traceOf = (p: Project) => p.traceability ?? { lots: [], assign: {} };

/** שורת עקיבות לכל סימון (חלקי פרופיל ופלטות; ברגים ומוטות עיגון אינם בסימון חלקים) */
export function traceRows(p: Project, d: DerivedModel, fab: Fabrication): TraceRow[] {
  const t = traceOf(p);
  const byMark = new Map<string, TraceRow>();
  for (const pt of fab.parts) {
    const m = d.byId.get(pt.memberId);
    if (!m || m.kind === 'bolt') continue;
    const e = byMark.get(pt.mark);
    if (e) { e.qty++; continue; }
    byMark.set(pt.mark, { mark: pt.mark, desc: pt.desc, profile: pt.profile, key: lotKey(pt.profile), material: m.material, qty: 1, status: 'unassigned' });
  }
  for (const r of byMark.values()) {
    const id = t.assign[r.mark];
    if (!id) continue;
    const lot = t.lots.find((x) => x.id === id);
    if (!lot) { r.status = 'missing-lot'; continue; }
    r.lot = lot;
    r.status = lotKey(lot.profile) === r.key && lot.material.trim().toUpperCase() === r.material.trim().toUpperCase() ? 'ok' : 'mismatch';
  }
  return [...byMark.values()].sort((a, b) => a.mark.localeCompare(b.mark, 'en', { numeric: true }));
}

/** ליטים שמתאימים לסימון (אותו חתך/עובי ואותו חומר) */
export const compatibleLots = (p: Project, r: Pick<TraceRow, 'key' | 'material'>): StockLot[] =>
  traceOf(p).lots.filter((l) => lotKey(l.profile) === r.key && l.material.trim().toUpperCase() === r.material.trim().toUpperCase());

/**
 * הקצאה אוטומטית: סימון בלי הקצאה (או עם ליט חסר) מקבל ליט רק כשיש **ליט מתאים אחד בדיוק** (בלי ניחוש בין כמה ליטים).
 * מחזיר את מפת ההקצאה החדשה ואת מספר ההקצאות שנוספו; הקצאות קיימות ותקינות לא משתנות.
 */
export function autoAssign(p: Project, d: DerivedModel, fab: Fabrication): { assign: Record<string, string>; added: number; ambiguous: string[]; none: string[] } {
  const assign = { ...traceOf(p).assign };
  let added = 0; const ambiguous: string[] = [], none: string[] = [];
  for (const r of traceRows(p, d, fab)) {
    if (r.status === 'ok' || r.status === 'mismatch') continue;
    const c = compatibleLots(p, r);
    if (c.length === 1) { assign[r.mark] = c[0]!.id; added++; } else if (c.length > 1) ambiguous.push(r.mark); else none.push(r.mark);
  }
  return { assign, added, ambiguous, none };
}

const ST: Record<TraceStatus, string> = { ok: 'מוקצה', unassigned: 'לא מוקצה', mismatch: 'לא תואם חתך/חומר', 'missing-lot': 'ליט חסר' };

/** דוח עקיבות: סימון ← היתך ← תעודה (לשונית בייצור, CSV/XLSX) */
export function traceTable(p: Project, d: DerivedModel, fab: Fabrication): Table {
  const rows = traceRows(p, d, fab);
  const bad = rows.filter((r) => r.status !== 'ok').length;
  const out: (string | number)[][] = rows.map((r) => [r.mark, r.desc, r.profile, r.material, r.qty, r.lot?.heat ?? '—', r.lot?.cert ?? '—', ST[r.status]]);
  out.push(['', '', '', '', '', '', '', `${rows.length - bad} מתוך ${rows.length} סימונים מוקצים ותואמים`]);
  out.push(['רישום משתמש בלבד — אינו אימות תעודות מפעל (EN 10204)', '', '', '', '', '', '', '']);
  return { name: 'עקיבות חומר', headers: ['סימון', 'תיאור', 'חתך', 'חומר', 'כמות', 'היתך', 'תעודה', 'סטטוס'], rows: out };
}

// ---------------------------------------------------------------- ייבוא ליטים מ-CSV (1.113)
export const LOT_CSV_MAX_BYTES = 1_000_000, LOT_CSV_MAX_ROWS = 5000;
export const LOT_CSV_TEMPLATE = 'היתך,תעודה,חתך,חומר,הערה\n';
type LotCol = 'heat' | 'cert' | 'profile' | 'material' | 'note';
const COL_NAMES: Record<LotCol, string[]> = {
  heat: ['heat', 'heat no', 'heat number', 'heatno', 'היתך', 'מספר היתך', 'מס היתך', "מס' היתך"],
  cert: ['cert', 'cert no', 'certificate', 'תעודה', 'תעודת מפעל', 'מספר תעודה'],
  profile: ['profile', 'section', 'חתך', 'פרופיל'],
  material: ['material', 'grade', 'steel grade', 'חומר', 'דרגה', 'סוג פלדה'],
  note: ['note', 'notes', 'הערה', 'הערות'],
};
export interface LotCsvError { line: number; reason: string }
export interface LotCsvResult { added: StockLot[]; duplicates: number; errors: LotCsvError[]; rows: number; delimiter: string }

/** פירוק שורת CSV עם מירכאות (`"a,b"`, `""` = מירכאה) */
function splitCsvLine(line: string, d: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * ייבוא ליטים מ-CSV: שורת כותרת חובה (עברית או אנגלית) עם היתך, חתך וחומר (תעודה והערה — אופציונליים); מפריד `,` / `;` / טאב נקבע לפי הכותרת.
 * שורה בלי היתך/חתך/חומר — שגיאה עם מספר שורה ואינה נוספת; ליט זהה (היתך + מפתח חתך + חומר) לקיים או לשורה קודמת — "כפול", לא נוסף.
 * אין ניחוש: חומר חסר אינו מושלם. רישום משתמש בלבד — אינו אימות תעודות.
 */
export function parseLotsCsv(text: string, existing: StockLot[]): LotCsvResult {
  const res: LotCsvResult = { added: [], duplicates: 0, errors: [], rows: 0, delimiter: ',' };
  if (text.length > LOT_CSV_MAX_BYTES) { res.errors.push({ line: 0, reason: `הקובץ גדול מדי (מעל ${LOT_CSV_MAX_BYTES / 1000} KB)` }); return res; }
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const hi = lines.findIndex((l) => l.trim() !== '');
  if (hi < 0) { res.errors.push({ line: 0, reason: 'הקובץ ריק' }); return res; }
  const count = (d: string) => lines[hi]!.split(d).length;
  res.delimiter = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const head = splitCsvLine(lines[hi]!, res.delimiter).map((h) => h.toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim());
  const idx = {} as Record<LotCol, number>;
  for (const c of Object.keys(COL_NAMES) as LotCol[]) idx[c] = head.findIndex((h) => COL_NAMES[c].includes(h));
  const missing = (['heat', 'profile', 'material'] as LotCol[]).filter((c) => idx[c] < 0);
  if (missing.length) { res.errors.push({ line: hi + 1, reason: `חסרות עמודות חובה בכותרת: ${missing.map((c) => ({ heat: 'היתך', profile: 'חתך', material: 'חומר' } as Record<string, string>)[c]).join(', ')}` }); return res; }
  const ids = new Set(existing.map((l) => l.id)); let n = existing.length + 1;
  const nextId = () => { while (ids.has(`L${n}`)) n++; const id = `L${n}`; ids.add(id); return id; };
  const seen = new Set(existing.map((l) => `${l.heat}|${lotKey(l.profile)}|${l.material.trim().toUpperCase()}`));
  for (let i = hi + 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '') continue;
    if (++res.rows > LOT_CSV_MAX_ROWS) { res.errors.push({ line: i + 1, reason: `יותר מ-${LOT_CSV_MAX_ROWS} שורות — הייבוא נעצר` }); break; }
    const f = splitCsvLine(lines[i]!, res.delimiter);
    const get = (c: LotCol) => (idx[c] >= 0 ? (f[idx[c]] ?? '') : '');
    const heat = get('heat'), profile = get('profile'), material = get('material');
    const miss = [!heat && 'היתך', !profile && 'חתך', !material && 'חומר'].filter(Boolean);
    if (miss.length) { res.errors.push({ line: i + 1, reason: `חסר ${miss.join(', ')}` }); continue; }
    if (heat.length > 60 || profile.length > 60 || material.length > 60 || get('cert').length > 120 || get('note').length > 240) { res.errors.push({ line: i + 1, reason: 'ערך ארוך מדי' }); continue; }
    const key = `${heat}|${lotKey(profile)}|${material.toUpperCase()}`;
    if (seen.has(key)) { res.duplicates++; continue; }
    seen.add(key);
    res.added.push({ id: nextId(), heat, cert: get('cert') || undefined, profile, material, note: get('note') || undefined });
  }
  return res;
}

