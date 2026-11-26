import type { CustomDetail, DetailOp, DetailRef } from '../model/types';
import { PURLIN_SPLICE_RECIPE_ID, purlinSpliceRecipe } from './spliceRecipes';
import { BRACE_CROSS_GUSSET_RECIPE_ID, BRACE_CROSS_ROD_RECIPE_ID, braceCrossGussetRecipe, braceCrossRodRecipe } from './crossRecipes';

/**
 * מתכוני הסבה (שלב C): פרטים מובנים שנכתבו מחדש כמתכון, לצורך השוואה אוטומטית מול הקוד הישן.
 * אינם חלק מ-`detailPresets()` עד שההשוואה ירוקה — אין חשיפה למשתמש.
 */
const R = (on: string, face: string, along = '0', across = '0'): DetailRef => ({ on, face, along, across });

export const KNEE_FIN_RECIPE_ID = 'conv-knee-fin';
export const STRUT_FIN_RECIPE_ID = 'conv-strut-fin';
export const STRUT_END_RECIPE_ID = 'conv-strut-end';
export const STRUT_WELD_RECIPE_ID = 'conv-strut-weld';
export const CLEAT_RUN_RECIPE_ID = 'conv-cleat-run';
export const CLEAT_PLATE_RECIPE_ID = 'conv-cleat-plate';
export const CLEAT_SEAM_RECIPE_ID = 'conv-cleat-seam';
export const CLEAT_STAND_RECIPE_ID = 'conv-cleat-stand';
export const KNEE_FIN_BEAM_RECIPE_ID = 'conv-knee-fin-bb-beam';
export const KNEE_FIN_BBDIAG_RECIPE_ID = 'conv-knee-fin-bb-diag';
export const KNEE_FIN_LTCHORD_RECIPE_ID = 'conv-knee-fin-lt-chord';
export const KNEE_FIN_LTTRUSS_RECIPE_ID = 'conv-knee-fin-lt-truss';
export const LOCK_PLATE_RECIPE_ID = 'conv-lock-plate';
export const SIDE_RECIPE_ID = 'conv-side';
export const BASE_EMBEDDED_RECIPE_ID = 'conv-base-embedded';
export const BASE_BOLTED_RECIPE_ID = 'conv-base-bolted';
export const BASE_BOLTED_B500_RECIPE_ID = 'conv-base-bolted-b500';

/** סוג החיבור המובנה שהמתכון מחליף — לחתימות שמבוססות על סוגי חיבורים (קיבוץ מסגרות זהות בשרטוטים) */
export const RECIPE_CONN_TYPE: Record<string, 'knee' | 'brace' | 'purlin-cleat' | 'base' | 'rafter-side' | 'purlin-splice' | 'brace-cross'> = { [PURLIN_SPLICE_RECIPE_ID]: 'purlin-splice', [BRACE_CROSS_GUSSET_RECIPE_ID]: 'brace-cross', [BRACE_CROSS_ROD_RECIPE_ID]: 'brace-cross', [KNEE_FIN_RECIPE_ID]: 'knee', [STRUT_FIN_RECIPE_ID]: 'brace', [STRUT_END_RECIPE_ID]: 'brace', [STRUT_WELD_RECIPE_ID]: 'brace', [CLEAT_RUN_RECIPE_ID]: 'purlin-cleat', [CLEAT_PLATE_RECIPE_ID]: 'purlin-cleat', [CLEAT_SEAM_RECIPE_ID]: 'purlin-cleat', [CLEAT_STAND_RECIPE_ID]: 'purlin-cleat', [KNEE_FIN_BEAM_RECIPE_ID]: 'knee', [KNEE_FIN_BBDIAG_RECIPE_ID]: 'knee', [KNEE_FIN_LTCHORD_RECIPE_ID]: 'knee', [KNEE_FIN_LTTRUSS_RECIPE_ID]: 'knee', [LOCK_PLATE_RECIPE_ID]: 'knee', [SIDE_RECIPE_ID]: 'rafter-side', [BASE_EMBEDDED_RECIPE_ID]: 'base', [BASE_BOLTED_RECIPE_ID]: 'base', [BASE_BOLTED_B500_RECIPE_ID]: 'base' };

/** מתכונים מובנים לפי מזהה (מחוץ ל-`project.customDetails`): מחולים אוטומטית לפי `Connection.recipe` */
export const BUILTIN_RECIPES: Record<string, () => CustomDetail> = { [PURLIN_SPLICE_RECIPE_ID]: () => purlinSpliceRecipe(), [BRACE_CROSS_GUSSET_RECIPE_ID]: () => braceCrossGussetRecipe(), [BRACE_CROSS_ROD_RECIPE_ID]: () => braceCrossRodRecipe(), [KNEE_FIN_RECIPE_ID]: () => kneeFinRecipe(), [STRUT_FIN_RECIPE_ID]: () => strutFinRecipe(), [STRUT_END_RECIPE_ID]: () => strutEndRecipe(), [STRUT_WELD_RECIPE_ID]: () => strutWeldRecipe(), [CLEAT_RUN_RECIPE_ID]: () => cleatRunRecipe(), [CLEAT_PLATE_RECIPE_ID]: () => cleatPlateRecipe(), [CLEAT_SEAM_RECIPE_ID]: () => cleatSeamRecipe(), [CLEAT_STAND_RECIPE_ID]: () => cleatStandRecipe(), [KNEE_FIN_BEAM_RECIPE_ID]: () => kneeFinRecipe('קורת אגד', KNEE_FIN_BEAM_RECIPE_ID), [KNEE_FIN_BBDIAG_RECIPE_ID]: () => kneeFinRecipe('אלכסון אגד', KNEE_FIN_BBDIAG_RECIPE_ID), [KNEE_FIN_LTCHORD_RECIPE_ID]: () => kneeFinRecipe('סיב נעילה', KNEE_FIN_LTCHORD_RECIPE_ID), [KNEE_FIN_LTTRUSS_RECIPE_ID]: () => kneeFinRecipe('חגורת מסבך', KNEE_FIN_LTTRUSS_RECIPE_ID), [LOCK_PLATE_RECIPE_ID]: () => lockPlateRecipe(), [SIDE_RECIPE_ID]: () => sideRecipe(), [BASE_EMBEDDED_RECIPE_ID]: () => baseEmbeddedRecipe(), [BASE_BOLTED_RECIPE_ID]: () => baseBoltedRecipe('8.8', 'ISO 4017'), [BASE_BOLTED_B500_RECIPE_ID]: () => baseBoltedRecipe('B500', 'מוט מצולע') };

