import type { CustomDetail, DetailOp, DetailRef } from '../model/types';

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

export const BEAM_SPLICE_BOLTED_RECIPE_ID = 'conv-beam-splice-bolted';
export const BEAM_SPLICE_FLANGE_RECIPE_ID = 'conv-beam-splice-flange';
export const BEAM_SPLICE_WELDED_I_RECIPE_ID = 'conv-beam-splice-welded-i';
export const BEAM_SPLICE_WELDED_BOX_RECIPE_ID = 'conv-beam-splice-welded-box';

const NO_CORNERS: [boolean, boolean, boolean, boolean] = [false, false, false, false];
/** פלטה שטוחה על פנים של אתר אמצע; `spin` מבטיח שכיוון הפלטה (התחלה→סוף) זהה לקוד הישן, בלי תלות בימניות המערכת המקומית (`rh`) */
const flat = (id: string, name: string, ref: DetailRef, spin: string, w: string, h: string, t: string, off = '0'): DetailOp => ({ k: 'plate', id, name, ref, mode: 'flat', spin, off, shape: 'rect', w, h, t, ch: '0', corners: NO_CORNERS });

/**
 * חיבור המשך מוברג לקורה/עמוד I — שתי פלטות קצה (כל אחת מרותחת לחלק שלה, במסגריה), מוגבהות מעל ומתחת לאגפים, מוברגות זו לזו בשטח:
 * שורה מחוץ לכל אגף ושתי שורות בין האגפים, שתי עמודות. הקורה רציפה במודל (החלקים נחתכים ב-`buildParts` עם פער BEAM_SPLICE_T) — הפלטות לצדי מישור התפר.
 * פרמטרים (מ-`autoSplice.ts`): T עובי, W רוחב (=b), Hp גובה, pc היסט מרכז הפלטה (flush: כלפי מטה), g מרווח עמודות, vOut/vIn מיקום שורות, flush = 1 בקורה נושאת (אין שורה עליונה חיצונית),
 * per היקף ריתוך, d/cl בורג, a גודל ריתוך. פלטות חיזוק (`settings.spliceStiffeners`) — תמיד הקוד הישן.
 */
export function beamSpliceBoltedRecipe(): CustomDetail {
  return {
    id: BEAM_SPLICE_BOLTED_RECIPE_ID, name: 'חיבור המשך קורה: פלטות קצה מוברגות (הסבה)', family: 'splice', category: 'splice',
    note: 'שקול לחיבור ההמשך בפלטות קצה: שתי פלטות מרותכות לקצוות, מוברגות זו לזו.',
    vars: [
      { name: 'T', expr: '12', note: 'עובי פלטה' }, { name: 'W', expr: 'pb', note: 'רוחב פלטה' }, { name: 'Hp', expr: 'mh + 120', note: 'גובה פלטה' }, { name: 'pc', expr: '0', note: 'היסט מרכז הפלטה (אנכי)' },
      { name: 'g', expr: '60', note: 'מרווח עמודות ברגים' }, { name: 'vOut', expr: '100', note: 'שורה מחוץ לאגף' }, { name: 'vIn', expr: '60', note: 'שורות בין האגפים' }, { name: 'flush', expr: '0', note: '1 = פלטה סמויה מלמעלה' },
      { name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'מרווח חור' }, { name: 'per', expr: '800', note: 'היקף ריתוך' }, { name: 'a', expr: '6', note: 'גודל ריתוך' },
    ],
    ops: [
      flat('PL1', 'פלטת המשך', R('main', 'u-', '0', '-xs*pc'), 'if(rh > 0, 180, 0)', 'Hp', 'W', 'T'),
      flat('PL2', 'פלטת המשך', R('main', 'u+', '0', 'xs*pc'), 'if(rh > 0, 0, 180)', 'Hp', 'W', 'T'),
      { k: 'holes', id: 'H1', ref: R('main', 'u+', '0', 'xs*vOut'), rows: '2', cols: '1', px: '0', py: 'g', d0: 'd + cl' },
      { k: 'holes', id: 'H2', ref: R('main', 'u+', '0', '0'), rows: '2', cols: '2', px: '2*vIn', py: 'g', d0: 'd + cl' },
      { k: 'holes', id: 'H3', ref: R('main', 'u+', '0', '-xs*vOut'), rows: '2', cols: '1', px: '0', py: 'g', d0: 'd + cl' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: '2*T', when: '1 - flush' },
      { k: 'bolts', id: 'B2', holes: 'H2', d: 'd', grade: '8.8', site: true, grip: '2*T' },
      { k: 'bolts', id: 'B3', holes: 'H3', d: 'd', grade: '8.8', site: true, grip: '2*T' },
      { k: 'weld', id: 'W1', part: 'PL1', a: 'a', site: false, to: 'main', len: 'per', ax: '-T/2' },
      { k: 'weld', id: 'W2', part: 'PL2', a: 'a', site: false, to: 'main', len: 'per', ax: 'T/2' },
    ],
  };
}

