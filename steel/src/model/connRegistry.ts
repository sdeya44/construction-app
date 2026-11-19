import type { Connection, CustomDetail, DerivedModel, Member, Project } from './types';
import { findSite, similarSites } from '../geometry/detail';
import { assignDetail } from '../commands/commands';
import { tryProfile } from '../profiles/library';
import { defaultKneeBraces, kneeDetail } from '../geometry/knee';
import { defaultRafterStruts } from '../geometry/rafterStruts';
import { defaultRodEnd } from '../geometry/bracing';
import { defaultPortal } from '../geometry/portal';
import { SEAT_HE, SUPPORT_HE } from '../geometry/transfer';
import { defaultLockTruss } from '../geometry/lockTruss';

/**
 * רישום סוגי פרט (1.42): לכל משפחת חיבור — זיהוי מצב מהמודל, סוגי פרט עם התאמה ("מתאים / עם הערה / לא מתאים" + סיבה),
 * סכמת פרמטרים, קריאה והחלה בהיקף (חיבור זה / כל החיבורים באותו מצב). הספרייה: הגדרות שמורות בפרויקט הפתוח.
 */
export type ConnFamily = 'knee' | 'strut' | 'base' | 'eave' | 'ridge' | 'side' | 'roofx' | 'wallx' | 'portal' | 'cleat' | 'psplice' | 'bsplice' | 'tbsup' | 'tbseat' | 'lock';
export type Fit = { status: 'ok' | 'warn' | 'no'; reason: string };
export interface ParamDef { key: string; label: string; unit?: string; options?: { v: string | number; t: string }[]; min?: number }
export type Params = Record<string, string | number>;
export interface Situation {
  family: ConnFamily; connId: string; title: string;
  facts: { k: string; v: string }[];
  /** מפתח המצב — חיבורים עם אותו מפתח נערכים יחד */
  key: string; sameCount: number;
  memberFamily?: string; hostFamily?: string;
  /** מפתח מיקום לחריג (מפתח-צד באלכסונים, שורה בתמוכות, מזהה חיבור בבסיס) */
  local: string;
  /** שם ההיקף המקומי בממשק; null = אין חריג מקומי לסוג הזה (רק כולם) */
  oneLabel?: string | null;
  /** צד הפטות (לתושבות) */
  side?: string;
  /** אתר הפרט המותאם (קצה האלמנט בחיבור) — לפרטי סטודיו: מפתח, זווית, משפחות, אתרים דומים */
  site?: { key: string; ang: number; mainFam: string; hostFam: string; similar: string[] };
}
export interface DetailType {
  id: string; family: ConnFamily; title: string; desc: string; pic: string;
  fit: (s: Situation) => Fit;
  params: ParamDef[];
}
export interface ConnPreset { id: string; family: ConnFamily; detail: string; name: string; params: Params }

const HOLLOW = ['RHS', 'SHS', 'CHS'];
const fam = (name?: string) => (name ? tryProfile(name)?.family ?? '' : '');