/**
 * אלכסון עמוד-קורה, פח + לשונית בחריץ — שקול ל-`finJoint` ב-`geometry/finJoint.ts` (פרט הלקוח 15.11.2026).
 * פח במישור הציר המקורי, חתוך לפי פני המארח; לשונית בחריץ ה-RHS מוסטת בעובי (פח+לשונית)/2 — והאלכסון עמה.
 */
export function kneeFinRecipe(desc = 'אלכסון', id = KNEE_FIN_RECIPE_ID): CustomDetail {
  return {
    id, name: `${desc}: פח + לשונית בחריץ (הסבה)`, family: 'any', category: 'brace',
    note: 'שקול ל-finJoint: פח מרותך למארח (חתוך בזווית), לשונית בחריץ ה-RHS, 2 ברגים בחפיפה.',
    match: { member: ['RHS', 'SHS'] },
    vars: [
      { name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'd0', expr: 'd+2', note: 'קוטר חור' }, { name: 'nb', expr: '2', note: 'ברגים בקצה' },
      { name: 'ft', expr: '10', note: 'עובי פח' }, { name: 'tt', expr: '10', note: 'עובי לשונית' }, { name: 'extra', expr: '10', note: 'הרחבה מכל צד מעבר לרוחב ה-RHS' },
      { name: 'ins', expr: '80', note: 'אורך כניסת הלשונית ל-RHS' }, { name: 'clr', expr: '10', note: 'מרווח פינות הלשונית מהמארח' },
      { name: 'edge', expr: 'max(35, ceil(1.5*d0/5)*5)' }, { name: 'pitch', expr: 'max(60, ceil(2.4*d0/5)*5)' }, { name: 'endDist', expr: 'max(45, ceil(2.2*d0/5)*5)' },
      { name: 'eW', expr: 'max(25, ceil(1.2*d0/5)*5)', note: 'שפה לרוחב' },
      { name: 'wt', expr: 'max(mh + 2*extra, 2*eW + ceil(2.4*d0/5)*5)', note: 'רוחב פח ולשונית' },
      { name: 'cs', expr: 'cos(ang)' }, { name: 'sn', expr: 'sin(ang)' }, { name: 'k', expr: 'max(sn, 0.25)' },
      { name: 'sTip', expr: '(clr + wt/2*cs)/k', note: 'קצה הלשונית מהמארח לאורך הציר' },
      { name: 'gauge', expr: 'wt - 2*eW' },
      { name: 'across', expr: 'if(nb > 1, if(gauge >= 2.4*d0 - 0.01, 2, 1), 1)', note: 'ברגים לרוחב' },
      { name: 'rows', expr: 'ceil(nb/across)' },
      { name: 'sLast', expr: 'sTip + edge + (rows-1)*pitch' },
      { name: 's0', expr: '-(wt/2*cs)/k', note: 'קצה הפח (במישור המארח)' },
      { name: 'finL', expr: 'ceil(round((sLast + edge - s0)*100)/500)*5', note: 'עיגון ל-0.01 לפני ceil — רעש ציפה (קורה אנכית בקירוב) חוצה גבול' },
      { name: 'sEnd', expr: 'max(sLast + endDist, s0 + finL + 10)', note: 'קצה ה-RHS מהמפגש' },
      { name: 'tongueL', expr: 'ceil(round((sEnd + ins - sTip)*100)/500)*5' },
      { name: 'sd', expr: '1', note: 'צד הלשונית ביחס לפח (+1 / −1) לאורך הכיוון המוחלט של w' }, { name: 'wa', expr: '5', note: 'גודל ריתוך הפח למארח' },
      { name: 'bs', expr: '1', note: 'מקדם הסטת הציר (0 = הציר כבר על מישור הלשונית)' },
      { name: 'by', expr: 'bs*sd*hs*(ft + tt)/2', note: 'הסטת הציר והלשונית — לאותו צד מוחלט בשני הקצוות' },
    ],
    params: [
      { name: 'd', label: 'קוטר בורג', kind: 'select', group: 'ברגים', options: [12, 16, 20].map((v) => ({ value: v, label: `M${v}` })) },
      { name: 'nb', label: 'ברגים בקצה', kind: 'select', group: 'ברגים', options: [1, 2, 4].map((v) => ({ value: v, label: String(v) })) },
      { name: 'ft', label: 'עובי פח', kind: 'number', unit: 'מ"מ', min: 6, max: 25, group: 'פלטות' },
      { name: 'tt', label: 'עובי לשונית', kind: 'number', unit: 'מ"מ', min: 6, max: 25, group: 'פלטות' },
    ],
    ops: [
      { k: 'shift', id: 'M1', by: 'by' },
      { k: 'cut', id: 'C1', kind: 'perp', at: 'sEnd' },
      { k: 'slot', id: 'S1', L: 'ins + 10', w: 'tt + 2', dir: 'a' },
      { k: 'plate', id: 'F1', name: `פח חיבור ${desc}`, ref: R('main', 'axis', 's0 + finL/2'), mode: 'flat', spin: '-90', off: '-sd*ft/2', shape: 'rect', w: 'finL', h: 'wt', t: 'ft', ch: '0', corners: [false, false, false, false], clipHost: true },
      { k: 'plate', id: 'T1', name: `לשונית ${desc}`, ref: R('main', 'axis', 'sTip + tongueL/2'), mode: 'flat', spin: '-90', off: 'sd*ft/2', shape: 'rect', w: 'tongueL', h: 'wt', t: 'tt', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('main', 'axis-', 'sTip + edge + (rows-1)*pitch/2'), rows: 'rows', cols: 'across', px: 'hs*gauge', py: 'pitch', d0: 'd0', rev: '(1 - sd)/2' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true },
      { k: 'weld', id: 'W1', part: 'F1', a: 'wa', site: false, to: 'host', len: '2*round(wt/max(sn, 0.25))' },
      { k: 'weld', id: 'W2', part: 'T1', a: 'wa', site: false, to: 'main', len: '4*ins' },
    ],
  };
}

