import type { CustomDetail, DetailRef } from '../model/types';

/**
 * מתכוני הצטלבות קושרות X (G9 — אתר עוגן `אלמנט|p:X`, `Connection.recipe.anchors`). קובץ נפרד, נרשם ב-`convRecipes.ts`.
 * מחליפים את חיבור ההצטלבות (`C.BR.<מפתח>.X`, סוג `brace-cross`) בדיוק; האלמנט הראשי הוא הזוויתן הראשון והשני נכנס לסריקת הברגים (`partner`).
 */
const R = (on: string, face: string, along = '0', across = '0'): DetailRef => ({ on, face, along, across });

export const BRACE_CROSS_GUSSET_RECIPE_ID = 'conv-brace-cross-gusset';
export const BRACE_CROSS_ROD_RECIPE_ID = 'conv-brace-cross-rod';

/** פח מילוי PL(tg)×(fw)×(fw) בין שני הזוויתנים + בורג אחד דרך שלושתם. פרמטרים: tg עובי פח, fw מידת הפח, d/cl בורג ומרווח חור, t עובי רגל הזוויתן. */
export function braceCrossGussetRecipe(): CustomDetail {
  return {
    id: BRACE_CROSS_GUSSET_RECIPE_ID, name: 'הצטלבות קושרות: פח מילוי + בורג (הסבה)', family: 'cross', category: 'brace',
    note: 'שקול להצטלבות קושרות X: פח מילוי בין שני הזוויתנים ובורג אחד דרך שלושתם.',
    vars: [
      { name: 'tg', expr: '10', note: 'עובי פח מילוי' }, { name: 'fw', expr: '60', note: 'מידת פח המילוי' }, { name: 'd', expr: '12', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'מרווח חור' },
      { name: 't', expr: '5', note: 'עובי רגל הזוויתן' }, { name: 'gt', expr: '2*t + tg', note: 'אורך אחיזה' },
    ],
    ops: [
      { k: 'plate', id: 'PL', name: 'פח מילוי', ref: R('main', 'a+'), mode: 'flat', spin: '0', off: '-tg/2', shape: 'rect', w: 'fw', h: 'fw', t: 'tg', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('main', 'a-'), rows: '1', cols: '1', px: '0', py: '0', d0: 'd + cl' },
      { k: 'bolts', id: 'B', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'gt' },
    ],
  };
}

/** קושרת מוט הברגה: בורג הצטלבות אחד (גב אל גב) דרך שני הזוויתנים, בלי פח. פרמטרים: d/cl, t עובי הזוויתן. */
export function braceCrossRodRecipe(): CustomDetail {
  return {
    id: BRACE_CROSS_ROD_RECIPE_ID, name: 'הצטלבות קושרות מוט הברגה: בורג (הסבה)', family: 'cross', category: 'brace',
    note: 'שקול להצטלבות קושרות מוט הברגה: בורג אחד גב אל גב דרך שני הזוויתנים.',
    vars: [{ name: 'd', expr: '12', note: 'קוטר בורג' }, { name: 'cl', expr: '2', note: 'מרווח חור' }, { name: 't', expr: '5', note: 'עובי רגל הזוויתן' }, { name: 'gt', expr: '2*t', note: 'אורך אחיזה' }],
    ops: [
      { k: 'holes', id: 'H1', ref: R('main', 'a-'), rows: '1', cols: '1', px: '0', py: '0', d0: 'd + cl' },
      { k: 'bolts', id: 'B', holes: 'H1', d: 'd', grade: '8.8', site: true, grip: 'gt' },
    ],
  };
}
