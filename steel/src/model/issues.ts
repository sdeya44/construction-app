import type { ValidationIssue } from './types';

/** מפתח יציב להודעה: קוד + אלמנט (או נוסח ההודעה כשאין אלמנט) */
export const issueKey = (i: ValidationIssue) => `${i.code}|${i.elementId ?? i.message}`;

/** שם קצר בעברית לכל סוג הודעה */
export const ISSUE_LABEL: Record<string, string> = {
  CLASH: 'התנגשות', BOLT_EDGE: 'מרחק קצה/שפה של ברגים', BOLT_ACCESS: 'גישת מפתח לבורג', BOLT_OUTSIDE: 'בורג מחוץ לאלמנט',
  PART_STOCK: 'חלק ארוך מחומר הגלם', SPLICE_DESIGN: 'חיבורי המשך — דורש תכנון', AUTO_SPLICE: 'חיבורי המשך אוטומטיים',
  RAFTER_EXT: 'הארכת קורות הגג', PURLIN_EXT: 'הארכת פטות', SITE_WELD_OK: 'ריתוך בשטח (פלטה מבוטנת)', SITE_WELD: 'ריתוך בשטח',
  CLEAT_MANUAL: 'גובה תומך ידני', HOLE_FLAT: 'חור מחוץ לאזור השטוח', PLATE_WIDE: 'פלטה רחבה', EAVE_FIT: 'פלטת ראש עמוד',
  PURLIN_FIRST_AUTO: 'מרחק פטה ראשונה תוקן', BRACE_SHORT: 'קושרת קצרה', STALE_OVERRIDE: 'התאמה ידנית לא תקפה', PROFILE: 'חתך לא מוכר',
  KNEE_LOW: 'אלכסון נמוך', KNEE_SHORT: 'אלכסון קצר', FRAMES: 'מסגרות', LINE_FREE: 'ציר ללא גג', PLANE_FREE: 'מישור ללא תמיכה',
  PLANE_SHORT: 'מישור קצר', PLANE_THROUGH: 'מישור דרך עמוד', PLATE_SMALL: 'פלטה קטנה', PURLIN_REMAINDER: 'שארית בחלוקת פטות',
  PURLIN_RIDGE: 'פטה ליד הרכס', RIDGE_HAUNCH: 'חיזוק רכס', RIDGE_TIE: 'פרופיל חיזוק ברכס', SIDE_ABOVE: 'חיבור צד עמוד',
  SPLICE_CLOSE: 'חיבורי המשך צפופים', SPLICE_RANGE: 'חיבור המשך מחוץ לאלמנט', HB_NARROW: 'סבכה במישור צר', BRACE_ANGLE: 'זווית אלכסון', ANCHOR_EDGE: 'מוט עיגון קרוב לשפה', BOLT_LONG: 'בורג ארוך',
};