/**
 * תמוכה בין קורות, פח + לשונית — שקול ל-`finJoint` כפי ש-`rafterStruts.ts` קורא לו (פרט `fin`). הפעם מישור הפח מקביל ל-w (ניצב ל-a):
 * הפלטות על פני `axisA` (נורמל a קנוני — אותו צד מוחלט בשני קצוות התמוכה). ציר התמוכה כבר מוסט בעובי (פח+לשונית)/2 בקוד הישן (הלשונית במישור הציר),
 * ולכן אין `shift`: הלשונית ממורכזת על הציר והפח צמוד לה מהצד של המארח. רוחב הפח לפי מידת החתך לאורך w (`mb`).
 */
export function strutFinRecipe(): CustomDetail {
  const k = kneeFinRecipe();
  const vars = [...k.vars.filter((v) => v.name !== 'by').map((v) => (v.name === 'wt' ? { ...v, expr: 'max(pb + 2*extra, 2*eW + ceil(2.4*d0/5)*5)' } : v.name === 'sn' ? { ...v, expr: 'round(sin(ang)*1e6)/1e6' } : v.name === 'cs' ? { ...v, expr: 'round(cos(ang)*1e6)/1e6', note: 'מעוגל: תמוכה כמעט ניצבת — רעש ציפה ב-1e-13 היה חוצה גבול עיגול ל-5 מ"מ' } : v)), { name: 'wd', expr: '(hb - htw)/2', note: 'עומק פני הווב מקצה האגפים (המארח נפגע מהצד)' }];
  return {
    ...k, id: STRUT_FIN_RECIPE_ID, name: 'תמוכה בין קורות: פח + לשונית בחריץ (הסבה)',
    note: 'שקול ל-finJoint בתמוכות בין קורות: פח מרותך לווב הקורה, לשונית בחריץ ה-RHS, ברגים בחפיפה.',
    vars,
    match: { member: ['RHS', 'SHS'], host: ['IPE', 'HEA', 'HEB', 'HEM', 'INP'] },
    ops: [
      { k: 'cut', id: 'C1', kind: 'perp', at: 'sEnd - wd' },
      { k: 'slot', id: 'S1', L: 'ins + 10', w: 'tt + 2', dir: 'w' },
      { k: 'plate', id: 'F1', name: 'פח חיבור תמוכה בין קורות', ref: R('main', 'axisA', 's0 + finL/2 - wd'), mode: 'flat', spin: '-90', off: '-(ft+tt)/2 - ft/2', shape: 'rect', w: 'finL', h: 'wt', t: 'ft', ch: '0', corners: [false, false, false, false], clipHost: true, clipOff: 'wd' },
      { k: 'plate', id: 'T1', name: 'לשונית תמוכה בין קורות', ref: R('main', 'axisA', 'sTip + tongueL/2 - wd'), mode: 'flat', spin: '-90', off: '-tt/2', shape: 'rect', w: 'tongueL', h: 'wt', t: 'tt', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('main', 'axisA-', 'sTip + edge + (rows-1)*pitch/2 - wd'), rows: 'rows', cols: 'across', px: 'gauge', py: 'pitch', d0: 'd0' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true },
      { k: 'weld', id: 'W1', part: 'F1', a: '5', site: false, to: 'host', len: '2*round(wt/max(sn, 0.25))' },
      { k: 'weld', id: 'W2', part: 'T1', a: '5', site: false, to: 'main', len: '4*ins' },
    ],
  };
}

