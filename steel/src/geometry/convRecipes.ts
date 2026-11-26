import type { CustomDetail, DetailRef } from '../model/types';

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

/** סוג החיבור המובנה שהמתכון מחליף — לחתימות שמבוססות על סוגי חיבורים (קיבוץ מסגרות זהות בשרטוטים) */
export const RECIPE_CONN_TYPE: Record<string, 'knee' | 'brace' | 'purlin-cleat'> = { [KNEE_FIN_RECIPE_ID]: 'knee', [STRUT_FIN_RECIPE_ID]: 'brace', [STRUT_END_RECIPE_ID]: 'brace', [STRUT_WELD_RECIPE_ID]: 'brace', [CLEAT_RUN_RECIPE_ID]: 'purlin-cleat' };

/** מתכונים מובנים לפי מזהה (מחוץ ל-`project.customDetails`): מחולים אוטומטית לפי `Connection.recipe` */
export const BUILTIN_RECIPES: Record<string, () => CustomDetail> = { [KNEE_FIN_RECIPE_ID]: () => kneeFinRecipe(), [STRUT_FIN_RECIPE_ID]: () => strutFinRecipe(), [STRUT_END_RECIPE_ID]: () => strutEndRecipe(), [STRUT_WELD_RECIPE_ID]: () => strutWeldRecipe(), [CLEAT_RUN_RECIPE_ID]: () => cleatRunRecipe() };

/**
 * אלכסון עמוד-קורה, פח + לשונית בחריץ — שקול ל-`finJoint` ב-`geometry/finJoint.ts` (פרט הלקוח 15.11.2026).
 * פח במישור הציר המקורי, חתוך לפי פני המארח; לשונית בחריץ ה-RHS מוסטת בעובי (פח+לשונית)/2 — והאלכסון עמה.
 */
export function kneeFinRecipe(): CustomDetail {
  return {
    id: KNEE_FIN_RECIPE_ID, name: 'אלכסון: פח + לשונית בחריץ (הסבה)', family: 'any', category: 'brace',
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
      { name: 'finL', expr: 'ceil((sLast + edge - s0)/5)*5' },
      { name: 'sEnd', expr: 'max(sLast + endDist, s0 + finL + 10)', note: 'קצה ה-RHS מהמפגש' },
      { name: 'tongueL', expr: 'ceil((sEnd + ins - sTip)/5)*5' },
      { name: 'by', expr: 'hs*(ft + tt)/2', note: 'הסטת הציר והלשונית — לאותו צד מוחלט בשני הקצוות' },
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
      { k: 'plate', id: 'F1', name: 'פח חיבור אלכסון', ref: R('main', 'axis', 's0 + finL/2'), mode: 'flat', spin: '-90', off: '-ft/2', shape: 'rect', w: 'finL', h: 'wt', t: 'ft', ch: '0', corners: [false, false, false, false], clipHost: true },
      { k: 'plate', id: 'T1', name: 'לשונית אלכסון', ref: R('main', 'axis', 'sTip + tongueL/2'), mode: 'flat', spin: '-90', off: 'ft/2', shape: 'rect', w: 'tongueL', h: 'wt', t: 'tt', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('main', 'axis-', 'sTip + edge + (rows-1)*pitch/2'), rows: 'rows', cols: 'across', px: 'hs*gauge', py: 'pitch', d0: 'd0' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true },
      { k: 'weld', id: 'W1', part: 'F1', a: '5', site: false, to: 'host', len: '2*round(wt/max(sn, 0.25))' },
      { k: 'weld', id: 'W2', part: 'T1', a: '5', site: false, to: 'main', len: '4*ins' },
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
