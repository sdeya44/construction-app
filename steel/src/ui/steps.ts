import type { DerivedModel, Project } from '../model/types';
import type { NavKey } from './SideNav';

/**
 * 1.59: שלבי העבודה — מקור אחד לסרגל השלבים, לאשף (סימון "הושלם" באישור) ולשאלת "להוסיף?".
 *
 * ארבעה מצבים:
 *   todo  — לא הוגדר (אפור, לא נספר)
 *   skip  — "לא נדרש במבנה הזה" (החלטה מפורשת, נספר)
 *   ok    — אושר באשף (ירוק, נספר)
 *   warn  — אושר אבל יש שגיאות/אזהרות (כתום, לא נספר)
 * "הושלם" נשמר בקובץ הפרויקט (meta.steps). פרויקט ישן בלי meta.steps — כל רכיב קיים נחשב שאושר.
 */
export type StepState = 'todo' | 'skip' | 'ok' | 'warn';
export interface StepDef { key: string; label: string; short: string; nav?: NavKey; mode?: 'drawings' | 'production'; action?: 'export'; /** שלב בסיס — חלק מכל מבנה (אין "להוסיף?") */ core?: boolean; /** הפקה — לא נספר באחוז ההשלמה */ out?: boolean }

export const STEPS: StepDef[] = [
  { key: 's:project', label: 'פרויקט והגדרות', short: 'פרויקט', nav: 's:project', core: true },
  { key: 's:geometry', label: 'צירים, מסגרות וגבהים', short: 'צירים ומסגרות', nav: 's:geometry', core: true },
  { key: 's:profiles', label: 'חתכים וחומר', short: 'חתכים', nav: 's:profiles', core: true },
  { key: 'r:left', label: 'פטות ותושבות', short: 'פטות', nav: 'r:left', core: true },
  { key: 'r:splices', label: 'חיבורי המשך פטות', short: 'המשך פטות', nav: 'r:splices' },
  { key: 'b:knee', label: 'אלכסוני עמוד-קורה / מכפל', short: 'אלכסונים', nav: 'b:knee' },
  { key: 'b:roof', label: 'קושרות גג', short: 'קושרות גג', nav: 'b:roof' },
  { key: 'b:walls', label: 'קשיחות קירות', short: 'קשיחות קירות', nav: 'b:walls' },
  { key: 'b:ties', label: 'פטות — קשירה ותמיכה', short: 'קשירת פטות', nav: 'b:ties' },
  { key: 'b:ridge', label: 'חיזוק רכס', short: 'חיזוק רכס', nav: 'b:ridge' },
  { key: 'w:roof', label: 'חיפוי גג וקירות', short: 'חיפוי', nav: 'w:roof' },
  { key: 'b:tb', label: 'רכיבים מיוחדים', short: 'מיוחדים', nav: 'b:tb' },
  { key: 'issues', label: 'בדיקות', short: 'בדיקות', nav: 'issues', core: true },
  { key: 'production', label: 'ייצור — מספור', short: 'ייצור', mode: 'production', out: true },
  { key: 'drawings', label: 'שרטוטים (PDF / DXF)', short: 'שרטוטים', mode: 'drawings', out: true },
  { key: 'export', label: 'ייצוא קובץ פרויקט', short: 'ייצוא', action: 'export', out: true },
];

/** האם הרכיב של השלב קיים במודל */
export function stepExists(key: string, p: Project, d: DerivedModel): boolean {
  const b = p.building, br = b.bracing;
  switch (key) {
    case 'r:splices': return d.splices.some((s) => s.memberId.startsWith('PL.'));
    case 'b:knee': return !!b.kneeBraces?.enabled || !!b.haunch?.enabled;
    case 'b:roof': return br.roof.enabled || !!br.rafterStruts?.rows.length;
    case 'b:walls': return br.walls.enabled || !!br.lineTies?.enabled;
    case 'b:ties': return br.purlinTies.enabled || !!br.sagRods?.enabled || !!br.flyBraces?.enabled;
    case 'b:ridge': return (b.ridgeReinf?.type ?? 'none') !== 'none';
    case 'w:roof': return !!b.cladding;
    case 'b:tb': return !!b.transfers?.length || !!b.wing?.enabled || !!b.roofTruss?.enabled;
    default: return true;
  }
}

/** סימוני השלבים: השמור בפרויקט, או — בפרויקט ישן — כל מה שקיים נחשב שאושר */
export function stepMarks(p: Project, d: DerivedModel): Record<string, 'done' | 'skip'> {
  if (p.meta.steps) return p.meta.steps;
  const out: Record<string, 'done' | 'skip'> = {};
  for (const s of STEPS) if (!s.out && s.key !== 'issues') out[s.key] = stepExists(s.key, p, d) ? 'done' : 'skip';
  return out;
}

export function stepState(s: StepDef, p: Project, d: DerivedModel, marks: Record<string, 'done' | 'skip'>, issues: { err: number; warn: number }): StepState {
  if (s.key === 'issues') return d.issues.some((i) => i.severity === 'error') ? 'warn' : 'ok';
  if (s.out) return 'todo';
  const ex = stepExists(s.key, p, d), m = marks[s.key];
  if (!ex && !s.core) return m ? 'skip' : 'todo'; // רכיב שלא קיים: "לא נדרש" (או שאושר כבוי) — נספר
  if (m !== 'done') return 'todo';
  return issues.err || issues.warn ? 'warn' : 'ok';
}

/** השלב שהאשף/הכלי הזה משלים (לפי מפתח הניווט) */
export function stepOfNav(nav: string): string | null {
  if (STEPS.some((s) => s.key === nav)) return nav;
  if (nav === 'r:right') return 'r:left';
  if (nav === 'w:walls' || nav === 'w:openings') return 'w:roof';
  if (nav === 'b:wing' || nav === 'b:truss') return 'b:tb';
  return null;
}