/**
 * תמוכה בין קורות, פלטת קצה מוברגת לווב — שקול ל-`endplate` ב-`rafterStruts.ts`. אתר זוגי (G8): כשיש תמוכה משני צדי הווב, אותם ברגים עוברים דרך שתי הפלטות והווב.
 * כל קצה בונה את הפלטה והריתוך שלו; הברגים נבנים באתר אחד בלבד (`bld`) — זה שבצד הנמוך של Y — והפלטה של האתר שכנגד משתתפת בסריקת הברגים
 * (`Connection.recipe.pairs`), כך שהאורך (grip) והחורים בשתי הפלטות נגזרים מהחומר שנמצא בפועל. `bld`/`prt` מגיעים לכל אתר מהחיבור (`recipe.siteParams`).
 */
export function strutEndRecipe(): CustomDetail {
  return {
    id: STRUT_END_RECIPE_ID, name: 'תמוכה בין קורות: פלטת קצה (הסבה)', family: 'any', category: 'brace',
    note: 'שקול ל-endplate בתמוכות בין קורות: פלטת קצה מרותכת לתמוכה (מסגריה), מוברגת לווב הקורה; משני צדי הווב — אותם ברגים.',
    match: { member: ['RHS', 'SHS'], host: ['IPE', 'HEA', 'HEB', 'HEM', 'INP'] },
    vars: [
      { name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'd0', expr: 'd+2', note: 'קוטר חור' }, { name: 'nb', expr: '2', note: 'ברגים (2/4)' },
      { name: 'ft', expr: '10', note: 'עובי פלטת הקצה' },
      { name: 'e', expr: 'max(30, ceil(1.5*d0))', note: 'מרחק שפה' },
      { name: 'W', expr: 'ceil((pb + 4*e)/5)*5', note: 'רוחב הפלטה לאורך השיפוע' },
      { name: 'clear', expr: 'hh - 2*htf - 2*hr', note: 'גובה הווב הפנוי בקורה' },
      { name: 'Hp', expr: 'max(60, min(ph, floor(clear/5)*5))', note: 'גובה הפלטה' },
      { name: 'four', expr: 'if(nb > 3, if(Hp - 2*e >= 2.4*d0 - 0.01, 1, 0), 0)', note: '4 ברגים (אם הגובה מאפשר)' },
      { name: 'wd', expr: '(hb - htw)/2', note: 'עומק פני הווב מקצה האגפים (המארח נפגע מהצד)' },
      { name: 'bld', expr: '1', note: 'האתר הזה בונה את הברגים (אתר זוגי: רק אחד)' }, { name: 'prt', expr: '0', note: 'יש תמוכה גם בצד השני של הווב' },
    ],
    params: [
      { name: 'd', label: 'קוטר בורג', kind: 'select', group: 'ברגים', options: [12, 16, 20].map((v) => ({ value: v, label: `M${v}` })) },
      { name: 'nb', label: 'ברגים בקצה', kind: 'select', group: 'ברגים', options: [2, 4].map((v) => ({ value: v, label: String(v) })) },
      { name: 'ft', label: 'עובי פלטת קצה', kind: 'number', unit: 'מ"מ', min: 6, max: 25, group: 'פלטות' },
    ],
    ops: [
      { k: 'cut', id: 'C1', kind: 'perp', at: 'ft - wd' },
      { k: 'plate', id: 'F1', name: 'פלטת קצה תמוכה', ref: R('host', 'hit'), mode: 'flat', spin: '-90', off: '-wd', shape: 'rect', w: 'W', h: 'Hp', t: 'ft', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('F1', 'z-'), rows: 'if(four, 2, 1)', cols: '2', px: 'pb + 2*e', py: 'Hp - 2*e', d0: 'd0' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'htw + ft*(1 + prt)', when: 'bld' },
      { k: 'weld', id: 'W1', part: 'F1', a: '4', site: false, to: 'main', len: '2*(pb + ph)' },
    ],
  };
}

/**
 * תמוכה בין קורות, ריתוך ישיר לווב (שטח) — שקול ל-`weld` ב-`rafterStruts.ts`: אין פלטות ואין ברגים; התמוכה נעצרת במרווח 1 מ"מ מפני הווב,
 * וריתוך היקפי (a לפי עובי דופן ה-RHS, 4–6) לווב. הריתוך בשטח — בכוונה, כמו בקוד הישן (אזהרת "ריתוך בשטח" לא נוספת במתכון מובנה).
 */
export function strutWeldRecipe(): CustomDetail {
  return {
    id: STRUT_WELD_RECIPE_ID, name: 'תמוכה בין קורות: ריתוך ישיר לווב (הסבה)', family: 'any', category: 'brace',
    note: 'שקול ל-weld בתמוכות בין קורות: ה-RHS מרותך ישירות לווב הקורה בשטח (ריתוך היקפי), ללא פחים.',
    match: { member: ['RHS', 'SHS'], host: ['IPE', 'HEA', 'HEB', 'HEM', 'INP'] },
    vars: [
      { name: 'wd', expr: '(hb - htw)/2', note: 'עומק פני הווב מקצה האגפים (המארח נפגע מהצד)' },
      { name: 'gap', expr: '1', note: 'מרווח בין קצה התמוכה לפני הווב' },
      { name: 'wa', expr: 'max(4, min(6, round(mt)))', note: 'גודל ריתוך a (לפי עובי דופן ה-RHS)' },
    ],
    ops: [
      { k: 'cut', id: 'C1', kind: 'perp', at: 'gap - wd' },
      { k: 'weld', id: 'W1', part: 'main', a: 'wa', site: true, len: '2*(pb + ph)' },
    ],
  };
}