const SUP_DESC: Record<string, string> = { A1: 'הקורה על ראש העמוד; העמוד מתקצר', A2: 'פלטת קצה מרותכת לקורה, מוברגת לפלטת סגירה בין אגפי העמוד', A3: 'פלטה מרותכת לווב העמוד; ווב הקורה מוברג', A4: '2 זוויתנים מוברגים לעמוד ולווב הקורה', A5: 'תושבת מוקשחת; הקורה מונחת ומוברגת' };
const SEAT_DESC: Record<string, string> = { B1: 'כיסא משופע + פלטה על הקורה + 4 ברגים', B2: 'טריז מרותך לקורת הגג, ברגים דרך אגף הקורה הנושאת', B3: 'עמוד קצר עם ראש משופע — לפער גובה', B4: 'קורת הגג ממוסגרת לווב הקורה הנושאת' };
const BOLTS = (ds: number[]) => ds.map((d) => ({ v: d, t: `M${d}` }));
const PLATE_P: ParamDef[] = [{ key: 't', label: 'עובי פלטה', unit: 'מ"מ', min: 6 }, { key: 'boltD', label: 'קוטר בורג', options: BOLTS([16, 20, 24, 27]) }];
const BRACE_P: ParamDef[] = [{ key: 'gussetT', label: 'עובי פח', unit: 'מ"מ', min: 5 }, { key: 'boltsPerEnd', label: 'ברגים בקצה', options: [1, 2, 3].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltD', label: 'קוטר בורג', options: BOLTS([12, 16, 20]) }];
const PORTAL_P: ParamDef[] = [{ key: 'plateT', label: 'עובי פח ולשונית', unit: 'מ"מ', min: 6 }, { key: 'beamBolts', label: 'ברגים בקורה', options: [2, 4, 6].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltsPerEnd', label: 'ברגים באלכסון', options: [2, 4, 6].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltD', label: 'קוטר בורג', options: BOLTS([12, 16, 20]) }];
const CLEAT_P: ParamDef[] = [{ key: 'thickness', label: 'עובי', unit: 'מ"מ', min: 4 }, { key: 'width', label: 'רוחב לאורך הפטה', unit: 'מ"מ', min: 40 }, { key: 'boltD', label: 'קוטר בורג', options: BOLTS([10, 12, 16]) }];

export const DETAIL_TYPES: DetailType[] = [
  { id: 'knee.angle', family: 'knee', title: 'זוויתן מוברג לפח', desc: 'פח מרותך למארח (מסגריה), הזוויתן מוברג ישירות לפח בשטח', pic: 'angle',
    fit: (s) => (s.memberFamily === 'L' ? { status: 'ok', reason: 'זוויתן — מוברג ישירות לפח' } : { status: 'no', reason: 'דורש זוויתן (L) — האלמנט ' + (s.memberFamily || '?') }),
    params: [{ key: 'plateT', label: 'עובי פח', unit: 'מ"מ', min: 6 }, { key: 'boltsPerEnd', label: 'ברגים בקצה', options: [{ v: 2, t: '1' }, { v: 4, t: '2' }, { v: 6, t: '3' }] }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'knee.fin', family: 'knee', title: 'פח + לשונית בחריץ', desc: 'פח מרותך למארח, לשונית מרותכת בחריץ הפרופיל; מוברגים בחפיפה בשטח', pic: 'fin',
    fit: (s) => (HOLLOW.includes(s.memberFamily ?? '') ? { status: 'ok', reason: 'פרופיל חלול — לשונית בחריץ' } : { status: 'no', reason: 'דורש פרופיל חלול (RHS/SHS/CHS)' }),
    params: [{ key: 'plateT', label: 'עובי פח ולשונית', unit: 'מ"מ', min: 6 }, { key: 'boltsPerEnd', label: 'ברגים בקצה', options: [2, 4, 6].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'knee.flange', family: 'knee', title: 'פלטת קצה לאגף', desc: 'פלטת קצה מרותכת לאלכסון, 4 ברגים לאגף העמוד ולאגף התחתון של הקורה', pic: 'flange',
    fit: (s) => (HOLLOW.includes(s.hostFamily ?? '') ? { status: 'warn', reason: 'עמוד חלול — אין גישה לאום מבפנים; נדרשים ברגים חד-צדדיים' } : { status: 'ok', reason: 'מארח פתוח — גישה לאום' }),
    params: [{ key: 'plateT', label: 'עובי פלטה', unit: 'מ"מ', min: 6 }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'strut.endplate', family: 'strut', title: 'פלטת קצה מוברגת', desc: 'פלטה מרותכת לתמוכה, מוברגת לווב הקורה; משני צדי קורה — אותם ברגים', pic: 'endplate',
    fit: () => ({ status: 'ok', reason: 'מתאים לכל חתך' }),
    params: [{ key: 'plateT', label: 'עובי פלטה', unit: 'מ"מ', min: 6 }, { key: 'bolts', label: 'ברגים בקצה', options: [2, 4].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'strut.fin', family: 'strut', title: 'פח + לשונית', desc: 'פח מרותך לווב, לשונית בחריץ ה-RHS, מוברגים בחפיפה', pic: 'fin',
    fit: (s) => (HOLLOW.includes(s.memberFamily ?? '') ? { status: 'ok', reason: 'פרופיל חלול' } : { status: 'no', reason: 'דורש פרופיל חלול' }),
    params: [{ key: 'plateT', label: 'עובי פח ולשונית', unit: 'מ"מ', min: 6 }, { key: 'bolts', label: 'ברגים בקצה', options: [2, 4].map((n) => ({ v: n, t: String(n) })) }, { key: 'boltD', label: 'קוטר בורג', options: [12, 16, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'strut.weld', family: 'strut', title: 'ריתוך ישיר', desc: 'ריתוך היקפי לווב בשטח — ללא פחים וברגים', pic: 'weld',
    fit: () => ({ status: 'warn', reason: 'ריתוך בשטח — נדרש תיקון גלוון' }), params: [] },
  { id: 'base.embedded', family: 'base', title: 'פלטה מבוטנת', desc: 'פלטה עם מוטות עיגון מבוטנת; העמוד מרותך בשטח', pic: 'baseEmbedded',
    fit: () => ({ status: 'warn', reason: 'ריתוך בשטח — נדרש תיקון גלוון' }), params: [{ key: 't', label: 'עובי פלטה', unit: 'מ"מ', min: 8 }, { key: 'anchorLength', label: 'אורך עיגון', unit: 'מ"מ' }] },
  { id: 'base.bolted', family: 'base', title: 'ברגי עיגון', desc: 'פלטה מרותכת לעמוד במסגריה, ברגי עיגון בשטח', pic: 'baseBolted',
    fit: () => ({ status: 'ok', reason: 'הכל בברגים בשטח' }), params: [{ key: 't', label: 'עובי פלטה', unit: 'מ"מ', min: 8 }, { key: 'anchorLength', label: 'אורך עיגון', unit: 'מ"מ' }] },
  { id: 'base.pile', family: 'base', title: 'טמון בכלונס', desc: 'העמוד טמון בכלונס — ללא פלטה ועיגון', pic: 'basePile',
    fit: () => ({ status: 'ok', reason: 'כלונס / ביסוס עם שרוול' }), params: [{ key: 'pileEmbed', label: 'עומק הטמנה', unit: 'מ"מ', min: 0 }] },
  // ---- עמוד-קורה, רכס, קורה לצד עמוד (פלטות; חריג לחיבור בודד)
  { id: 'eave.split', family: 'eave', title: 'שתי פלטות מוברגות', desc: 'פלטה על העמוד + פלטה על הקורה (מסגריה), מוברגות ביניהן בשטח', pic: 'eaveSplit',
    fit: () => ({ status: 'ok', reason: 'פרט סטנדרטי — הכל בברגים בשטח' }), params: PLATE_P },
  { id: 'eave.single', family: 'eave', title: 'פלטה אחת, ברגים דרך האגף', desc: 'פלטה על העמוד; הברגים עוברים דרך האגף התחתון של הקורה', pic: 'eaveSingle',
    fit: (s) => (HOLLOW.includes(s.hostFamily ?? '') ? { status: 'warn', reason: 'עמוד חלול — לוודא גישה לאום מתחת לפלטה' } : { status: 'ok', reason: 'פחות חלקים — פלטה אחת' }), params: PLATE_P },
  { id: 'ridge.endplate', family: 'ridge', title: 'פלטות קצה ברכס', desc: 'פלטת קצה בכל קורה, מוברגות זו לזו ברכס', pic: 'ridge', fit: () => ({ status: 'ok', reason: 'פרט סטנדרטי' }), params: PLATE_P },
  { id: 'side.endplate', family: 'side', title: 'פלטת קצה לצד העמוד', desc: 'פלטה מרותכת לקורה, מוברגת לאגף העמוד שממשיך מעל הגג', pic: 'flange', fit: () => ({ status: 'ok', reason: 'מישור גג שמסתיים בצד עמוד' }), params: PLATE_P },
  // ---- קושרות X (הגדרה כללית אחת)
  { id: 'roofx.gusset', family: 'roofx', title: 'פח חיבור מרותך לווב', desc: 'פח מרותך לווב הקורה (מסגריה), הזוויתן מוברג בשטח; בורג בהצטלבות', pic: 'angle', fit: () => ({ status: 'ok', reason: 'מתאים לכל חתך' }), params: BRACE_P },
  { id: 'roofx.rod', family: 'roofx', title: 'מוט הברגה דרך הווב', desc: 'מוט הברגה מרותך לזוויתן, עובר בחור אובלי בווב הקורה, אום וזוויתן דסקית', pic: 'rod',
    fit: (s) => (s.memberFamily === 'L' ? { status: 'ok', reason: 'זוויתן — פרט מוט הברגה' } : { status: 'no', reason: 'דורש זוויתן (L)' }), params: [{ key: 'rodD', label: 'קוטר מוט', options: [12, 16, 18, 20].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'wallx.gusset', family: 'wallx', title: 'פח חיבור מרותך לעמוד', desc: 'פח מרותך לעמוד (מסגריה), הזוויתן מוברג בשטח; בורג בהצטלבות', pic: 'angle', fit: () => ({ status: 'ok', reason: 'מתאים לכל חתך' }), params: BRACE_P },
  // ---- אגד B (חריג לציר)
  { id: 'portal.finH', family: 'portal', title: 'פח + לשונית — שוכב', desc: 'חיבור קורת האגד לעמוד: הפח והלשונית שוכבים, הקורה מונחת על הפח (נוח בהרכבה)', pic: 'finH', fit: () => ({ status: 'ok', reason: 'הקורה על ציר העמודים' }), params: PORTAL_P },
  { id: 'portal.finV', family: 'portal', title: 'פח + לשונית — במישור הקיר', desc: 'הפח והלשונית עומדים במישור הקיר; הקורה מוסטת בעובי פח', pic: 'fin', fit: () => ({ status: 'ok', reason: 'פרט חלופי' }), params: PORTAL_P },
  // ---- תושבות פטה (חריג לתושבת בודדת)
  { id: 'cleat.run', family: 'cleat', title: 'זוויתן שוכב', desc: 'זוויתן לאורך הפטה מרותך לקורה, מוברג לווב הפטה', pic: 'cleatRun', fit: () => ({ status: 'ok', reason: 'פרט סטנדרטי' }), params: CLEAT_P },
  { id: 'cleat.stand', family: 'cleat', title: 'זוויתן עומד', desc: 'זוויתן L40 עומד עם חורים אנכיים', pic: 'cleatStand', fit: (s) => (s.memberFamily === 'C' || s.memberFamily === 'Z' ? { status: 'ok', reason: 'פטת C/Z' } : { status: 'warn', reason: 'לבדוק מול חתך הפטה' }), params: CLEAT_P },
  { id: 'cleat.plate', family: 'cleat', title: 'פלטה + משולש', desc: 'פלטה עם משולש תמיכה — לפטות גבוהות', pic: 'cleatPlate', fit: () => ({ status: 'ok', reason: 'קשיח יותר' }), params: CLEAT_P },
  // ---- חיבורי המשך
  { id: 'psplice.plate', family: 'psplice', title: 'פלטת המשך בווב', desc: 'פלטה בצד הפנימי של הווב, 2 ברגים בכל פטה', pic: 'splicePlate', fit: () => ({ status: 'ok', reason: 'פרט סטנדרטי' }), params: [{ key: 'plateT', label: 'עובי פלטה', unit: 'מ"מ', min: 3 }, { key: 'boltD', label: 'קוטר בורג', options: [10, 12, 16].map((d) => ({ v: d, t: `M${d}` })) }] },
  { id: 'bsplice.bolted', family: 'bsplice', title: 'מוברג בשטח — פלטות קצה', desc: 'פלטות קצה בשני החלקים, מוברגות בשטח', pic: 'flange', fit: () => ({ status: 'ok', reason: 'מתאים להובלה בחלקים' }), params: [] },
  { id: 'bsplice.welded', family: 'bsplice', title: 'מרותך במסגריה — פלטות כיסוי', desc: 'החלקים מרותכים במסגריה; האלמנט יוצא כחלק אחד', pic: 'weld', fit: () => ({ status: 'warn', reason: 'אלמנט ארוך בהובלה' }), params: [] },
  // ---- קורה נושאת (דילול): חריג = הקורה הזו
  ...(['A1', 'A2', 'A3', 'A4', 'A5'] as const).map((k): DetailType => ({ id: `tbsup.${k}`, family: 'tbsup', title: `${k} · ${SUPPORT_HE[k]}`, desc: SUP_DESC[k], pic: k === 'A1' ? 'eaveSingle' : k === 'A3' ? 'fin' : k === 'A4' ? 'angle' : 'flange',
    fit: (s) => (s.memberFamily === 'truss' && k !== 'A1' ? { status: 'no', reason: 'מסבך נושא — על ראש העמוד (A1) בלבד' } : k === 'A3' ? { status: 'warn', reason: 'הכי זול — למפתחים קטנים' } : { status: 'ok', reason: k === 'A1' ? 'פשוט וחזק — מומלץ' : 'הקורה בין העמודים' }), params: [] })),
  ...(['B1', 'B2', 'B3', 'B4'] as const).map((k): DetailType => ({ id: `tbseat.${k}`, family: 'tbseat', title: `${k} · ${SEAT_HE[k]}`, desc: SEAT_DESC[k], pic: k === 'B4' ? 'fin' : 'eaveSplit',
    fit: (s) => (k === 'B4' && s.memberFamily === 'truss' ? { status: 'no', reason: 'לא אפשרי במסבך נושא' } : k === 'B4' && s.hostFamily !== 'A1' ? { status: 'no', reason: 'רק עם תמיכה A1' } : k === 'B3' ? { status: 'warn', reason: 'לקצה קורה בלבד' } : { status: 'ok', reason: k === 'B1' ? 'פרט סטנדרטי' : 'גובה מינימלי' }), params: [] })),
  // ---- נעילה אופקית: חריג = הציר הזה
  { id: 'lock.plate', family: 'lock', title: 'פלטה + פלטת קצה, 4 ברגים', desc: 'פלטה מרותכת לעמוד ופלטת קצה בסיב, 4 ברגים ארוכים דרך העמוד', pic: 'flange', fit: () => ({ status: 'ok', reason: 'מחבר את שני המפתחים דרך העמוד' }), params: [{ key: 'plateT', label: 'עובי פלטה', unit: 'מ"מ', min: 6 }, { key: 'boltD', label: 'קוטר בורג', options: BOLTS([16, 20, 24]) }] },
  { id: 'lock.tongue', family: 'lock', title: 'פח + לשונית', desc: 'כמו פרט האלכסון: פח מרותך לעמוד, לשונית בחריץ הסיב', pic: 'fin', fit: () => ({ status: 'ok', reason: 'פרט הלקוח' }), params: [{ key: 'plateT', label: 'עובי פח ולשונית', unit: 'מ"מ', min: 6 }, { key: 'boltD', label: 'קוטר בורג', options: BOLTS([16, 20]) }] },
];
export const detailById = (id: string) => DETAIL_TYPES.find((t) => t.id === id);

/** משפחת חיבור לפי מזהה וסוג */
export function familyOf(c: Pick<Connection, 'id' | 'type'>): ConnFamily | null {
  if (c.id.startsWith('C.KB.')) return 'knee';
  if (/^C\.RS\d+\./.test(c.id)) return 'strut';
  if (c.id.startsWith('C.BR.R')) return 'roofx';
  if (c.id.startsWith('C.BR.W')) return 'wallx';
  if (c.id.startsWith('C.BB.')) return 'portal';
  if (c.id.startsWith('C.LT.')) return 'lock';
  const byType: Partial<Record<Connection['type'], ConnFamily>> = { 'tb-support': 'tbsup', 'tb-seat': 'tbseat', base: 'base', eave: 'eave', ridge: 'ridge', 'rafter-side': 'side', 'purlin-cleat': 'cleat', 'purlin-splice': 'psplice', 'beam-splice': 'bsplice' };
  return byType[c.type] ?? null;
}

/** זיהוי המצב של חיבור מהמודל */
function situationBase(p: Project, d: DerivedModel, connId: string): Situation | null {
  const c = d.connById.get(connId);
  if (!c) return null;
  const f = familyOf(c);
  if (!f) return null;
  const lab = (lid: string) => d.section?.lines.find((l) => l.id === lid)?.label ?? lid;
  if (f === 'knee') {
    const br = d.byId.get(c.parts[0]); const col = d.byId.get(c.members[0]), raf = d.byId.get(c.members[1]);
    const key = c.id.split('.').slice(3).join('.');
    const v = br ? { x: br.end.x - br.start.x, z: br.end.z - br.start.z } : { x: 1, z: 1 };
    const ang = Math.round((Math.atan2(Math.abs(v.z), Math.abs(v.x)) * 180) / Math.PI);
    const mf = fam(br?.profile), hf = fam(col?.profile);
    const same = d.connections.filter((x) => x.id.startsWith('C.KB.') && fam(d.byId.get(x.parts[0])?.profile) === mf).length;
    return { family: f, connId, local: key, title: `אלכסון עמוד-קורה · ציר ${lab(key.split('.')[0])}`, memberFamily: mf, hostFamily: hf, key: `knee|${mf}|${hf}`, sameCount: same,
      facts: [{ k: 'מארח 1', v: `עמוד ${col?.profile ?? '?'}${HOLLOW.includes(hf) ? ' · דופן חלול' : ''}` }, { k: 'מארח 2', v: `קורה ${raf?.profile ?? '?'} · אגף תחתון` }, { k: 'אלמנט', v: `${br?.profile ?? '?'} (משפחה ${mf || '?'})` }, { k: 'זווית', v: `${ang}° מהאופק` }, { k: 'מישור', v: 'במישור המסגרת' }] };
  }
  if (f === 'strut') {
    const m = /^C\.RS(\d+)\./.exec(c.id)!; const row = (p.building.bracing.rafterStruts?.rows ?? [])[Number(m[1]) - 1];
    const st = d.byId.get(c.members[1] ?? ''), raf = d.byId.get(c.members[0]);
    const mf = fam(st?.profile);
    return { family: f, connId, local: row?.id ?? '', title: 'תמוכה בין קורות', memberFamily: mf, hostFamily: fam(raf?.profile), key: `strut|${mf}`, sameCount: d.connections.filter((x) => /^C\.RS\d+\./.test(x.id)).length,
      facts: [{ k: 'מארח', v: `ווב קורה ${raf?.profile ?? '?'}` }, { k: 'אלמנט', v: `${st?.profile ?? '?'}` }, { k: 'זווית', v: '90° לווב' }, { k: 'מישור', v: 'אופקי, לאורך המבנה' }] };
  }
  const sameT = d.connections.filter((x) => x.type === c.type).length;
  const mA = d.byId.get(c.members[0]), mB = d.byId.get(c.members[1] ?? '');
  if (f === 'eave' || f === 'ridge' || f === 'side') {
    const T = { eave: 'עמוד-קורה (ראש עמוד)', ridge: 'רכס', side: 'קורה לצד עמוד' }[f];
    return { family: f, connId, local: connId, oneLabel: 'החיבור הזה', title: T, key: f, sameCount: sameT, hostFamily: fam(mA?.profile), memberFamily: fam(mB?.profile ?? mA?.profile),
      facts: [{ k: 'מארח', v: `${mA?.profile ?? '?'}` }, { k: 'אלמנט', v: `${mB?.profile ?? mA?.profile ?? '?'}` }, { k: 'מיקום', v: c.label }] };
  }
  if (f === 'roofx' || f === 'wallx') {
    const br = c.parts.map((x) => d.byId.get(x)).find((x) => x?.kind === 'brace') ?? c.members.map((x) => d.byId.get(x)).find((x) => x?.kind === 'brace');
    const pre = f === 'roofx' ? 'C.BR.R' : 'C.BR.W';
    return { family: f, connId, local: connId, oneLabel: null, title: f === 'roofx' ? 'קושרת גג X' : 'קושרת קיר X', key: f, sameCount: d.connections.filter((x) => x.id.startsWith(pre)).length, memberFamily: fam(br?.profile),
      facts: [{ k: 'אלמנט', v: `${br?.profile ?? '?'} (משפחה ${fam(br?.profile) || '?'})` }, { k: 'מארח', v: f === 'roofx' ? 'ווב קורת הגג' : 'עמוד' }, { k: 'סוג', v: CONN_HE[c.type] ?? c.type }] };
  }
  if (f === 'portal') {
    const line = /^C\.BB\.\d+\.([^.]+)/.exec(c.id)?.[1] ?? '';
    return { family: f, connId, local: line, oneLabel: `ציר ${lab(line)} בלבד`, title: `אגד B · ציר ${lab(line)}`, key: 'portal', sameCount: d.connections.filter((x) => x.id.startsWith('C.BB.')).length, memberFamily: fam(mB?.profile),
      facts: [{ k: 'מארח', v: `עמוד ${mA?.profile ?? '?'}` }, { k: 'אלמנט', v: `${mB?.profile ?? '?'}` }, { k: 'ציר', v: lab(line) }] };
  }
  if (f === 'cleat') {
    const pur = d.byId.get(c.members[0]);
    const side = pur?.purlin?.paramKey ?? (pur?.purlin?.side === 'R' ? 'right' : 'left');
    return { family: f, connId, local: c.parts[0], side, oneLabel: 'התושבת הזו', title: 'תושבת פטה', key: `cleat|${side}`, sameCount: d.connections.filter((x) => x.type === 'purlin-cleat').length, memberFamily: fam(pur?.profile),
      facts: [{ k: 'פטה', v: `${pur?.profile ?? '?'}` }, { k: 'קורה', v: `${mB?.profile ?? '?'}` }, { k: 'שיפוע', v: pur?.purlin?.side ?? '' }] };
  }
  if (f === 'tbsup' || f === 'tbseat') {
    const tbId = c.members.find((x) => x.startsWith('TB.')) ?? '';
    const def = (p.building.transfers ?? []).find((t) => t.id === tbId.split('.')[1]);
    return { family: f, connId, local: def?.id ?? '', oneLabel: 'הקורה הנושאת הזו', title: f === 'tbsup' ? 'קורה נושאת ↔ עמוד' : 'קורת גג על קורה נושאת', key: f, sameCount: sameT,
      memberFamily: def?.kind === 'truss' ? 'truss' : 'beam', hostFamily: def?.support,
      facts: [{ k: 'קורה נושאת', v: def ? `${def.kind === 'truss' ? 'מסבך' : def.profile} · ציר ${lab(def.lineId)}` : '?' }, { k: 'תמיכה נוכחית', v: def ? `${def.support} · ${SUPPORT_HE[def.support]}` : '' }, { k: 'מושב נוכחי', v: def ? `${def.seat} · ${SEAT_HE[def.seat]}` : '' }] };
  }
  if (f === 'lock') {
    const colId = c.members.find((x) => x.includes('.COL.')) ?? '';
    const line = /\.COL\.([^.]+)$/.exec(colId)?.[1] ?? '';
    return { family: f, connId, local: line, oneLabel: `ציר ${lab(line)} בלבד`, title: `נעילה אופקית · ציר ${lab(line)}`, key: 'lock', sameCount: d.connections.filter((x) => x.id.startsWith('C.LT.')).length, memberFamily: fam(mB?.profile),
      facts: [{ k: 'עמוד', v: d.byId.get(colId)?.profile ?? '?' }, { k: 'ציר', v: lab(line) }, { k: 'מיקום', v: c.label }] };
  }
  if (f === 'psplice' || f === 'bsplice') {
    return { family: f, connId, local: connId, oneLabel: null, title: f === 'psplice' ? 'חיבור המשך פטה' : 'חיבור המשך קורה / עמוד', key: f, sameCount: sameT, memberFamily: fam(mA?.profile),
      facts: [{ k: 'אלמנט', v: `${mA?.profile ?? '?'}` }, { k: 'מיקום', v: c.label }] };
  }
  const col = d.byId.get(c.members[0]);
  return { family: f, connId, local: connId, oneLabel: 'הבסיס הזה', title: 'בסיס עמוד', memberFamily: fam(col?.profile), key: 'base', sameCount: d.connections.filter((x) => x.type === 'base').length,
    facts: [{ k: 'אלמנט', v: `עמוד ${col?.profile ?? '?'}` }, { k: 'מארח', v: 'יסוד / כלונס' }] };
}

/** הפרט הנוכחי והפרמטרים (כלליים, או של המיקום אם יש חריג) */
export function readCurrent(p: Project, s: Situation): { detail: string; params: Params; local: boolean } {
  const b = p.building;
  const asg = s.site ? p.detailAssign?.[s.site.key] : undefined;
  if (asg && (p.customDetails ?? []).some((x) => x.id === asg)) return { detail: `custom:${asg}`, local: true, params: {} };
  if (s.family === 'knee') {
    const kb = b.kneeBraces ?? defaultKneeBraces();
    const ov = kb.sides?.[s.local];
    const det = kneeDetail(ov?.detail ?? kb.detail, s.memberFamily ?? '');
    return { detail: `knee.${det}`, local: !!ov?.detail, params: { plateT: kb.plateT, boltsPerEnd: kb.boltsPerEnd ?? 2, boltD: kb.bolt.d } };
  }
  if (s.family === 'strut') {
    const rs = b.bracing.rafterStruts ?? defaultRafterStruts();
    const row = rs.rows.find((r) => r.id === s.local);
    return { detail: `strut.${row?.detail ?? rs.detail ?? 'endplate'}`, local: !!row?.detail, params: { plateT: rs.plateT, bolts: rs.bolts ?? 2, boltD: rs.bolt.d } };
  }
  if (s.family === 'eave' || s.family === 'ridge' || s.family === 'side') {
    const dflt = (s.family === 'side' ? p.connectionDefaults.side : p.connectionDefaults[s.family]) ?? p.connectionDefaults.eave;
    const e = { ...dflt, ...(p.connectionOverrides[s.connId] ?? {}) };
    const ov = p.connectionOverrides[s.connId];
    return { detail: s.family === 'eave' ? (e.split === false ? 'eave.single' : 'eave.split') : `${s.family}.endplate`, local: !!ov && (ov.split !== undefined || ov.t !== undefined), params: { t: e.t, boltD: e.bolt.d } };
  }
  if (s.family === 'roofx' || s.family === 'wallx') {
    const bc = b.bracing.conn;
    return { detail: s.family === 'roofx' && b.bracing.roof.endDetail === 'rod' ? 'roofx.rod' : `${s.family}.gusset`, local: false, params: { gussetT: bc.gussetT, boltsPerEnd: bc.boltsPerEnd, boltD: bc.bolt.d, rodD: b.bracing.roof.rod?.d ?? 18 } };
  }
  if (s.family === 'portal') {
    const pt = { ...(b.bracing.walls.portal ?? defaultPortal()), ...(b.bracing.walls.linePortal?.[s.local] ?? {}) };
    return { detail: (pt.finOrient ?? 'horizontal') === 'horizontal' ? 'portal.finH' : 'portal.finV', local: !!b.bracing.walls.linePortal?.[s.local]?.finOrient, params: { plateT: pt.plateT, beamBolts: pt.beamBolts ?? 2, boltsPerEnd: pt.boltsPerEnd ?? 2, boltD: pt.bolt?.d ?? 16 } };
  }
  if (s.family === 'cleat') {
    const base0 = (b.purlins as unknown as Record<string, { cleat: import('./types').CleatParams }>)[s.side ?? 'left']?.cleat ?? b.purlins.left.cleat;
    const ov = p.cleatOverrides[s.local] ?? {};
    const cl = { ...base0, ...ov };
    return { detail: `cleat.${cl.style ?? 'run'}`, local: !!ov.style, params: { thickness: cl.thickness, width: cl.width, boltD: (ov.bolt?.d ?? base0.bolt.d) } };
  }
  if (s.family === 'tbsup' || s.family === 'tbseat') {
    const def = (b.transfers ?? []).find((t) => t.id === s.local);
    return { detail: s.family === 'tbsup' ? `tbsup.${def?.support ?? 'A1'}` : `tbseat.${def?.seat ?? 'B1'}`, local: false, params: {} };
  }
  if (s.family === 'lock') {
    const lt = { ...(b.bracing.walls.truss ?? defaultLockTruss()), ...(b.bracing.walls.lineTruss?.[s.local] ?? {}) };
    return { detail: `lock.${lt.conn}`, local: !!b.bracing.walls.lineTruss?.[s.local]?.conn, params: { plateT: lt.plateT, boltD: lt.bolt.d } };
  }
  if (s.family === 'psplice') return { detail: 'psplice.plate', local: false, params: { plateT: b.purlins.splice.plateT, boltD: b.purlins.splice.bolt.d } };
  if (s.family === 'bsplice') { const k = d0kind(s) ; return { detail: `bsplice.${p.settings.spliceJoint?.[k] ?? 'bolted'}`, local: false, params: {} }; }
  const base = { ...p.connectionDefaults.base, ...(p.connectionOverrides[s.connId] ?? {}) };
  return { detail: `base.${base.mode ?? 'embedded'}`, local: !!p.connectionOverrides[s.connId]?.mode, params: { t: base.t, anchorLength: base.anchorLength ?? 800, pileEmbed: base.pileEmbed ?? 600 } };
}

/** החלה: scope 'all' = כל החיבורים באותו מצב (ההגדרה הכללית; חריגים נשמרים), 'one' = המיקום הזה בלבד */
export function applyDetail(p: Project, s: Situation, detail: string, params: Params, scope: 'all' | 'one'): Project {
  // פרט סטודיו: שיוך לקצה הזה / לכל הקצוות הדומים; מעבר לפרט מובנה מבטל שיוך קיים באותם קצוות
  const keys = s.site ? (scope === 'one' ? [s.site.key] : s.site.similar) : [];
  if (detail.startsWith('custom:')) {
    const det = (p.customDetails ?? []).find((x) => x.id === detail.slice(7));
    return det && keys.length ? assignDetail(keys, det).run(p) : p;
  }
  if (keys.some((k) => p.detailAssign?.[k])) p = assignDetail(keys.filter((k) => p.detailAssign?.[k]), null).run(p);
  const n: Project = structuredClone(p);
  const kind = detail.split('.')[1];
  const num = (k: string, dflt: number) => (params[k] === undefined || params[k] === '' ? dflt : Number(params[k]));
  if (s.family === 'knee') {
    const kb = n.building.kneeBraces ?? { ...defaultKneeBraces(), enabled: true };
    const det = kind as 'fin' | 'angle' | 'flange';
    if (scope === 'one') kb.sides = { ...(kb.sides ?? {}), [s.local]: { ...(kb.sides?.[s.local] ?? {}), detail: det } };
    else kb.detail = det;
    kb.plateT = num('plateT', kb.plateT); kb.boltsPerEnd = num('boltsPerEnd', kb.boltsPerEnd ?? 2); kb.bolt = { ...kb.bolt, d: num('boltD', kb.bolt.d) };
    n.building.kneeBraces = kb;
  } else if (s.family === 'strut') {
    const rs = n.building.bracing.rafterStruts ?? defaultRafterStruts();
    const det = kind as 'endplate' | 'fin' | 'weld';
    if (scope === 'one') rs.rows = rs.rows.map((r) => (r.id === s.local ? { ...r, detail: det } : r));
    else rs.detail = det;
    rs.plateT = num('plateT', rs.plateT); rs.bolts = num('bolts', rs.bolts ?? 2); rs.bolt = { ...rs.bolt, d: num('boltD', rs.bolt.d) };
    n.building.bracing.rafterStruts = rs;
  } else if (s.family === 'eave' || s.family === 'ridge' || s.family === 'side') {
    const fam0 = s.family === 'side' ? 'side' : s.family;
    const dflt = (fam0 === 'side' ? n.connectionDefaults.side : n.connectionDefaults[fam0]) ?? n.connectionDefaults.eave;
    const patch: Record<string, unknown> = { t: num('t', dflt.t), bolt: { ...dflt.bolt, d: num('boltD', dflt.bolt.d) } };
    if (s.family === 'eave') patch.split = kind !== 'single';
    if (scope === 'one') n.connectionOverrides[s.connId] = { ...(n.connectionOverrides[s.connId] ?? {}), ...patch };
    else (n.connectionDefaults as unknown as Record<string, unknown>)[fam0] = { ...dflt, ...patch };
  } else if (s.family === 'roofx' || s.family === 'wallx') {
    const br = n.building.bracing;
    br.conn = { ...br.conn, gussetT: num('gussetT', br.conn.gussetT), boltsPerEnd: num('boltsPerEnd', br.conn.boltsPerEnd), bolt: { ...br.conn.bolt, d: num('boltD', br.conn.bolt.d) } };
    if (s.family === 'roofx') { br.roof.endDetail = kind === 'rod' ? 'rod' : 'gusset'; if (kind === 'rod') br.roof.rod = { ...(br.roof.rod ?? defaultRodEnd()), d: num('rodD', br.roof.rod?.d ?? 18) }; }
  } else if (s.family === 'portal') {
    const w = n.building.bracing.walls;
    const pb = w.portal ?? defaultPortal();
    const patch = { finOrient: (kind === 'finH' ? 'horizontal' : 'vertical') as 'horizontal' | 'vertical', plateT: num('plateT', pb.plateT), beamBolts: num('beamBolts', pb.beamBolts ?? 2), boltsPerEnd: num('boltsPerEnd', pb.boltsPerEnd ?? 2) };
    if (scope === 'one') w.linePortal = { ...(w.linePortal ?? {}), [s.local]: { ...(w.linePortal?.[s.local] ?? {}), ...patch } };
    else { const base0 = w.portal ?? defaultPortal(); w.portal = { ...base0, ...patch, bolt: { ...base0.bolt, d: num('boltD', base0.bolt.d) } }; }
  } else if (s.family === 'cleat') {
    const patch = { style: kind as 'run' | 'stand' | 'plate', thickness: num('thickness', 8), width: num('width', 100) };
    if (scope === 'one') {
      const cur = n.cleatOverrides[s.local] ?? {};
      n.cleatOverrides[s.local] = { ...cur, ...patch, bolt: { ...(cur.bolt ?? {}), d: num('boltD', 12) } as never };
    } else {
      const pu = n.building.purlins as unknown as Record<string, { cleat: import('./types').CleatParams }>;
      const key = pu[s.side ?? 'left'] ? (s.side ?? 'left') : 'left';
      pu[key].cleat = { ...pu[key].cleat, ...patch, bolt: { ...pu[key].cleat.bolt, d: num('boltD', pu[key].cleat.bolt.d) } };
    }
  } else if (s.family === 'tbsup' || s.family === 'tbseat') {
    const defs = n.building.transfers ?? [];
    const patch = s.family === 'tbsup' ? { support: kind as 'A1' } : { seat: kind as 'B1' };
    n.building.transfers = defs.map((t) => (scope === 'all' || t.id === s.local ? { ...t, ...patch } : t));
  } else if (s.family === 'lock') {
    const w = n.building.bracing.walls;
    const base0 = w.truss ?? defaultLockTruss();
    const patch = { conn: kind as 'plate' | 'tongue', connA: undefined, connB: undefined, plateT: num('plateT', base0.plateT) };
    if (scope === 'one') w.lineTruss = { ...(w.lineTruss ?? {}), [s.local]: { ...(w.lineTruss?.[s.local] ?? {}), ...patch } };
    else w.truss = { ...base0, ...patch, bolt: { ...base0.bolt, d: num('boltD', base0.bolt.d) } };
  } else if (s.family === 'psplice') {
    const sp = n.building.purlins.splice;
    n.building.purlins.splice = { ...sp, plateT: num('plateT', sp.plateT), bolt: { ...sp.bolt, d: num('boltD', sp.bolt.d) } };
  } else if (s.family === 'bsplice') {
    const k = d0kind(s);
    n.settings = { ...n.settings, spliceJoint: { ...(n.settings.spliceJoint ?? {}), [k]: kind as 'bolted' | 'welded' } };
  } else {
    const patch = { mode: kind as 'embedded' | 'bolted' | 'pile', t: num('t', n.connectionDefaults.base.t), anchorLength: num('anchorLength', n.connectionDefaults.base.anchorLength ?? 800), pileEmbed: num('pileEmbed', n.connectionDefaults.base.pileEmbed ?? 600) };
    if (scope === 'one') n.connectionOverrides[s.connId] = { ...(n.connectionOverrides[s.connId] ?? {}), ...patch };
    else n.connectionDefaults.base = { ...n.connectionDefaults.base, ...patch };
  }
  return n;
}

/** פרטים מוצעים: סוגי הפרט של המשפחה + הגדרות שמורות בספרייה, מדורגים (מתאים ← עם הערה ← לא מתאים) */
export function candidates(p: Project, s: Situation): { id: string; detail: string; title: string; desc: string; pic: string; fit: Fit; preset?: ConnPreset; isDefault?: boolean; studio?: boolean }[] {
  const lib = (p.connLibrary ?? []).filter((x) => x.family === s.family);
  type Cand = { id: string; detail: string; title: string; desc: string; pic: string; fit: Fit; preset?: ConnPreset; isDefault?: boolean; studio?: boolean };
  const out: Cand[] = [
    ...DETAIL_TYPES.filter((t) => t.family === s.family).map((t) => ({ id: t.id, detail: t.id, title: t.title, desc: t.desc, pic: t.pic, fit: t.fit(s) })),
    ...lib.map((x) => { const t = detailById(x.detail)!; return { id: x.id, detail: x.detail, title: x.name, desc: `הגדרה שמורה של "${t.title}"`, pic: t.pic, fit: t.fit(s), preset: x, isDefault: p.connDefaults?.[s.family] === x.id }; }),
    ...(s.site ? (p.customDetails ?? []).filter((x) => x.family !== 'cleat').map((x) => ({ id: `custom:${x.id}`, detail: `custom:${x.id}`, title: x.name, desc: x.note || 'פרט שנבנה בסטודיו', pic: 'flange', fit: studioFit(x, s), studio: true })) : []),
  ];
  const rank = { ok: 0, warn: 1, no: 2 } as const;
  return out.sort((a, c) => rank[a.fit.status] - rank[c.fit.status] || (c.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || (a.preset ? 1 : 0) - (c.preset ? 1 : 0));
}

/** חיבור המשך: קורה או עמוד (לפי משפחת האלמנט במצב) */
function d0kind(s: Situation): 'beams' | 'columns' { return /עמוד/.test(s.facts.map((f) => f.v).join(' ')) || /COL/.test(s.connId) ? 'columns' : 'beams'; }
const CONN_HE: Partial<Record<Connection['type'], string>> = { 'brace-end': 'פח חיבור קושרת', 'brace-cross': 'הצטלבות קושרות', brace: 'קושרות' };

/** זיהוי המצב + אתר הקצה לפרטי סטודיו */
export function situationOf(p: Project, d: DerivedModel, connId: string): Situation | null {
  const s = situationBase(p, d, connId);
  if (!s || s.family === 'cleat') return s;
  const c = d.connById.get(connId)!;
  // האלמנט המחובר: אלכסון ← קורה ← קורת גג ← עמוד; הקצה הקרוב למרכז החיבור
  const RANK: Record<string, number> = { brace: 0, beam: 1, rafter: 2, purlin: 3, column: 4 };
  const ms = [...c.parts, ...c.members].map((x) => d.byId.get(x)).filter((x): x is Member => !!x && x.kind in RANK).sort((a, b2) => RANK[a.kind] - RANK[b2.kind]);
  const m = ms[0];
  if (!m) return s;
  const pts = [...c.parts, ...c.bolts.map((b2) => b2.id)].map((x) => d.byId.get(x)).filter((x): x is Member => !!x && (x.kind === 'plate' || x.kind === 'bolt'));
  const P = pts.length ? { x: pts.reduce((a, q) => a + q.start.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.start.y, 0) / pts.length, z: pts.reduce((a, q) => a + q.start.z, 0) / pts.length } : m.end;
  const dd = (q: { x: number; y: number; z: number }) => Math.hypot(q.x - P.x, q.y - P.y, q.z - P.z);
  // קצה שכבר יש בו פרט סטודיו — מועדף (אחרי ההחלה הפלטות זזות ומרכז החיבור משתנה)
  const asg = (e: 'start' | 'end') => !!p.detailAssign?.[`${m.id}|${e}`];
  const end = asg('start') !== asg('end') ? (asg('start') ? 'start' : 'end') : dd(m.start) <= dd(m.end) ? 'start' : 'end';
  const site = findSite(d.members, m, end);
  if (!site) return s;
  return { ...s, site: { key: site.key, ang: site.ang, mainFam: fam(m.profile), hostFam: fam(site.host?.profile), similar: similarSites(d.members, site.key, true, d.connections) } };
}

/** התאמת פרט סטודיו למצב לפי תנאי ההתאמה שלו */
export function studioFit(det: CustomDetail, s: Situation): Fit {
  if (!s.site) return { status: 'no', reason: 'אין קצה אלמנט בחיבור הזה' };
  if (det.family === 'cleat') return { status: 'no', reason: 'פרט תושבת פטה' };
  const mt = det.match;
  if (!mt) return { status: 'warn', reason: 'אין לפרט תנאי התאמה — לבדוק התאמה (ניתן להגדיר בסטודיו)' };
  if (mt.member?.length && !mt.member.includes(s.site.mainFam)) return { status: 'no', reason: `לאלמנט ${mt.member.join('/')} — כאן ${s.site.mainFam || '?'}` };
  if (mt.host?.length && !mt.host.includes(s.site.hostFam)) return { status: 'no', reason: `למארח ${mt.host.join('/')} — כאן ${s.site.hostFam || '?'}` };
  const a = Math.round(s.site.ang);
  if ((mt.angMin !== undefined && a < mt.angMin) || (mt.angMax !== undefined && a > mt.angMax)) return { status: 'no', reason: `זווית ${a}° מחוץ לטווח ${mt.angMin ?? 0}°–${mt.angMax ?? 90}°` };
  return { status: 'ok', reason: `מתאים לתנאי הפרט (${a}°)` };
}
