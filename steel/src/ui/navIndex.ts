import type { NavKey } from './SideNav';

/**
 * אינדקס חיפוש להגדרות (Ctrl+K): מילים שמשתמש מקליד ← המקום בעץ התפריטים.
 * המטרה: להגיע לכל הגדרה בלי לדעת איפה היא נמצאת.
 */
export const NAV_INDEX: { key: NavKey; label: string; words: string }[] = [
  { key: 's:sheet', label: 'גיליון פרמטרים', words: 'גיליון פרמטרים טבלה כל המידות סיכום חריגים מהדורה השוואה אקסל ייצוא' },
  { key: 's:project', label: 'פרויקט והגדרות', words: 'שם לקוח מתכנן יחידות מטר מילימטר חומר גלם אורך מוט 12 חלוקה אוטומטית חיבור המשך חלקים שווים פלטות חיזוק' },
  { key: 's:geometry', label: 'צירים, מסגרות וגבהים', words: 'גיאומטריה רוחב מפתח גובה גבהים שיפוע רכס צירים ציר עמוד פנימי תבנית חד שיפועי דו שיפועי קונזולה זיז מדורג דירוג חתך מודולרי גובה קבוע' },
  { key: 's:geometry', label: 'מפלס תחתית עמוד לכל ציר', words: 'תחתית עמוד מפלס בסיס חגורה יסוד 0.00 אפס גובה עמוד קיצור עמוד ציר' },
  { key: 's:profiles', label: 'חתכים וחומר', words: 'פרופיל עמוד קורה HEA IPE RHS חומר S235 S355 פלדה' },
  { key: 's:geometry', label: 'אורך המבנה ומסגרות', words: 'מסגרת מרווח מסגרות אורך מבנה מספר מפתחים הוספת מסגרת מחיקה' },
  { key: 'r:system', label: 'מערכת פטות', words: 'פטות חומר פטה גלוון' },
  { key: 'r:left', label: 'שיפועים ותומכים', words: 'פטה מרווח פטות מרחק ראשון רכס חלוקה ידנית תומך זוויתן גובה תומך ברגים תומכים פתיחת פטה פטה מתחילה שמאל ימין' },
  { key: 'r:splices', label: 'חיבורי המשך פטות', words: 'חיבור המשך פטה תפר פלטה מפתחים אורך קטע' },
  { key: 'b:wing', label: 'כנף — סככת L', words: 'כנף צורת L סככה ניצבת אגף נוסף סככה צמודה חיבור לקיר' },
  { key: 'b:truss', label: 'מסבכי גג', words: 'מסבך סבכה truss חגורה אלכסון אנך Warren Pratt Howe' },
  { key: 'b:knee', label: 'אלכסוני עמוד-קורה', words: 'אלכסון עמוד קורה 45 זווית ירידה knee brace לשונית פח RHS80' },
  { key: 'b:ridge', label: 'חיזוק רכס', words: 'רכס קודקוד פלטה מוגבהת חיזוק משולש פרופיל אופקי IPE160' },
  { key: 'b:roof', label: 'קושרות גג', words: 'קושרות גג X זוויתן סבכה אופקית RHS פנל מפתח קשור' },
  { key: 'b:walls', label: 'קשיחות קירות / אגד B', words: 'קיר קושרות קיר אגד B קורת אגד אלכסונים קשיחות לאורך portal' },
  { key: 'b:ties', label: 'שורות קשירה לפטות', words: 'שורת קשירה פטות זוויתן L40' },
  { key: 'c:eave', label: 'חיבור עמוד-קורה (ראש עמוד)', words: 'ראש עמוד פלטת כיפה פלטה ברגים M18 בדיקת פלטה מרזב' },
  { key: 'c:ridge', label: 'חיבור רכס', words: 'רכס קודקוד פלטת קצה M22' },
  { key: 'c:base', label: 'פלטות בסיס', words: 'בסיס פלטת בסיס מבוטנת עיגון מוטות יסוד' },
  { key: 'c:purlin-cleat', label: 'חיבורי פטה-קורה (תומכים)', words: 'תומך זוויתן פטה קורה כל התומכים' },
  { key: 'i:warning', label: 'אזהרות', words: 'אזהרות בדיקות הסתר תקן הכל' },
];

/** מאלמנט שנבחר — אל ההגדרות הכלליות שקובעות אותו (שינוי לכולם במקום אחד) */
export function settingsOf(id: string, kind: string, side?: string): [string, string] | null {
  if (id.startsWith('KB.') || id.startsWith('C.KB.')) return ['b:knee', 'הגדרות כל אלכסוני עמוד-קורה'];
  if (id.startsWith('TB.') || id.startsWith('C.TB')) return ['b:tb', 'קורה / מסבך נושא'];
  if (id.startsWith('TR.') || /\.BC\.\d+$/.test(id) || id.startsWith('C.TR')) return ['b:truss', 'מסבכי גג — אשף המסבך'];
  if (id.startsWith('BB.') || id.startsWith('C.BB.') || id.startsWith('BR.W')) return ['b:walls', 'הגדרות קשיחות קירות / אגד B'];
  if (id.startsWith('BR.R') || id.startsWith('HB.') || id.startsWith('C.HB.')) return ['b:roof', 'הגדרות קושרות גג'];
  if (id.startsWith('BR.T')) return ['b:ties', 'הגדרות שורות קשירה'];
  if (id.startsWith('C.RIDGE') || id.startsWith('RT.')) return ['b:ridge', 'הגדרות חיזוק רכס'];
  if (kind === 'purlin' || kind === 'cleat') return [side === 'right' ? 'r:right' : 'r:left', kind === 'cleat' ? 'הגדרות כל התומכים בשיפוע' : 'הגדרות הפטות בשיפוע'];
  if (kind === 'column' || kind === 'rafter') return ['s:profiles', 'חתכי כל העמודים והקורות'];
  return null;
}