/**
 * חיבור המשך מוברג לצינור מלבני/ריבועי (פלנץ) — שתי פלטות PL20 סביב קצות הצינור, רחבות לצדדים בלבד, ברגים מחוץ לדפנות הצד (גישה לאום).
 * פרמטרים: T, W, Hp (=h), a (מרכז הבורג מציר הצינור), nr (2/3 שורות), pv מרווח השורות, per, d/cl, aw גודל ריתוך.
 */
export function beamSpliceFlangeRecipe(): CustomDetail {
  return {
    id: BEAM_SPLICE_FLANGE_RECIPE_ID, name: 'חיבור המשך צינור: פלנץ מוברג (הסבה)', family: 'splice', category: 'splice',
    note: 'שקול לחיבור ההמשך בפלנץ לצינור: שתי פלטות מרותכות לקצוות, מוברגות זו לזו מחוץ לדפנות הצד.',
    vars: [
      { name: 'T', expr: '20', note: 'עובי פלטה' }, { name: 'W', expr: '200', note: 'רוחב פלטה' }, { name: 'Hp', expr: 'mh', note: 'גובה פלטה' }, { name: 'a', expr: '100', note: 'מרכז הבורג מציר הצינור (לרוחב)' },
      { name: 'nr', expr: '2', note: 'שורות ברגים' }, { name: 'pv', expr: '100', note: 'מרווח שורות' }, { name: 'd', expr: '16', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'מרווח חור' },
      { name: 'per', expr: '800', note: 'היקף ריתוך' }, { name: 'aw', expr: '6', note: 'גודל ריתוך' },
    ],
    ops: [
      flat('PL1', 'פלטת פלנץ', R('main', 'u-'), 'if(rh > 0, 180, 0)', 'Hp', 'W', 'T'),
      flat('PL2', 'פלטת פלנץ', R('main', 'u+'), 'if(rh > 0, 0, 180)', 'Hp', 'W', 'T'),
      { k: 'holes', id: 'H1', ref: R('main', 'u+'), rows: '2', cols: 'nr', px: 'pv', py: '2*a', d0: 'd + cl' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: '2*T' },
      { k: 'weld', id: 'W1', part: 'PL1', a: 'aw', site: false, to: 'main', len: 'per', ax: '-T/2' },
      { k: 'weld', id: 'W2', part: 'PL2', a: 'aw', site: false, to: 'main', len: 'per', ax: 'T/2' },
    ],
  };
}

/** שתי ריתוכים לכל פלטה (אחד לכל צד של התפר — שני החלקים מרותכים לאותה פלטה ⇒ מכלול אחד), במיקום ±L/4 על הציר */
const weld2 = (part: string, L: string): DetailOp[] => [
  { k: 'weld', id: `${part}A`, part, a: 'a', site: false, to: 'main', len: `${L} + wd${part}`, ax: `-${L}/4` },
  { k: 'weld', id: `${part}B`, part, a: 'a', site: false, to: 'main', len: `${L} + wd${part}`, ax: `${L}/4` },
];