/**
 * תושבת פטה — זוויתן L מרותך לקורה (מסגריה), מוברג לווב הפטה (שטח) — שקול לסגנון `run` ב-`connections.ts`. אתר חציה (`פטה|x:מסגרת`).
 * כל הפרמטרים מגיעים מהחיבור (`Connection.recipe.params`, כולל חריגי תושבת בודדת): גובה H, רגל בסיס B, עובי t, רוחב W, שורות/ברגים בשורה, מרווחים, גובה שורה תחתונה hh0,
 * קוטר/מרווח חור, ריתוך a, ואורך אחיזה gt (עובי + עובי דופן הפטה, כמו בקוד הישן).
 */
export function cleatRunRecipe(): CustomDetail {
  return {
    id: CLEAT_RUN_RECIPE_ID, name: 'תושבת פטה: זוויתן מרותך (הסבה)', family: 'cleat', category: 'support',
    note: 'שקול לתושבת הזוויתן: זוויתן L מרותך לקורה, מוברג לווב הפטה.',
    vars: [
      { name: 'H', expr: 'mh', note: 'גובה הרגל הניצבת' }, { name: 'B', expr: '60', note: 'רגל הבסיס' }, { name: 't', expr: '8', note: 'עובי' }, { name: 'W', expr: '100', note: 'רוחב לאורך הפטה' },
      { name: 'rows', expr: '1', note: 'שורות' }, { name: 'perRow', expr: '2', note: 'ברגים בשורה' }, { name: 'pitch', expr: '60', note: 'מרווח בשורה' }, { name: 'rowPitch', expr: '60', note: 'מרווח בין שורות' },
      { name: 'hh0', expr: '(H - (rows - 1)*rowPitch)/2', note: 'גובה השורה התחתונה מפני הקורה' },
      { name: 'd', expr: '12', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'מרווח חור' }, { name: 'a', expr: '5', note: 'גודל ריתוך' }, { name: 'gt', expr: 't + mt', note: 'אורך אחיזה' },
    ],
    ops: [
      { k: 'angle', id: 'A1', name: 'זוויתן', ref: R('main', 'a+'), H: 'H', B: 'B', t: 't', w: 'W' },
      { k: 'holes', id: 'H1', ref: R('A1', 'z-', 'hh0 + (rows - 1)*rowPitch/2 - H/2', '0'), rows: 'rows', cols: 'perRow', px: 'pitch', py: 'rowPitch', d0: 'd + cl' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'gt' },
      { k: 'weld', id: 'W1', part: 'A1', a: 'a', site: false, to: 'host', len: 'W + 2*B' },
    ],
  };
}

/**
 * תושבת פטה — פלטה אנכית צמודה לווב + משולש תמיכה מאחוריה (סגנון `plate`, בלי תפר פטה מעל התומך) — שקול ל-`connections.ts`.
 * הפרמטרים מהחיבור: H, T (עובי), nc (עמודות חורים לאורך הפטה), cp (מרווח), rows/rp (שורות ומרווח, כבר מוגבלים לגובה), hh0, e, Bs/Hs (משולש), d/cl, a, gt.
 */
export function cleatPlateRecipe(): CustomDetail {
  return {
    id: CLEAT_PLATE_RECIPE_ID, name: 'תושבת פטה: פלטה + משולש (הסבה)', family: 'cleat', category: 'support',
    note: 'שקול לתושבת פלטה + משולש תמיכה: פלטה אנכית צמודה לווב הפטה, משולש מאחוריה; מרותך לקורה, מוברג לפטה.',
    vars: [
      { name: 'H', expr: 'mh', note: 'גובה הפלטה' }, { name: 'T', expr: '8', note: 'עובי' }, { name: 'nc', expr: '2', note: 'עמודות חורים' }, { name: 'cp', expr: '60', note: 'מרווח בין עמודות' },
      { name: 'rows', expr: '1', note: 'שורות חורים' }, { name: 'rp', expr: '0', note: 'מרווח בין שורות' }, { name: 'hh0', expr: '(H - (rows - 1)*rp)/2', note: 'גובה השורה התחתונה' },
      { name: 'e', expr: 'max(30, ceil(1.5*(d + cl)/5)*5)', note: 'מרחק שפה' }, { name: 'Bs', expr: '60', note: 'בסיס המשולש' }, { name: 'Hs', expr: 'max(40, H - 15)', note: 'גובה המשולש' },
      { name: 'W', expr: 'ceil(((nc - 1)*cp + 2*e)/5)*5', note: 'רוחב הפלטה לאורך הפטה' },
      { name: 'd', expr: '12', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'מרווח חור' }, { name: 'a', expr: '5', note: 'גודל ריתוך' }, { name: 'gt', expr: 'T + mt', note: 'אורך אחיזה' },
      { name: 'sj', expr: '0', note: 'היסט מרכז התושבת לאורך הפטה (תפר פטה מעל תומך: מיקום התפר ביחס לציר התומך)' },
    ],
    ops: [
      { k: 'plate', id: 'P1', name: 'פלטת תושבת', ref: R('host', 'hit', 'sj', 'cs*(wo + T/2)'), mode: 'stand', spin: '0', off: '0', shape: 'rect', w: 'H', h: 'W', t: 'T', ch: '0', corners: [false, false, false, false] },
      { k: 'plate', id: 'G1', name: 'משולש תמיכה', ref: R('host', 'hit', 'sj', 'cs*(wo + T + Bs/2)'), mode: 'stand', spin: 'sr', off: '0', shape: 'rtri', w: 'Hs', h: 'Bs', t: 'T', ch: '0', corners: [false, false, false, false] },
      // חורים על פני הפטה (פנים a-: נורמל קנוני לכיוון הווב, בשני צדי הגג), לא על הפלטה — כיוון הנורמל של פלטת stand תלוי בצד
      { k: 'holes', id: 'H1', ref: R('main', 'a-', 'hh0 + (rows - 1)*rp/2', 'xs*sj'), rows: 'rows', cols: 'nc', px: 'cp', py: 'rp', d0: 'd + cl' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'gt' },
      { k: 'weld', id: 'W1', part: 'P1', a: 'a', site: false, to: 'host', len: '2*W' },
      { k: 'weld', id: 'W2', part: 'G1', a: 'min(a, 5)', site: false, to: 'P1', len: '2*(Bs + Hs)' },
      { k: 'weld', id: 'W3', part: 'G1', a: 'min(a, 5)', site: false, to: 'host', len: '2*Bs' },
    ],
  };
}

