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
