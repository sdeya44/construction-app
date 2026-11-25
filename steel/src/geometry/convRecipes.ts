import type { CustomDetail, DetailRef } from '../model/types';

/**
 * מתכוני הסבה (שלב C): פרטים מובנים שנכתבו מחדש כמתכון, לצורך השוואה אוטומטית מול הקוד הישן.
 * אינם חלק מ-`detailPresets()` עד שההשוואה ירוקה — אין חשיפה למשתמש.
 */
const R = (on: string, face: string, along = '0', across = '0'): DetailRef => ({ on, face, along, across });

/**
 * אלכסון עמוד-קורה, פח + לשונית בחריץ — שקול ל-`finJoint` ב-`geometry/finJoint.ts` (פרט הלקוח 15.11.2026).
 * פח במישור הציר המקורי, חתוך לפי פני המארח; לשונית בחריץ ה-RHS מוסטת בעובי (פח+לשונית)/2 — והאלכסון עמה.
 */
export function kneeFinRecipe(): CustomDetail {
  return {
    id: 'conv-knee-fin', name: 'אלכסון: פח + לשונית בחריץ (הסבה)', family: 'any', category: 'brace',
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
      { k: 'plate', id: 'F1', name: 'פח חיבור', ref: R('main', 'axis', 's0 + finL/2'), mode: 'flat', spin: '-90', off: '-ft/2', shape: 'rect', w: 'finL', h: 'wt', t: 'ft', ch: '0', corners: [false, false, false, false], clipHost: true },
      { k: 'plate', id: 'T1', name: 'לשונית', ref: R('main', 'axis', 'sTip + tongueL/2'), mode: 'flat', spin: '-90', off: 'ft/2', shape: 'rect', w: 'tongueL', h: 'wt', t: 'tt', ch: '0', corners: [false, false, false, false] },
      { k: 'holes', id: 'H1', ref: R('main', 'axis-', 'sTip + edge + (rows-1)*pitch/2'), rows: 'rows', cols: 'across', px: 'gauge', py: 'pitch', d0: 'd0' },
      { k: 'bolts', id: 'B1', holes: 'H1', d: 'd', grade: '8.8', site: true },
      { k: 'weld', id: 'W1', part: 'F1', a: '5', site: false, to: 'host', len: '2*round(wt/max(sn, 0.25))' },
      { k: 'weld', id: 'W2', part: 'T1', a: '5', site: false, to: 'main', len: '4*ins' },
    ],
  };
}