/**
 * תושבת פטה בתפר מעל תומך — פלטה אחת + משולש (4 חורים: 2 שורות × עמודה אחת בכל פטה) שמחברת את שני קצות הפטה.
 * הפטה רציפה בשיוך האלמנט (התפר רק מחלק אותה לחלקי ייצור), לכן זה אתר חציה רגיל ואין צורך באתר זוגי: אותו מתכון כמו `cleatPlateRecipe`,
 * עם היסט `sj` (מיקום התפר ביחס לציר התומך) ועמודות החורים משני צדי התפר (`cp` = 2·(5 + e)); רק תיאור הפלטה נושא "(תפר פטה)".
 */
export function cleatSeamRecipe(): CustomDetail {
  const base = cleatPlateRecipe();
  return {
    ...base, id: CLEAT_SEAM_RECIPE_ID, name: 'תושבת פטה: תפר מעל תומך (הסבה)',
    note: 'שקול לתושבת התפר: פלטה אחת + משולש תמיכה, 2 ברגים בשורה בכל פטה משני צדי התפר; מרותך לקורה, מוברג לשתי הפטות.',
    ops: base.ops.map((o) => (o.k === 'plate' && o.id === 'P1' ? { ...o, suffix: '(תפר פטה)' } : o)),
  };
}

/**
 * תושבת פטה — זוויתן עומד (שווה-רגליים, למשל L40x4): רגל מוברגת צמודה לווב הפטה, רגל ניצבת מהווב החוצה; מרותך לקורה; חורים אנכיים בציר התומך (2 לפחות).
 * הפרמטרים מהחיבור: hc (גובה/אורך הזוויתן), lg (רגל), t (עובי), rows/rp (שורות ומרווח, כבר מוגבלים), hh0, d/cl, a, gt, og (היסט הפינה לאורך הפטה: −(lg + t)/2 מעוגל, כמו בקוד הישן).
 */
export function cleatStandRecipe(): CustomDetail {
  return {
    id: CLEAT_STAND_RECIPE_ID, name: 'תושבת פטה: זוויתן עומד (הסבה)', family: 'cleat', category: 'support',
    note: 'שקול לתושבת הזוויתן העומד: זוויתן שווה-רגליים מרותך לקורה, מוברג לווב הפטה בחורים אנכיים.',
    vars: [
      { name: 'hc', expr: 'mh', note: 'אורך הזוויתן (גובה התושבת)' }, { name: 'lg', expr: '40', note: 'רגל הזוויתן' }, { name: 't', expr: '4', note: 'עובי' },
      { name: 'rows', expr: '2', note: 'שורות חורים (אנכיות)' }, { name: 'rp', expr: '60', note: 'מרווח בין שורות' }, { name: 'hh0', expr: '(hc - (rows - 1)*rp)/2', note: 'גובה השורה התחתונה' },
      { name: 'og', expr: '-round((lg + t)/2)', note: 'היסט הפינה לאורך הפטה' },
      { name: 'd', expr: '12', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'מרווח חור' }, { name: 'a', expr: 't', note: 'גודל ריתוך' }, { name: 'gt', expr: 't + mt', note: 'אורך אחיזה' },
    ],
    ops: [
      { k: 'angle', id: 'A1', name: 'זוויתן עומד', ref: R('main', 'a+'), H: 'lg', B: 'lg', t: 't', w: 'hc', vert: true, off: 'og' },
      { k: 'holes', id: 'H1', ref: R('main', 'a-', 'hh0 + (rows - 1)*rp/2', '0'), rows: 'rows', cols: '1', px: '0', py: 'rp', d0: 'd + cl' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'gt' },
      { k: 'weld', id: 'W1', part: 'A1', a: 'a', site: false, to: 'host', len: '4*lg' },
    ],
  };
}

