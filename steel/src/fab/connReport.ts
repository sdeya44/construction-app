import type { Connection, DerivedModel, Project, ValidationIssue } from '../model/types';
import type { Table } from './export';

/** הערה קבועה בתחתית הדוח — הדוח מציג בדיקות גיאומטריה בלבד */
export const CONN_REPORT_NOTE = 'דוח התאמה גיאומטרית בלבד: ברגים, ריתוכים והודעות הבדיקה של המודל. אינו תכן חוזק ואינו אישור הנדסי — "אינו תכן מאושר". מרחקי קצה/מרווחים מופיעים רק כשהמודל התריע עליהם.';

const group = (xs: string[]) => { const g = new Map<string, number>(); for (const k of xs) g.set(k, (g.get(k) ?? 0) + 1); return [...g].map(([k, n]) => `${n}× ${k}`).join(', '); };
const sev = (s: string) => (s === 'error' ? 0 : s === 'warning' ? 1 : 2);

/** הודעות שמשויכות לחיבור: לפי מזהה החיבור/חלקיו; הודעה בלי אלמנט — לפי תחילית התווית */
export function issuesOfConn(c: Connection, issues: ValidationIssue[]): ValidationIssue[] {
  const own = new Set([c.id, ...c.parts]);
  return issues.filter((i) => (i.elementId ? own.has(i.elementId) : c.label !== '' && i.message.startsWith(`${c.label}:`)));
}

/**
 * דוח התאמה לכל חיבור (פלט למהנדס/לבקרה): סוג, אלמנטים, פרט, ברגים וריתוכים מקובצים, סטטוס אישור והודעות הבדיקה.
 * `typeLabel` — שמות סוגי החיבור בעברית (מוזרק כדי ששכבת הייצור לא תיבא ממשק).
 */
export function connReportTable(p: Project, d: DerivedModel, typeLabel: Record<string, string>): Table {
  const headers = ['חיבור', 'סוג', 'אלמנטים מחוברים', 'פרט', 'ברגים', 'ריתוכים', 'סטטוס אישור', 'שגיאות', 'אזהרות', 'הודעות בדיקה', 'תוצאה'];
  const ST: Record<string, string> = { 'not-verified': 'לא מאושר', 'for-review': 'לבדיקה', approved: 'מאושר' };
  const rows: (string | number)[][] = [];
  const linked = new Set<ValidationIssue>();
  const live = d.issues.filter((i) => i.severity !== 'info');
  for (const c of d.connections) {
    const is = issuesOfConn(c, live).sort((a, b) => sev(a.severity) - sev(b.severity));
    is.forEach((i) => linked.add(i));
    const er = is.filter((i) => i.severity === 'error').length, wr = is.length - er;
    const bolts = group(c.bolts.map((b) => `M${b.d}×${b.length} ${b.grade} (${b.location === 'site' ? 'שטח' : 'מסגריה'})`));
    const welds = group(c.welds.map((w) => `a${w.a}×${Math.round(w.length)} (${w.location === 'site' ? 'שטח' : 'מסגריה'})`));
    const detail = c.custom ? `מותאם: ${(p.customDetails ?? []).find((x) => x.id === c.custom!.detailId)?.name ?? c.custom.detailId}` : c.recipe ? `מתכון: ${c.recipe.id}` : 'מובנה';
    rows.push([
      c.label || c.id, typeLabel[c.type] ?? c.type, c.members.map((m) => d.byId.get(m)?.label ?? m).join(' ↔ '), detail,
      bolts || '—', welds || '—', ST[c.status] ?? c.status, er, wr,
      is.map((i) => `${i.severity === 'error' ? 'שגיאה' : 'אזהרה'}: ${i.message}`).join(' | ') || '—',
      er ? 'יש שגיאות — לתקן לפני ייצור' : wr ? 'יש אזהרות — לבדיקה' : 'אין ממצאים בבדיקות הגיאומטריה',
    ]);
  }
  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'he') || String(a[0]).localeCompare(String(b[0]), 'he', { numeric: true }));
  const rest = live.filter((i) => !linked.has(i)).length;
  rows.push(['', '', '', '', '', '', '', '', '', `הודעות במודל שלא שויכו לחיבור: ${rest}`, '']);
  rows.push([CONN_REPORT_NOTE, '', '', '', '', '', '', '', '', '', '']);
  return { name: 'דוח התאמה לחיבורים', headers, rows };
}