/**
 * חיבור המשך מרותך (מסגריה) לקורה/עמוד I — פלטות כיסוי על שני האגפים (wf) ושתי פלטות ווב (hw), אורך L, עובי T; כל פלטה מרותכת לשני החלקים (מכלול אחד).
 * פרמטרים: h, tw, wf, hw, L, T, a.
 */
export function beamSpliceWeldedIRecipe(): CustomDetail {
  return {
    id: BEAM_SPLICE_WELDED_I_RECIPE_ID, name: 'חיבור המשך קורה: פלטות כיסוי מרותכות (הסבה)', family: 'splice', category: 'splice',
    note: 'שקול לחיבור ההמשך המרותך: פלטות כיסוי על האגפים ופלטות ווב, מרותכות לשני החלקים במסגריה.',
    vars: [
      { name: 'h', expr: 'mh' }, { name: 'tw', expr: 'mt' }, { name: 'wf', expr: '100', note: 'רוחב פלטת אגף' }, { name: 'hw', expr: '100', note: 'גובה פלטת ווב' }, { name: 'L', expr: '500', note: 'אורך הפלטות' }, { name: 'T', expr: '12', note: 'עובי' }, { name: 'a', expr: '6', note: 'גודל ריתוך' },
      { name: 'wdFT', expr: 'wf' }, { name: 'wdFB', expr: 'wf' }, { name: 'wdWL', expr: 'hw' }, { name: 'wdWR', expr: 'hw' },
    ],
    ops: [
      flat('FT', 'פלטת כיסוי אגף עליון', R('main', 'a+'), 'if(rh > 0, 180, 0)', 'L', 'wf', 'T', 'h/2'),
      flat('FB', 'פלטת כיסוי אגף תחתון', R('main', 'a-'), 'if(rh > 0, 0, 180)', 'L', 'wf', 'T', 'h/2'),
      flat('WL', 'פלטת ווב', R('main', 'w+'), 'if(rh > 0, 0, 180)', 'L', 'hw', 'T', 'tw/2'),
      flat('WR', 'פלטת ווב', R('main', 'w-'), 'if(rh > 0, 180, 0)', 'L', 'hw', 'T', 'tw/2'),
      ...weld2('FT', 'L'), ...weld2('FB', 'L'), ...weld2('WL', 'L'), ...weld2('WR', 'L'),
    ],
  };
}

/** חיבור המשך מרותך לצינור (RHS/SHS) — פלטת הארכה בכל צד (L אורך, wp רוחב, T עובי). פרמטרים: b, wp, L, T, a. */
export function beamSpliceWeldedBoxRecipe(): CustomDetail {
  return {
    id: BEAM_SPLICE_WELDED_BOX_RECIPE_ID, name: 'חיבור המשך צינור: פלטות הארכה מרותכות (הסבה)', family: 'splice', category: 'splice',
    note: 'שקול לחיבור ההמשך המרותך לצינור: פלטת הארכה בכל צד, מרותכת לשני החלקים במסגריה.',
    vars: [{ name: 'b', expr: 'pb' }, { name: 'wp', expr: '100', note: 'רוחב פלטה' }, { name: 'L', expr: '600', note: 'אורך' }, { name: 'T', expr: '10', note: 'עובי' }, { name: 'a', expr: '6', note: 'גודל ריתוך' }, { name: 'wdSL', expr: 'wp' }, { name: 'wdSR', expr: 'wp' }],
    ops: [
      flat('SL', 'פלטת הארכה צד', R('main', 'w+'), 'if(rh > 0, 0, 180)', 'L', 'wp', 'T', 'b/2'),
      flat('SR', 'פלטת הארכה צד', R('main', 'w-'), 'if(rh > 0, 180, 0)', 'L', 'wp', 'T', 'b/2'),
      ...weld2('SL', 'L'), ...weld2('SR', 'L'),
    ],
  };
}