const BASE_VARS = [
  { name: 'l', expr: '230', note: 'אורך הפלטה (לאורך X העולמי)' }, { name: 'w', expr: '230', note: 'רוחב הפלטה (לאורך Y)' }, { name: 't', expr: '20', note: 'עובי הפלטה' },
  { name: 'rows', expr: '3', note: 'שורות (לאורך X)' }, { name: 'pitch', expr: '80', note: 'מרווח בין שורות' }, { name: 'cols', expr: '3', note: 'עמודות (לאורך Y)' }, { name: 'gauge', expr: '80', note: 'מרווח בין עמודות' },
  { name: 'd', expr: '20', note: 'קוטר מוט/בורג עיגון' }, { name: 'cl', expr: '2', note: 'תוספת קוטר חור' }, { name: 'a', expr: '4', note: 'גודל ריתוך' }, { name: 'al', expr: '800', note: 'אורך עיגון מתחת לפלטה' },
  { name: 'wl', expr: '0', note: 'אורך ריתוך העמוד לפלטה (היקף החתך)' },
  { name: 'sw', expr: '0', note: '1 = ציר a של העמוד לאורך Y (הרשת מוחלפת)' }, { name: 'sp', expr: 'if(sw, 0, 90)', note: 'סיבוב הפלטה כך שהאורך l ילך לאורך X' },
  { name: 'nA', expr: 'if(sw, cols, rows)' }, { name: 'pA', expr: 'if(sw, gauge, pitch)' }, { name: 'nB', expr: 'if(sw, rows, cols)' }, { name: 'pB', expr: 'if(sw, pitch, gauge)' },
];
const BASE_PLATE = (name: string): DetailOp => ({ k: 'plate', id: 'P1', name, ref: R('main', 'end'), mode: 'flat', spin: 'sp', off: '0', shape: 'rect', w: 'l', h: 'w', t: 't', ch: '0', corners: [false, false, false, false] });

/**
 * פלטת בסיס מבוטנת — פלטה מתחת לעמוד (פני הפלטה העליונים = קצה העמוד), מוטות עיגון מרותכים בחורי ההיקף של הרשת (G5), העמוד מרותך לפלטה בשטח (חריג מאושר).
 * הפרמטרים מהחיבור: l, w, t, rows/pitch (לאורך X), cols/gauge (לאורך Y), d, cl (תוספת חור), a, al (אורך עיגון), wl (היקף חתך העמוד), sw (הרשת מוחלפת כשציר a של העמוד לאורך Y).
 */
export function baseEmbeddedRecipe(): CustomDetail {
  return {
    id: BASE_EMBEDDED_RECIPE_ID, name: 'פלטת בסיס מבוטנת (הסבה)', family: 'base', category: 'support',
    note: 'שקול לפלטת הבסיס המבוטנת: פלטה, מוטות עיגון מרותכים בהיקף הרשת, העמוד מרותך לפלטה בשטח.',
    vars: BASE_VARS,
    ops: [
      BASE_PLATE('פלטה מבוטנת'),
      { k: 'holes', id: 'H1', ref: R('main', 'end'), rows: 'nA', cols: 'nB', px: 'pB', py: 'pA', d0: 'd + cl', ring: true },
      { k: 'rod', id: 'A', ref: R('main', 'end'), d: 'd', L: 'al + t', holes: 'H1', to: 'P1', a: 'a', label: 'מוט עיגון', material: 'S235', desc: '— עובר בפלטה, צמוד לפניה העליונים ומרותך סביב החור' },
      { k: 'weld', id: 'W1', part: 'P1', a: 'a', site: true, to: 'main', len: 'wl', exact: true },
    ],
  };
}

/**
 * פלטת בסיס עם ברגי עוגן — פלטה מרותכת לעמוד במסגריה (העמוד נחתך בעובי הפלטה), ברגי עוגן בכל נקודות הרשת (בשטח). `grade`/`standard`: מפרט הבורג של הבסיס.
 */
export function baseBoltedRecipe(grade: string, standard: string): CustomDetail {
  return {
    id: grade === '8.8' ? BASE_BOLTED_RECIPE_ID : BASE_BOLTED_B500_RECIPE_ID, name: `פלטת בסיס מוברגת (הסבה${grade === '8.8' ? '' : ', ' + grade})`, family: 'base', category: 'support',
    note: 'שקול לפלטת בסיס עם ברגי עוגן: פלטה מרותכת לעמוד במסגריה, ברגי עוגן בשטח.',
    vars: BASE_VARS.map((v) => (v.name === 'al' ? { ...v, expr: '500' } : v)).concat([{ name: 'tc', expr: 't', note: 'עומק חיתוך העמוד (עובי הפלטה)' }]),
    ops: [
      { k: 'cut', id: 'C1', kind: 'host', at: 'tc', keep: true },
      BASE_PLATE('פלטת בסיס'),
      { k: 'holes', id: 'H1', ref: R('main', 'end'), rows: 'nA', cols: 'nB', px: 'pB', py: 'pA', d0: 'd + cl' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade, standard, site: true, grip: 't', anchor: 'al' },
      { k: 'weld', id: 'W1', part: 'P1', a: 'a', site: false, to: 'main', len: 'wl', exact: true },
    ],
  };
}

/**
 * חיבור צד — קורה שמסתיימת בעמוד שממשיך מעליה (גג מדורג / רכס מעל עמוד): פלטת קצה אנכית מרותכת לקורה (מסגריה), מוברגת לאגף העמוד (שטח).
 * הקורה נחתכת במישור אנכי בעובי הפלטה מפני האגף. הפרמטרים מהחיבור: t, w (רוחב), Hp (גובה הפלטה = גובה הקורה האנכי + 2·l), cols/gauge, nr (שורות) ו-rp (מרווח שורות, כבר מחושב),
 * d/cl, a, gt (אחיזה = עובי + אגף העמוד), wl (היקף חתך הקורה).
 */
