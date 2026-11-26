import type { CustomDetail, DetailRef } from '../model/types';

/**
 * מתכוני חיבורי המשך (G9 — אתר באמצע אלמנט, מפתח `אלמנט|s:k`). קובץ נפרד מ-`convRecipes.ts` כדי לשמור על מודולריות;
 * נרשמים ב-`BUILTIN_RECIPES` / `RECIPE_CONN_TYPE` שם. כל מתכון מחליף חיבור מובנה במזהה זהה (`Connection.recipe.own`), כך ש-`buildParts`
 * (סטטוס "מוברג", פער הפלטות) ממשיך לעבוד בלי שינוי.
 */
const R = (on: string, face: string, along = '0', across = '0'): DetailRef => ({ on, face, along, across });

export const PURLIN_SPLICE_RECIPE_ID = 'conv-purlin-splice';

/**
 * חיבור המשך פטה C/Z — פלטה בצד הפנימי של הווב (הצד הנגדי לזוויתן התושבת), 2 ברגים בכל פטה משני צדי התפר.
 * שקול ל-`connections.ts` (חיבור המשך פטה, החלטת משתמש 15.11.2026). הפרמטרים מחושבים בקוד החיבורים (תלויים בתומכי הפטה ובתושבות):
 * T עובי פלטה, H גובה, oL/oR מרחק עמודת הברגים מהתפר משמאל/מימין (לאורך הפטה), edge שפה, row = 1 ⇒ פטה נמוכה (שורה אופקית של 2 ברגים בכל צד, מרווח pH),
 * gV מרווח אנכי בין ברגים (כשאין row), d/cl קוטר ומרווח חור.
 */
export function purlinSpliceRecipe(): CustomDetail {
  return {
    id: PURLIN_SPLICE_RECIPE_ID, name: 'חיבור המשך פטה (הסבה)', family: 'splice', category: 'splice',
    note: 'שקול לחיבור המשך הפטה: פלטה בצד הפנימי של הווב, 2 ברגים בכל פטה (בשטח); פטה נמוכה — שורה אופקית.',
    vars: [
      { name: 'T', expr: '6', note: 'עובי פלטה' }, { name: 'H', expr: '100', note: 'גובה פלטה (לאורך הווב)' }, { name: 'oL', expr: '60', note: 'עמודת הברגים משמאל לתפר' }, { name: 'oR', expr: '60', note: 'עמודת הברגים מימין לתפר' },
      { name: 'edge', expr: '30', note: 'שפה' }, { name: 'row', expr: '0', note: '1 = פטה נמוכה: שורה אופקית' }, { name: 'gV', expr: 'H - 2*edge', note: 'מרווח אנכי בין ברגים' },
      { name: 'd', expr: '12', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'מרווח חור' }, { name: 'd0', expr: 'd + cl' }, { name: 'pH', expr: 'max(ceil(2.4*d0/5)*5, 40)', note: 'מרווח ברגים בשורה (פטה נמוכה)' },
      { name: 'L', expr: 'oL + oR + 2*edge + row*2*pH', note: 'אורך הפלטה' }, { name: 'gt', expr: 'mt + T', note: 'אורך אחיזה' },
    ],
    ops: [
      { k: 'plate', id: 'PL', name: 'פלטת המשך פטה', ref: R('main', 'a-', 'mh/2', 'xs*(oR - oL)/2'), mode: 'flat', spin: 'if(xs > 0, 0, 180)', off: '0', shape: 'rect', w: 'L', h: 'H', t: 'T', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('main', 'a-', 'mh/2', 'xs*(-oL - row*pH/2)'), rows: 'if(row, 1, 2)', cols: 'if(row, 2, 1)', px: 'pH', py: 'gV', d0: 'd0' },
      { k: 'holes', id: 'H2', ref: R('main', 'a-', 'mh/2', 'xs*(oR + row*pH/2)'), rows: 'if(row, 1, 2)', cols: 'if(row, 2, 1)', px: 'pH', py: 'gV', d0: 'd0' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'gt' },
      { k: 'bolts', id: 'B2', holes: 'H2', d: 'd', grade: '8.8', site: true, grip: 'gt' },
    ],
  };
}