export function sideRecipe(): CustomDetail {
  return {
    id: SIDE_RECIPE_ID, name: 'חיבור צד: פלטת קצה לאגף העמוד (הסבה)', family: 'side', category: 'support',
    note: 'שקול לחיבור קורה לצד עמוד: פלטת קצה אנכית מרותכת לקורה, מוברגת לאגף העמוד.',
    vars: [
      { name: 't', expr: '15', note: 'עובי הפלטה' }, { name: 'w', expr: '160', note: 'רוחב הפלטה' }, { name: 'Hp', expr: '300', note: 'גובה הפלטה' }, { name: 'dz', expr: '0', note: 'היסט מרכז הפלטה כלפי מעלה מנקודת הפגיעה (קורה שקו הייחוס שלה בפני העליון: −גובה/2)' },
      { name: 'cols', expr: '2', note: 'עמודות ברגים' }, { name: 'gauge', expr: '90', note: 'מרווח בין עמודות' }, { name: 'nr', expr: '2', note: 'שורות ברגים' }, { name: 'rp', expr: '0', note: 'מרווח בין שורות' },
      { name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'תוספת קוטר חור' }, { name: 'a', expr: '6', note: 'גודל ריתוך' }, { name: 'gt', expr: 't + 10', note: 'אורך אחיזה' }, { name: 'wl', expr: '0', note: 'היקף חתך הקורה' },
    ],
    ops: [
      { k: 'cut', id: 'C1', kind: 'vert', at: 't/sin(ang)' },
      { k: 'plate', id: 'P1', name: 'פלטת קצה', ref: R('host', 'hit', 'ev*dz', '0'), mode: 'flat', spin: '90', off: '0', shape: 'rect', w: 'Hp', h: 'w', t: 't', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('P1', 'z-'), rows: 'cols', cols: 'nr', px: 'rp', py: 'gauge', d0: 'd + cl' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'gt', noMain: true, headUp: 'Z' },
      { k: 'weld', id: 'W1', part: 'P1', a: 'a', site: false, to: 'main', len: 'wl', exact: true },
    ],
  };
}

/**
 * מסבך נעילה, סגנון פלטת קצה (G4 — אתר של שלושה אלמנטים: עמוד + סיב/חגורה משני צדיו): פלטה אנכית מרותכת לקצה הסיב (מסגריה), צמודה לפני העמוד;
 * 4 ברגים ארוכים עוברים דרך הפלטות ודרך שני דפנות העמוד (בעמוד קצה — פלטה אחת). **ללא מודל חדש:** אתר זוגי (`pairs`) כמו תמוכה עם פלטת קצה —
 * כל קצה בונה פלטה וריתוך משלו, והברגים נבנים באתר אחד (`bld`: הצד הנמוך של Y, או היחיד) כשהפלטה שכנגד משתתפת בסריקה (`prt`).
 * `hiS` = 1 בצד הגבוה (נורמל +Y): כיוון הבורג הפוך — תמיד +Y, כמו בקוד הישן.
 * הפרמטרים מהחיבור: t, Hp (גובה הפלטה, לאורך הציר), Wp (רוחב), g/pv (מרווח ברגים לרוחב/לגובה), d/cl, a, wl (היקף חתך הסיב), ctw (רוחב העמוד בין הדפנות).
 */
export function lockPlateRecipe(): CustomDetail {
  return {
    id: LOCK_PLATE_RECIPE_ID, name: 'מסבך נעילה: פלטת קצה לעמוד (הסבה)', family: 'any', category: 'brace',
    note: 'שקול לחיבור פלטת הקצה של מסבך הנעילה: פלטה מרותכת לסיב, 4 ברגים דרך העמוד; משני צדי העמוד — אותם ברגים.',
    vars: [
      { name: 't', expr: '10', note: 'עובי הפלטה' }, { name: 'Hp', expr: '250', note: 'גובה הפלטה' }, { name: 'Wp', expr: '130', note: 'רוחב הפלטה' },
      { name: 'g', expr: '50', note: 'מרווח ברגים לרוחב' }, { name: 'pv', expr: '170', note: 'מרווח ברגים לגובה' },
      { name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'תוספת קוטר חור' }, { name: 'a', expr: '4', note: 'גודל ריתוך' },
      { name: 'wl', expr: '0', note: 'היקף חתך הסיב' }, { name: 'ctw', expr: '200', note: 'רוחב העמוד בכיוון הברגים' },
      { name: 'bld', expr: '1', note: 'האתר הזה בונה את הברגים' }, { name: 'prt', expr: '0', note: 'יש פלטה גם בצד השני של העמוד' }, { name: 'hiS', expr: '0', note: '1 = הצד הגבוה של העמוד' },
    ],
    ops: [
      { k: 'cut', id: 'C1', kind: 'perp', at: 't' },
      { k: 'plate', id: 'P1', name: 'פלטת קצה לסיב', ref: R('host', 'hit'), mode: 'flat', spin: '-90', off: '0', shape: 'rect', w: 'Hp', h: 'Wp', t: 't', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('P1', 'z-'), rows: '2', cols: '2', px: 'pv', py: 'g', d0: 'd + cl', rev: 'hiS' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'ctw + t*(1 + prt)', when: 'bld', noMain: true, headUp: 'Z', reach: 'ctw' },
      { k: 'weld', id: 'W1', part: 'P1', a: 'a', site: false, to: 'main', len: 'wl', exact: true },
    ],
  };
}
