import type { Mm } from '../core/units';
import type { Plane, Vec3 } from '../core/vec';
import type { CustomSection } from './section';

/** גרסת סכמת קובץ הפרויקט. כל שינוי שובר מחייב מיגרציה ב-model/migrate.ts */
export const SCHEMA_VERSION = 8;

export type RoofType = 'gable' | 'mono';
/** לאן מתייחסים גובהי העמודים/הרכס: פני עליון של קורת הגג (TOS) או ציר הקורה. */
export type HeightRef = 'TOS' | 'AXIS';

export interface FrameDef {
  /** מזהה יציב של המסגרת (אינו תלוי במיקום או בסדר). */
  id: string;
  /** מיקום לאורך Y, mm */
  y: Mm;
}

/** פרמטרים של המבנה. מקור האמת היחיד לגיאומטריה הנגזרת. כל האורכים ב-mm. */
/** פרמטרי פריסת פטות לצד גג אחד. אורכים ב-mm. */
export interface PurlinSideParams {
  enabled: boolean;
  profile: string;
  /** מרחק הפטה הראשונה מנקודת ההתחלה (רכס בגג דו־שיפועי, קצה ההתחלה בחד־שיפועי) */
  first: Mm;
  /** מרחק ראשון מדויק: ללא תיקון אוטומטי למרחק המזערי מהרכס (חציית הרכס — אזהרה בלבד) */
  firstExact?: boolean;
  /** מרווח רגיל */
  spacing: Mm;
  /** מדידה לאורך השיפוע (ברירת מחדל) או בהיטל אופקי (מסומן במפורש) */
  measure: 'slope' | 'horizontal';
  /** מרחק הפטה האחרונה מהקצה החיצוני של קורת הגג/הקונזולה (0 = בקצה) */
  edgeOffset: Mm;
  /** fixed = מרווח קבוע, השארית במפתח האחרון; even = חלוקה שווה, spacing = מרווח מרבי */
  layout?: 'fixed' | 'even';
  /** כיוון פתיחת החתך (אגפים של C): לכיוון הרכס/הקצה העליון או לכיוון המרזב */
  opening: 'up' | 'down';
  cleat: CleatParams;
  /** מיקומים ידניים (לאורך השיפוע מנקודת ההתחלה). null = פריסה אוטומטית */
  manualPositions: Mm[] | null;
}

/** פרמטרי תומך זוויתן לפטה. אורכים ב-mm. */
export interface CleatParams {
  enabled: boolean;
  /** גובה הרגל הניצבת (לאורך נורמל הגג). null = שווה לגובה הפטה (אוטומטי) */
  height: Mm | null;
  /** אורך רגל הבסיס (על האגף העליון של הקורה) */
  base: Mm;
  thickness: Mm;
  /** רוחב הזוויתן לאורך ציר הפטה */
  width: Mm;
  bolt: BoltSpec;
  /** מספר שורות (לאורך נורמל הגג) ומספר ברגים בשורה (לאורך ציר הפטה) */
  rows: number;
  perRow: number;
  /** מרווח בין ברגים בשורה, ובין שורות */
  pitch: Mm;
  rowPitch: Mm;
  /** גובה השורה התחתונה מפני הקורה. null = אוטומטי (באמצע הרגל) */
  holeHeight: Mm | null;
  weldSize: Mm;
  /**
   * סוג התושבת: run — זוויתן שוכב לאורך הפטה (ברירת מחדל); stand — זוויתן עומד (L40×40) עם חורים אנכיים;
   * plate — פלטה אנכית צמודה לווב + משולש תמיכה מאחוריה.
   */
  style?: 'run' | 'stand' | 'plate';
  /** זוויתן עומד: חתך (ברירת מחדל L40x40x4) */
  standProfile?: string;
  /** תפר פטה מעל התומך: פלטה + משולש עם 4 חורים (2 לכל פטה) במקום פלטת המשך נפרדת */
  spliceCleat?: boolean;
}

export interface BoltSpec {
  d: Mm;
  grade: string;      // 8.8
  standard: string;   // ISO 4017
  /** תוספת קוטר חור (חור = d + clearance) */
  clearance: Mm;
}

export interface PurlinSystem {
  material: string;
  left: PurlinSideParams;
  /** בגג דו־שיפועי בלבד */
  right: PurlinSideParams;
  /** גג חד־שיפועי: מאיזה קצה מתחילה הפריסה */
  monoStart: 'low' | 'high';
  splice: PurlinSpliceParams;
  /** פרמטרי פטות למישורי גג בחתך מודולרי (לפי מזהה מישור); חסר = left */
  planes?: Record<string, PurlinSideParams>;
  /** אורך קטע פטה במספר מפתחים (תפר מעל כל N מסגרות). 0/חסר = אוטומטי לפי אורך חומר הגלם */
  pieceBays?: number;
}

/** מערכת קושרות ושורות קשירה לפטות. מפתחים (bays) לפי אינדקס: 0 = בין מסגרת 1 ל-2. */
export interface BracingParams {
  roof: {
    enabled: boolean; profile: string; bays: number[];
    /** x = אלכסוני זוויתן במתיחה (ברירת מחדל); rhs = סבכה אופקית: מוטות RHS ואלכסונים RHS */
    type?: 'x' | 'rhs';
    rhs?: RhsTrussParams;
    /** קטעים ללא קושרות (כיסוי חלקי של המפתח): מפתחות `${bay}|${segment}` כאשר segment = מזהה קטע השיפוע (למשל P12) */
    segOff?: string[];
    /** פרט קצה לקושרות X בגג: gusset = פח מרותך לווב + ברגים (ברירת מחדל); rod = מוט הברגה מרותך לזוויתן דרך חור אובלי בווב (תוכנית 110) */
    endDetail?: 'gusset' | 'rod';
    rod?: RodEndParams;
    /** מספר פנלי X לאורך השיפוע בקטע: מפתחות `${bay}|${segment}`; חסר = אוטומטי (לפי אורך חומר הגלם) */
    segCount?: Record<string, number>;
    /** חלוקת פנלי X לאורך השיפוע: equal = שווים (ברירת מחדל); purlins = גבולות הפנלים על הפטה הקרובה (צמתים בפטות, פנלים לא שווים) */
    split?: 'equal' | 'purlins';
    /** חלוקת מפתח בין מסגרות לאורך המבנה (לפי אינדקס מפתח): מספר תת־מפתחים עם תמוכת RHS בכל גבול; חסר = אוטומטי (מעל 9 מ') */
    ySplit?: Record<string, number>;
    /** חתך תמוכת הקושרות בגבול תת־מפתח (ברירת מחדל RHS100x100x5) */
    strut?: string;
    /** קושרות גם ברצועת הקונזולה: מהעמוד הקיצוני עד קצה הגג (קטע נוסף) */
    toEave?: boolean;
    /** מרווח בין שני קצוות קושרות שמגיעים לאותה נקודה באותו מפתח (שני חורים זה ליד זה), ברירת מחדל 200 */
    sameGap?: Mm;
    /** מוט הברגה: מרווח אנכי בין מוטות משני מפתחים סמוכים שמגיעים לאותה נקודה (חורים זה מעל זה), ברירת מחדל 40 */
    adjGap?: Mm;
    /** מרחק קצה הקושרת מפני עמוד שממשיך מעל הגג (גג מדורג), ברירת מחדל 150 */
    colClear?: Mm;
  };
  walls: {
    enabled: boolean; profile: string; left: number[]; right: number[];
    /** x = קושרות X (ברירת מחדל); portal = אגד B: קורת RHS בין העמודים + שני אלכסונים קטנים; truss = נעילה אופקית: מסבך RHS + סיב רציף (תוכנית 130) */
    type?: 'x' | 'portal' | 'truss';
    truss?: LockTrussParams;
    /** לכל ציר: סוג וחריגות פרמטרים (חלון המכלול — "לציר זה בלבד") */
    lineType?: Record<string, 'x' | 'portal' | 'truss'>;
    lineTruss?: Record<string, Partial<LockTrussParams>>;
    linePortal?: Record<string, Partial<PortalBraceParams>>;
    /** מפתחים לכל ציר עמודים (מזהה ציר → מפתחים). חסר = left לציר הראשון ו-right לאחרון */
    byLine?: Record<string, number[]>;
    portal?: PortalBraceParams;
  };
  /** שורת קשירה לאגף התחתון של הפטות, באמצע כל מפתח */
  purlinTies: { enabled: boolean; profile: string };
  /** תמוכות בין הקורות (1.40): RHS לאורך המבנה בין קורות גג סמוכות, מחובר לווב הקורות. מחלק את פנלי קושרות הגג */
  rafterStruts?: RafterStrutParams;
  /** מוטות תלייה בין הפטות (1.41): מוט הברגה דרך ווב הפטות, לאורך השיפוע, 1–3 שורות בכל מפתח */
  sagRods?: { enabled: boolean; d: number; perBay: number; bays?: number[] };
  /** תמיכה צידית לפטה (1.41): זוויתן מהפטה לאגף התחתון של קורת הגג, בשני הצדדים, בכל פטה n-ית */
  flyBraces?: { enabled: boolean; profile: string; every: number; boltD: number };
  /** סיב רציף בשורת עמודים (1.41): קורת RHS בין ראשי העמודים בכל המפתחים, מתחת לקורת הגג */
  lineTies?: { enabled: boolean; lines: string[]; profile: string; plateT: Mm; bolt: BoltSpec };
  /** חיבורי קושרות X: פח חיבור מרותך לקורה/עמוד במסגריה, הזוויתן מוברג בשטח; בורג בהצטלבות עם פח מילוי */
  conn: BraceConnParams;
}

/** שורת תמוכות בין הקורות: מיקום = מרחק אופקי מציר from לכיוון ציר toward; מפתחים חסר = כל המפתחים */
export type RafterStrutDetail = 'endplate' | 'fin' | 'weld';
export interface RafterStrutRow { id: string; from: string; toward: string; dist: Mm; bays?: number[]; profile?: string; detail?: RafterStrutDetail }
export interface RafterStrutParams {
  rows: RafterStrutRow[];
  profile: string;
  /** פלטת קצה מרותכת לתמוכה (מסגריה), מוברגת לווב הקורה (שטח); בשני צדי הווב — אותם ברגים */
  plateT: Mm; bolt: BoltSpec;
  /** endplate (ברירת מחדל): פלטת קצה מוברגת לווב · fin: פח מרותך לווב + לשונית בחריץ ה-RHS, מוברגים בחפיפה · weld: ריתוך ישיר לווב בשטח */
  detail?: RafterStrutDetail;
  /** ברגים בכל קצה (2 / 4) */
  bolts?: number;
  /** מנוע פרט ה-fin (שלב D): 'recipe' = המתכון `strutFinRecipe` מחליף את הקוד הישן (`finJoint`); חסר/'legacy' = הקוד הישן. אין חשיפה בממשק עד אישור המשתמש */
  finEngine?: 'legacy' | 'recipe';
  /** כמו `finEngine`, לפרט פלטת הקצה (`endplate`, אתר זוגי) */
  endEngine?: 'legacy' | 'recipe';
  /** כמו `finEngine`, לפרט הריתוך הישיר (`weld`) */
  weldEngine?: 'legacy' | 'recipe';
}

/**
 * פרט קצה "מוט הברגה" לקושרת X בגג (פרט הלקוח, תוכנית 110): זוויתן מקוצר, מוט הברגה מרותך לזוויתן בחפיפה,
 * עובר דרך חור אובלי בווב הקורה (בגלל זווית האלכסון); בצד השני זוויתן קצר עם חור (התאמת זווית) ואום.
 */
export interface RodEndParams {
  /** קוטר מוט ההברגה */
  d: Mm;
  /** אורך המוט */
  length: Mm;
  /** חפיפת ריתוך המוט לזוויתן */
  overlap: Mm;
  /** זוויתן הדסקית בצד השני של הווב, ואורכו */
  washer: string; washerL: Mm;
  /** תוספת לאורך החור האובלי (כוונון בשטח) */
  slotExtra: Mm;
  /** קוטר בורג ההצטלבות */
  crossD: Mm;
  weldSize: Mm;
}

/** אגד B — קשיחות לאורך במפתח קיר: קורה + שני אלכסונים לעמודים */
export interface PortalBraceParams {
  beam: string; brace: string;
  /** מרווח מתחתית הקורה הראשית לראש קורת האגד */
  gap: Mm;
  /** ירידת נקודת החיבור על העמוד מתחתית קורת האגד */
  drop: Mm;
  /** זווית האלכסון מהאופק */
  angle: number;
  plateT: Mm; bolt: BoltSpec; pitch: Mm; weldSize: Mm;
  /** ברגים בכל קצה אלכסון / קורת אגד (בשורה לאורך הציר) */
  boltsPerEnd?: number;
  beamBolts?: number;
  /** בשאר המפתחים של ציר עם אגד: קורה רציפה באותו חתך, ללא אלכסונים (העברת כוחות אופקיים) */
  continuous?: boolean;
  /** חיבור קורת האגד לעמוד: horizontal = פח ולשונית שוכבים (ברירת מחדל), vertical = במישור הקיר */
  finOrient?: 'horizontal' | 'vertical';
  /** אגד B הפוך: האלכסונים עולים מראש קורת האגד אל העמוד (drop = עלייה על העמוד מעל הקורה) */
  invert?: boolean;
}

/**
 * נעילה אופקית לאורך (תוכנית 130 "פרט נעילה אופקית"): סיב RHS רציף בכל המפתחים של הציר, ובמפתחים הנעולים —
 * מסבך: חגורה שנייה מעל/מתחת לסיב + אלכסוני RHS (וורן) מרותכים במסגריה. חיבור לעמוד: פלטה-פלטה עם 4 ברגים, או לשונית.
 */
export interface LockTrussParams {
  chord: string; diag: string;
  /** מרחק צירים בין הסיב לחגורה השנייה */
  height: Mm;
  /** המסבך מעל הסיב הרציף או מתחתיו */
  position: 'above' | 'below';
  /** plate = פלטה מרותכת לעמוד + פלטת קצה בסיב, 4 ברגים; tongue = פח + לשונית (כמו אלכסון עמוד-קורה) */
  conn: 'plate' | 'tongue';
  plateT: Mm; bolt: BoltSpec; weldSize: Mm;
  /** מרווח מתחתית הקורה הראשית לראש האלמנט העליון */
  gap: Mm;
  /** מספר אלכסונים במפתח; 0 = אוטומטי (זווית ≈ 50°) */
  diags: number;
  /** סיב בשאר המפתחים */
  continuous: boolean;
  /** סוג חיבור בכל צד (עמוד בתחילת המפתח / בסופו); חסר = conn */
  connA?: 'plate' | 'tongue';
  connB?: 'plate' | 'tongue';
  /** לשונית: horizontal = הפח והלשונית שוכבים (חריץ אופקי בסיב, ברירת מחדל); vertical = במישור המסבך */
  finOrient?: 'horizontal' | 'vertical';
  /** מרחק מפני העמוד לצומת הראשון של האלכסונים (0 = אוטומטי לפי הפרט) — הסיב והחגורה "בולטים" מעבר לאלכסונים */
  endClear?: Mm;
  /** מרווח בין שני אלכסונים בצומת (על פני החגורה) */
  nodeGap?: Mm;
}

export interface PlanShape {
  shape: 'rect' | 'skew' | 'taper';
  /** מקבילית: זווית ההסטה (מעלות) — כל מסגרת מוסטת ב-tan(זווית)×מרחק מהמסגרת הראשונה */
  skewDeg?: number;
  /** טרפז: איזה ציר קצה זז (first = הציר הראשון, last = האחרון), ובכמה הוא זז החוצה במסגרת האחרונה (שלילי = פנימה) */
  taperLine?: 'first' | 'last';
  taperEnd?: Mm;
}

export interface HaunchParams {
  enabled: boolean;
  /** אורך המכפל מפני העמוד (אופקי לאורך הקורה) */
  length: Mm;
  /** עומק המכפל בפני העמוד (מתחת לתחתית הקורה); 0 = עומק הקורה */
  depth: Mm;
  /** עובי פח הגוף (0 = עובי ווב הקורה) ועובי האגף (0 = עובי אגף הקורה) */
  webT: Mm; flangeT: Mm;
  weldSize: Mm;
}

/** סבכה אופקית בגג מ-RHS (במקום X) */
export interface RhsTrussParams {
  strut: string; diag: string;
  /** מספר פנלים לאורך השיפוע; 0 = אוטומטי (אלכסון ≈ 45°) */
  panels: number;
  tongueT: Mm; insert: Mm;
  bolt: BoltSpec; boltsPerEnd: number; pitch: Mm; endDist: Mm; edge: Mm;
  gussetT: Mm; clearance: Mm; weldSize: Mm;
}

export interface BraceConnParams {
  bolt: BoltSpec;
  /** ברגים בכל קצה, בשורה לאורך ציר הזוויתן */
  boltsPerEnd: number;
  pitch: Mm;
  /** מרחק קצה הזוויתן מהבורג הראשון */
  endDist: Mm;
  /** קו ברגים מגב הזוויתן. null = אוטומטי לפי רוחב הרגל */
  gauge: Mm | null;
  /** עובי פח החיבור (וגם עובי פח המילוי בהצטלבות) */
  gussetT: Mm;
  /** מרחק שפה מינימלי בפח החיבור */
  gussetEdge: Mm;
  /** מרווח בין קצה הזוויתן לפני הווב */
  clearance: Mm;
  weldSize: Mm;
  /** בורג בהצטלבות האלכסונים */
  crossBolt: boolean;
}

/** חיבור המשך לפטה: פלטה בצד הפנימי של הווב, 2 ברגים בכל פטה (סה"כ 4) */
export interface PurlinSpliceParams {
  plateT: Mm;
  /** גובה הפלטה. null = אוטומטי לפי גובה הפטה */
  plateH: Mm | null;
  bolt: BoltSpec;
  /** מרחק עמודת הברגים מקו המפגש (מוגדל אוטומטית אם התפר מעל תומך) */
  jointOffset: Mm;
  /** מרחק שפה בפלטה */
  edge: Mm;
}

export interface BuildingParams {
  roofType: RoofType;
  heightRef: HeightRef;
  /** מפתח בין צירי העמודים (ציר א ב-x=0, ציר ב ב-x=width) */
  width: Mm;
  /** גובה בציר העמוד השמאלי (x=0) ובציר הימני (x=width) */
  eaveLeft: Mm;
  eaveRight: Mm;
  /** דו־שיפועי בלבד: מיקום הרכס מציר שמאל, ושיפוע השמאלי באחוזים. השיפוע הימני נגזר. */
  ridgeX: Mm;
  slopeLeftPct: number;
  frames: FrameDef[];
  /** קונזולות קורות הגג לרוחב (היטל אופקי) */
  rafterOverhangLeft: Mm;
  rafterOverhangRight: Mm;
  /** קונזולות פטות לאורך Y — פרמטרים נפרדים מקונזולות הקורות (בשימוש ב-M2) */
  purlinOverhangStart: Mm;
  purlinOverhangEnd: Mm;
  columnProfile: string;
  rafterProfile: string;
  material: string;
  baseElevation: Mm;
  /** מפלס תחתית העמודים לכל ציר (פני חגורה / יסוד), מפלס מוחלט ביחס ל-±0.00; חסר = baseElevation */
  lineBase?: Record<string, Mm>;
  purlins: PurlinSystem;
  bracing: BracingParams;
  /** חתך מודולרי (שורות עמודים ומישורי גג). חסר = מצב קלאסי לפי roofType/width/eave/ridge */
  section?: CustomSection;
  /** שמות צירי עמודים חופשיים (מזהה ציר → שם, למשל A / D / E כמו בתוכנית). חסר = א, ב, ג… */
  lineLabels?: Record<string, string>;
  /** אלכסוני עמוד-קורה (קנה/knee brace) */
  kneeBraces?: KneeBraceParams;
  /** חיזוק רכס לקבלת העומסים */
  ridgeReinf?: RidgeReinfParams;
  /** חיפוי גג וקירות, פטות קיר, עמודי רוח, פתחים ומזחלות */
  cladding?: CladdingParams;
  /** דילול עמודים: קורות נושאות בין העמודים שנותרו בשורה */
  transfers?: TransferDef[];
  /** מסבכי גג: קורת הגג = חגורה עליונה; חגורה תחתונה + אנכיים/אלכסונים מרותכים במסגריה */
  roofTruss?: RoofTrussParams;
  /** כנף ניצבת (סככת L): סככה נמוכה שהמסגרת הראשונה שלה נשענת על עמודי הצד של הסככה הראשית */
  wing?: WingDef;
  /** תוכנית לא מלבנית: skew = מקבילית (המסגרות מוסטות באלכסון, קירות הקצה משופעים); taper = טרפז (ציר קצה אחד משופע — המפתח משתנה) */
  plan?: PlanShape;
  /** מכפל (haunch) בראש העמוד: מכפל משולש מרותך מתחת לקורת הגג ליד העמוד — מאפשר קורה קלה יותר במפתחים גדולים */
  haunch?: HaunchParams;
}

export interface WingDef {
  enabled: boolean;
  /** הצד של הסככה הראשית שאליו מחוברת הכנף: L = ציר ראשון (x קטן), R = ציר אחרון */
  side: 'L' | 'R';
  /** המסגרת הראשית שבה מתחילה הכנף, ורוחב הכנף במספר מפתחים של הסככה הראשית */
  fromFrame: string; bays: number;
  /** אורך הכנף מהסככה הראשית החוצה, ומספר המסגרות שלה (כולל המסגרת הנשענת) */
  length: Mm; frames: number;
  roofType: 'gable' | 'mono';
  /** גובה מרזב הכנף (TOS); שיפוע באחוזים; חד-שיפועי: הצד הגבוה */
  eave: Mm; slopePct: number; monoHigh?: 'start' | 'end';
  columnProfile?: string; rafterProfile?: string;
}

/** תמיכת הקורה הנושאת בעמוד: A1 על ראש העמוד; A2 פלטת קצה; A3 פלטת סנפיר; A4 זוויתני ווב; A5 תושבת */
/** מסבך: שדה — אלכסון עולה (/), יורד (\\), X או ריק; אנך בכל צומת (כן/לא) */
export type TrussCell = '/' | '\\' | 'X' | '';
export interface TrussSpec {
  panels: number;
  /** גובה בין צירי החגורות בקצה (מ"מ) */
  depth: Mm;
  cells: TrussCell[];
  verts: boolean[];
  profiles: { top: string; bottom: string; endDiag: string; diag: string; vert: string };
  /** חיבורי המשך בחגורות: auto — לפי אורך המוט; none; או מספרי שדות (התפר באמצע השדה) */
  splice: 'auto' | 'none' | number[];
  pattern?: 'warren-v' | 'warren' | 'pratt' | 'howe' | 'custom';
  symmetric?: boolean;
  /** אורכי שדות (מ"מ) — חלוקה לא אחידה; מותאמים יחסית למפתח בפועל. חסר/לא תואם למספר השדות ⇒ שדות שווים */
  panelLens?: Mm[];
  /** שדות שאורכם נקבע ידנית (נשמר בשינוי שדה אחר); השדות החופשיים מתחלקים שווה ביתרה */
  lockedLens?: boolean[];
}
export interface RoofTrussParams {
  enabled: boolean;
  /** מסגרות עם מסבך: all או רשימת מזהי מסגרות */
  frames: 'all' | string[];
  /** flat: חגורה תחתונה אופקית; parallel: מקבילה לגג; scissor: "מספריים" — מוגבהת באמצע (ברכס) */
  shape: 'flat' | 'parallel' | 'scissor';
  /** scissor: הגבהת החגורה התחתונה ברכס (מ"מ) */
  rise?: Mm;
  spec: TrussSpec;
}

export type TbSupport = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';
/** חיבור קורת הגג לקורה הנושאת: B1 כיסא + 2 פלטות; B2 טריז לאגף; B3 עמוד קצר; B4 חיבור צד לווב */
export type TbSeat = 'B1' | 'B2' | 'B3' | 'B4';
export interface TransferDef {
  id: string;
  /** שורת העמודים (מזהה קו בחתך) */
  lineId: string;
  /** מסגרות העמודים הנותרים (תמיכות הקורה) */
  from: string; to: string;
  /** מסגרות שהעמודים בהן מבוטלים */
  removed: string[];
  profile: string;
  support: TbSupport;
  seat: TbSeat;
  /** beam (ברירת מחדל) או מסבך נושא */
  kind?: 'beam' | 'truss';
  /** אלכסוני Y מהקורה הנושאת לעמודים התומכים (1.41): ירידה מתחתית הקורה וזווית; מקטינים את המפתח בבדיקת החתך */
  knee?: { enabled: boolean; profile: string; drop: Mm; angle: number };
  truss?: TrussSpec;
  /** מסבך: top = על ראשי העמודים (העמודים מתקצרים, ברירת מחדל); between = העמודים ממשיכים עד קורת הגג והמסבך ביניהם (כמו אגד B) */
  trussFit?: 'top' | 'between';
  /**
   * מסבך בין העמודים — חיבור החגורות לעמוד: auto (ברירת מחדל) — סנפיר אם החגורה נכנסת בין אגפי העמוד / לפני עמוד שטוחים,
   * אחרת plate; fin = פח מרותך לעמוד (לווב בין האגפים, או לפני העמוד — דופן RHS / אגף) + לשונית בחגורה, מוברג בשטח;
   * plate = פלטת סגירה בין קצות האגפים + פלטת קצה גבוהה (פלטה אל פלטה)
   */
  trussConn?: 'auto' | 'fin' | 'plate';
  /** סנפיר: horizontal (ברירת מחדל) — הפח שוכב והחגורה מונחת עליו (נוח להרכבה); vertical — הפח עומד במישור המסבך */
  finOrient?: 'horizontal' | 'vertical';
  /** קורה ארוכה מחומר הגלם: auto (ברירת מחדל) — חיבורי המשך מוברגים מחוץ לאזורי המושבים; none — מוט אחד (הזמנה מיוחדת) */
  splice?: 'auto' | 'none';
}

export type WallId = 'L' | 'R' | 'F' | 'B';
export interface OpeningDef { id: string; wall: WallId; /** מרחק מתחילת הקיר (L/R: מהמסגרת הראשונה; F/B: מציר שמאל) */ pos: Mm; width: Mm; height: Mm; sill: Mm; label?: string }
/** חתך המזחלה ותמיכותיה (פרטי לקוח) */
export interface GutterSpec {
  /** עובי פח, תחתית, דופן פנימית (עד מתחת לפח הגג), דופן חיצונית, כיפוף שפה */
  t: Mm; bottom: Mm; inner: Mm; outer: Mm; lip: Mm;
  /** זוויתן תומך בכל קצה קורה (מרותך במסגריה) */
  bracket: string;
  /** מתלי פח בין המסגרות (עבודת פחחות); 0 = ללא */
  hangerSpacing: Mm;
  /** קוטר ירידת מרזב ומרווח שלות */
  pipeD: Mm; clampSpacing: Mm;
  /** סוג התמיכה: web = זוויתן מרותך בחפיפה על צד ווב הקורה (ברירת מחדל; נמוך מהקורה — מרותך לפלטת קצה);
   *  twin = 2 זוויתנים מרותכים לקצה הקורה; plate = פלטה בקצה הקורה + זוויתן אחד */
  support?: 'web' | 'twin' | 'plate';
  /** כיוון זוויתן התמיכה: horizontal = אופקי (ברירת מחדל), roof = בשיפוע הגג */
  bracketSlope?: 'horizontal' | 'roof';
  /** הגבהה/הנמכה של המזחלה ביחס למיקום האוטומטי (+ למעלה) */
  bracketOffset?: Mm;
  /** אורך החפיפה על הווב */
  lap?: Mm;
  /** מיקום הדופן הפנימית: purlin = מעל הפטה האחרונה (ברירת מחדל), end = בקצה הקורה */
  innerAt?: 'purlin' | 'end';
  /** עובי הפלטה בתמיכת plate */
  plateT?: Mm;
  /** חתך משתנה: תוספת עומק בירידת המרזב (תחתית בשיפוע לכיוון הירידה); 0 = חתך קבוע */
  fall?: Mm;
}
export interface CladdingParams {
  roof: { enabled: boolean; panel: string; cover: Mm; eaveExt: Mm;
    /** סוג החיפוי: panel50 / panel100 = פנל מבודד (סנדוויץ') 50/100 מ"מ, sheet = איסכורית (פח גלי) */
    kind?: 'panel50' | 'panel100' | 'sheet';
    /** עובי החיפוי (לתצוגה ולפרטים) */
    thickness?: Mm };
  walls: { enabled: boolean; sides: Record<WallId, boolean>; panel: string; cover: Mm; bottom: Mm;
    /** לכל קיר: מפתחים מחופים (L/R: בין מסגרות; F/B: בין שורות העמודים), גובה תחתון/עליון מעל ±0.00 (ריק = ברירת מחדל / עד הגג) */
    per?: Partial<Record<WallId, { bays?: boolean[]; bottom?: Mm; top?: Mm | null }>> };
  girts: { enabled: boolean; profile: string; first: Mm; spacing: Mm };
  posts: { enabled: boolean; profile: string; maxSpacing: Mm };
  jambProfile: string;
  openings: OpeningDef[];
  gutter: { enabled: boolean; downpipeSpacing: Mm; spec?: Partial<GutterSpec>;
    /** לכל מזחלה (מזהה מישור): באילו מפתחים יש מזחלה (חסר = בכולם), ומיקומי ירידות לפי אינדקס מסגרת (חסר = אוטומטי) */
    perRun?: Record<string, { bays?: boolean[]; downpipes?: number[] }> };
  roofScrewsPerM2: number; wallScrewsPerM2: number;
}

/**
 * חיזוק רכס (החלטת משתמש 15.11.2026): plate = פלטת קצה מוגבהת מתחת לקורות + פלטת חיזוק משולשת מתחת לכל קורה;
 * tie = פרופיל אופקי בין שתי קורות הגג מתחת לרכס, מוברג לפחים מרותכים לקורות.
 */
export interface RidgeReinfParams {
  type: 'none' | 'plate' | 'tie';
  /** plate: עומק ההגבהה מתחת לתחתית הקורה, אורך המשולש (אופקי מהרכס), עובי פלטת החיזוק */
  depth: Mm; length: Mm; stiffT: Mm;
  /** tie: חתך, מרווח בין פני עליון של הפרופיל לתחתית הקורות ברכס, עובי פח, ברגים */
  tieProfile: string; tieGap: Mm; gussetT: Mm; bolt: BoltSpec; gauge: Mm; pitch: Mm; edge: Mm; weldSize: Mm;
}

/** אלכסון בין עמוד לקורת גג (החלטת משתמש 15.11.2026, לפי התוכניות: RHS80/80/4, פלטות 180×280×14, 4×M16) */
export interface KneeBraceParams {
  enabled: boolean;
  profile: string;
  /** מרחק נקודת החיבור על העמוד מתחתית הקורה (אנכי) ועל הקורה מציר העמוד (אופקי) */
  drop: Mm;
  reach: Mm;
  /** angle (ברירת מחדל, 45° מהאופק): נקודת החיבור לקורה נגזרת מהזווית; reach: מרחק אופקי קבוע */
  mode?: 'angle' | 'reach';
  angle?: number;
  /** fin (ברירת מחדל ל-RHS): פח מרותך למארח + לשונית בחריץ; angle (ברירת מחדל לזוויתן): זוויתן מוברג ישירות לפח; flange: פלטת קצה מוברגת לאגף המארח */
  detail?: 'fin' | 'flange' | 'stub' | 'angle';
  /** ברגים בכל קצה (בשורה לאורך הציר) */
  boltsPerEnd?: number;
  /**
   * מנוע פרט ה-fin (שלב C): 'legacy' (ברירת מחדל כשחסר — הקוד הישן, `finJoint`) או 'recipe' (המתכון `kneeFinRecipe`,
   * מוחל אוטומטית על שני קצוות כל אלכסון fin ומחליף את הקוד הישן; הפרמטרים נגזרים מהשדות כאן). פרויקטים קיימים — ללא שינוי.
   */
  finEngine?: 'legacy' | 'recipe';
  /** פלטות קצה: עובי; רוחב/אורך — לפרט flange בלבד (בפרט stub נגזרים מהפרופיל והברגים) */
  plateT: Mm; plateW: Mm; plateL: Mm;
  bolt: BoltSpec; gauge: Mm; pitch: Mm;
  weldSize: Mm;
  /** חיבורים שבוטלו ידנית: מזהה "קו.מישור.צד" */
  exclude: string[];
  /** הגדרה לכל צד בנפרד (מזהה "קו.מישור.צד"): ביטול / ירידה / זווית / מרחק / חתך — דורס את הכללי */
  sides?: Record<string, KneeSideOverride>;
  /** ביטול במסגרת מסוימת: "מסגרת|קו.מישור.צד" */
  offCells?: string[];
}
export interface KneeSideOverride { on?: boolean; drop?: Mm; angle?: number; reach?: Mm; mode?: 'angle' | 'reach'; profile?: string; /** פרט חיבור חריג לצד הזה */ detail?: 'fin' | 'flange' | 'angle' }

export interface ProjectMeta {
  name: string;
  number: string;
  description: string;
  designer: string;
  client: string;
  createdAt: string;
  updatedAt: string;
  /** 1.59: מצב שלבי העבודה — 'done' = אושר באשף, 'skip' = "לא נדרש במבנה הזה". חסר = פרויקט ישן (מחושב לפי מה שקיים) */
  steps?: Record<string, 'done' | 'skip'>;
}

export interface ManualPlacement {
  start: Vec3;
  end: Vec3;
  /** חתימת הגיאומטריה הנגזרת בעת ההתאמה הידנית; שינוי בה = התאמה לא תקפה */
  basis: string;
}

export interface MemberOverride {
  profile?: string;
  material?: string;
  rollDeg?: number;
  mirror?: boolean;
  placement?: ManualPlacement;
}

export type MemberKind = 'column' | 'rafter' | 'beam' | 'brace' | 'purlin' | 'girt' | 'cleat' | 'plate' | 'bolt' | 'anchor';

export type ConnType = 'eave' | 'ridge' | 'base' | 'purlin-cleat' | 'brace' | 'brace-end' | 'brace-cross' | 'purlin-splice' | 'rafter-side' | 'knee' | 'ridge-tie' | 'beam-splice' | 'tb-support' | 'tb-seat' | 'truss' | 'truss-splice' | 'truss-end' | 'gutter' | 'custom';
export type ApprovalStatus = 'not-verified' | 'for-review' | 'approved';

/** חיבור מבוסס פלטה וקבוצת ברגים (קורה-עמוד, רכס, פלטת בסיס). */
export interface PlateConnParams {
  enabled: boolean;
  /** עובי, רוחב (ניצב לציר הקורה/לאורך Y) ואורך הפלטה */
  t: Mm;
  w: Mm;
  l: Mm;
  bolt: BoltSpec;
  /** ברגים: עמודות (לאורך Y) × שורות (לאורך הפלטה), מרווחים */
  cols: number;
  rows: number;
  gauge: Mm;   // מרחק בין עמודות
  pitch: Mm;   // מרחק בין שורות
  weldSize: Mm;
  /** ראש עמוד בלבד: true = פלטה על העמוד + פלטה על הקורה, מוברגות ביניהן (ברירת מחדל); false = פלטה אחת, ברגים דרך אגף הקורה */
  split?: boolean;
  /** פלטת בסיס בלבד: אורך ברגי/מוטות עיגון מתחת לפלטה */
  anchorLength?: Mm;
  /**
   * פלטת בסיס בלבד. embedded: פלטה מבוטנת ביסוד (פני הפלטה = מפלס הבסיס) עם מוטות עיגון מרותכים מתחתיה,
   * והעמוד מרותך אליה בשטח (חריג מאושר לעיקרון — נדרש תיקון גלוון). bolted: פלטה מרותכת לעמוד וברגי עיגון.
   */
  mode?: 'embedded' | 'bolted' | 'pile';
  /** בסיס בכלונס (pile): עומק הטמנת העמוד בכלונס */
  pileEmbed?: Mm;
}

export type ConnectionDefaults = Record<'eave' | 'ridge' | 'base', PlateConnParams> & { side?: PlateConnParams };

export interface ConnectionTemplate { id: string; name: string; type: 'eave' | 'ridge' | 'base'; params: PlateConnParams }

export interface ManualMember {
  id: string;
  kind: MemberKind;
  start: Vec3;
  end: Vec3;
  profile: string;
  material: string;
  rollDeg: number;
  mirror: boolean;
  /** v-axis reference (כיוון גובה החתך) */
  refUp: Vec3;
  anchor: Anchor;
  copiedFrom?: string;
}

/** center: מרכז החתך על הקו; top: פני עליון על הקו; purlin: פני תחתון על הקו וציר הווב על הקו; corner: פינת (umin,vmin) על הקו */
export type Anchor = 'center' | 'top' | 'purlin' | 'corner';

export interface Project {
  schemaVersion: number;
  id: string;
  meta: ProjectMeta;
  displayUnit: 'm' | 'mm';
  /** autoSplice: חלוקה אוטומטית של אלמנט ארוך מחומר הגלם (ברירת מחדל: כן) */
  settings: { stockLength: Mm; stockLengths: Mm[]; kerf: Mm; checkedBy: string; approvedBy: string; autoSplice?: boolean;
    /** האחדת אורכי ברגים: הפרש מרבי (מ"מ) לאיחוד לאורך הארוך; 0/ריק = כבוי */
    boltUnify?: Mm;
    /** לאיזה מפלס מתייחסים הגבהים בשרטוט החתך (הזנה ותצוגה בלבד; המודל שומר פני עליון קורת גג): tos (ברירת מחדל) / col = ראש העמוד / purlin = פני עליון הפטות / roof = פני הגג הגמור */
    heightDatum?: 'tos' | 'col' | 'purlin' | 'roof';
    /** סבולת מספור (מ"מ): חלקים באותה צורה שאורכם ומיקומי חוריהם שונים עד הסבולת מקבלים סימון אחד ומיוצרים כמו הנציג; 0/ריק = כבוי */
    markTol?: Mm;
    /** stock = מוט מלא והשלמה (ברירת מחדל); equal = חלקים שווים */
    spliceMode?: 'stock' | 'equal';
    /** פלטות חיזוק משולשות בחיבור המשך של קורת I */
    spliceStiffeners?: boolean;
    /** סוג חיבור ההמשך: bolted = פלטות קצה מוברגות בשטח (ברירת מחדל); welded = פלטות כיסוי מרותכות במסגריה (האלמנט יוצא כמכלול אחד) */
    spliceJoint?: { beams?: 'bolted' | 'welded'; columns?: 'bolted' | 'welded' };
    /** שרטוטים בצבע (מסך); ברירת מחדל: שחור-לבן להדפסה */
    drawingColor?: boolean;
    /** דרגת ביצוע לפי EN 1090-2 */
    execClass?: 'EXC1' | 'EXC2' | 'EXC3';
    /** גודל נייר מועדף: A4 (ברירת מחדל — מדפסת ביתית; גיליון שלא נכנס בקנ"מ סביר עולה ל-A3) או A3 */
    paper?: 'A4' | 'A3';
    /** הערכת גדלים (כללי אצבע) — ספים ועומסים; חסר = ברירת מחדל */
    sizing?: Partial<import('./sizing').SizingCfg>;
    /** מחירון להצעת מחיר — נשמר בקובץ הפרויקט בלבד */
    pricing?: Partial<import('../fab/quote').Pricing>;
    /** הצעת מחיר ללקוח: שם החברה ותנאים (שורה לכל תנאי) */
    company?: string; quoteTerms?: string };
  building: BuildingParams;
  memberOverrides: Record<string, MemberOverride>;
  manualMembers: ManualMember[];
  deleted: string[];
  /**
   * מיקומי חיבורי המשך לכל מכלול (מזהה אלמנט): מרחקים לאורך ציר האלמנט מנקודת ההתחלה, mm.
   * חיבור המשך אינו מאושר הנדסית — מסומן "דורש תכנון".
   */
  splices: Record<string, Mm[]>;
  /** פרמטרי חיבורים לפי סוג (ברירת מחדל לפרויקט) */
  connectionDefaults: ConnectionDefaults;
  /** שינויים לחיבור בודד (לפי מזהה חיבור) — נשמרים לאלמנט */
  connectionOverrides: Record<string, Partial<PlateConnParams> & { status?: ApprovalStatus; fixity?: 'rigid' | 'pinned' | 'semi' }>;
  /** ספריית תבניות חיבור של המשתמש */
  connectionTemplates: ConnectionTemplate[];
  /** שינויים לתומך בודד (לפי מזהה תומך) */
  cleatOverrides: Record<string, Partial<CleatParams>>;
  /** ספריית פרטי חיבור מותאמים (מתכון פעולות עם נוסחאות) */
  customDetails?: CustomDetail[];
  /** ספריית חיבורים (1.42): הגדרות שמורות לסוגי פרט — בפרויקט הפתוח בלבד; ייצוא/ייבוא כסטנדרט חברה */
  connLibrary?: import('./connRegistry').ConnPreset[];
  /** ברירת מחדל לכל משפחת חיבור (מזהה הגדרה שמורה) */
  connDefaults?: Partial<Record<import('./connRegistry').ConnFamily, string>>;
  /** שיוך פרט מותאם לקצה אלמנט: "מזהה אלמנט|start" או "|end" ⇒ מזהה פרט */
  detailAssign?: Record<string, string>;
  /** ערכי פרמטרים למופע (מתכון v2): "מזהה אלמנט|start/end" ⇒ { שם משתנה ⇒ ערך }. דורסים את ברירות המחדל של הפרט */
  detailParams?: Record<string, Record<string, number>>;
  /** הודעות שהוסתרו: "קוד|*" לסוג שלם, או מפתח הודעה (issueKey) */
  dismissedIssues?: string[];
  nextFrameNo: number;
  nextMemberNo: number;
  /** רישום מספור יציב: חתימה ⇒ סימון. נכתב רק בפקודת "מספור" */
  marks: MarkRegistry;
  /** מהדורות: נעילת מהדורה מאושרת ופתיחת מהדורה חדשה */
  revision: RevisionState;
  /** רשומות שרטוטים (הגדרה + סטטוס + מהדורות); התוכן נגזר מהמודל */
  drawings: DrawingRecord[];
}

export interface MarkRegistry {
  parts: Record<string, string>;
  assemblies: Record<string, string>;
  counters: Record<string, number>;
  /** הסימון האחרון של כל חלק לפי מזהה, לזיהוי שינויים */
  lastByPart: Record<string, string>;
  history: { date: string; id: string; from: string; to: string }[];
  numberedAt?: string;
}

export interface RevisionEntry { rev: string; date: string; note: string; status: 'approved' | 'draft'; snapshot?: string }
export interface RevisionState { current: string; locked: boolean; log: RevisionEntry[] }

export type DrawingType = 'cover' | 'plates' | 'cladding' | 'gutter' | 'roof-plan' | 'anchor-plan' | 'frame' | 'side' | 'part' | 'assembly' | 'connection' | 'ga' | 'erection' | 'labels' | 'sequence' | 'brace-unit';
export interface DrawingRecord {
  id: string;
  number: string;
  type: DrawingType;
  title: string;
  /** פרמטר: מזהה מסגרת / סימון חלק / מזהה חיבור / צד */
  ref?: string;
  /** גודל גיליון קבוע; ריק = אוטומטי לפי העדפת הנייר בהגדרות */
  sheet?: 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
  status: 'draft' | 'for-review' | 'approved';
  rev: string;
  /** חתימת התוכן בעת האישור — שינוי מסמן "השתנה מאז האישור" */
  approvedHash?: string;
  history: { rev: string; date: string; status: string; note: string }[];
}

// ---------- מודל נגזר (אינו נשמר) ----------

export interface Member {
  id: string;
  kind: MemberKind;
  label: string;
  frameId?: string;
  side?: 'L' | 'R';
  /** חתך מודולרי: מזהה שורת העמודים / מישור הגג */
  lineId?: string;
  planeId?: string;
  /** קו הייחוס של האלמנט (TOS לקורת גג כאשר heightRef=TOS, אחרת ציר) */
  start: Vec3;
  end: Vec3;
  profile: string;
  material: string;
  rollDeg: number;
  mirror: boolean;
  anchor: Anchor;
  refUp: Vec3;
  startCut?: Plane;
  endCut?: Plane;
  /** פלטה בצורה חופשית: מתאר בקואורדינטות (s לאורך ex מנקודת ההתחלה, u לרוחב); העובי לאורך v */
  contour?: { s: number; u: number }[];
  /** פלטה בלבד: קיטום 45° בשתי הפינות בצד u=side·b/2 בשני הקצוות (מקשח — מעבר לרדיוס השורש של הפרופיל) */
  snip?: { side: -1 | 1; c: number };
  source: 'generated' | 'manual';
  manualPlacement: boolean;
  purlin?: PurlinInfo;
  /** אלמנט קיר (פטת קיר, עמוד רוח, עמוד פתח) */
  wall?: { id: WallId; role: 'girt' | 'post' | 'jamb'; level?: number };
  /** לחלקי חיבור (זוויתן, פלטה, בורג): מזהה החיבור */
  connId?: string;
  /** תיאור חלק לייצור (לפלטה/זוויתן/בורג) */
  partDesc?: string;
}

export interface PurlinInfo {
  /** מזהה מישור הגג (קלאסי: L / R / M) */
  side: string;
  /** קצה ההתחלה חופשי (לא רכס) */
  startFree?: boolean;
  /** מפתח פרמטרי הפטות */
  paramKey?: string;
  index: number;          // 1 = הקרוב לנקודת ההתחלה
  count: number;
  /** מרחק מנקודת ההתחלה לאורך השיפוע ובהיטל אופקי */
  sSlope: Mm;
  sHoriz: Mm;
  /** מרווח מהפטה הקודמת לאורך השיפוע (0 לראשונה) */
  spanBefore: Mm;
  isLast: boolean;
  /** נורמל מישור הגג (כלפי מעלה) */
  roofNormal: Vec3;
  opening: 'up' | 'down';
  measure: 'slope' | 'horizontal';
}

/** נקודת תמיכה: מפגש קו פטה עם קורת גג של מסגרת. */
export interface SupportPoint {
  id: string;
  purlinId: string;
  frameId: string;
  rafterId: string;
  p: Vec3;
}

/** חלק ייצור: קטע של מכלול בין חיבורי המשך. t = מרחק לאורך ציר האלמנט מנקודת ההתחלה. */
export interface FabPart {
  id: string;
  memberId: string;
  index: number;
  t0: Mm;
  t1: Mm;
  length: Mm;
  profile: string;
  material: string;
}

export interface BoltInfo {
  id: string;
  connId: string;
  /** מרכז ראש הבורג וכיוון הציר (מהראש לאום) */
  p: Vec3;
  axis: Vec3;
  d: Mm;
  hole: Mm;
  grade: string;
  standard: string;
  grip: Mm;
  length: Mm;
  /** shop = מסגריה, site = שטח */
  location: 'site' | 'shop';
  /** חורים בחלקים המחוברים */
  holesIn: string[];
  /** חור אובלי: אורך החור (מקצה לקצה) לאורך ציר החלק, לפי מזהה חלק */
  slots?: Record<string, Mm>;
  /** rod = מוט הברגה מרותך (בכתב הכמויות: אום בלבד) */
  rod?: boolean;
}

export interface WeldInfo {
  id: string;
  connId: string;
  type: 'fillet';
  a: Mm;
  length: Mm;
  location: 'shop' | 'site';
  between: [string, string];
  /** קו הריתוך להצגה */
  from: Vec3;
  to: Vec3;
}

export interface Connection {
  id: string;
  type: ConnType;
  label: string;
  /** אלמנטים ראשיים המחוברים */
  members: string[];
  /** חלקי החיבור (מזהי אלמנטים: זוויתן, פלטות, ברגים) */
  parts: string[];
  bolts: BoltInfo[];
  welds: WeldInfo[];
  status: ApprovalStatus;
  /** קביעות (rigid/pinned) — מאפיין מבני בלבד, ללא אימות */
  fixity: 'rigid' | 'pinned' | 'semi';
  overridden: boolean;
  /** חורי אוורור נוספים שהוגדרו בפרט מותאם */
  vents?: { memberId: string; p: Vec3; axis: Vec3; d: Mm }[];
  /** חורים ללא בורג (מוט עיגון עובר בפלטה ומרותך מעליה וכד') */
  holes?: { id: string; memberId: string; p: Vec3; axis: Vec3; d: Mm; slot?: Mm }[];
  /** פרט מותאם: מזהה הפרט ומפתח האתר */
  custom?: { detailId: string; site: string };
  /** חיבור מובנה שמוחלף אוטומטית במתכון מובנה (ראו `KneeBraceParams.finEngine`): מזהה המתכון וערכי הפרמטרים לשני הקצוות */
  recipe?: { id: string; params: Record<string, number>; /** קצוות האתר (מפתחות `אלמנט|start/end`); חסר = שני קצוות האלמנט הראשון ברשימת החלקים */ sites?: string[];
    /** ערכים נוספים לכל אתר (מעל `params`) — למשל מי בונה את הברגים המשותפים */ siteParams?: Record<string, Record<string, number>>;
    /** אתר זוגי: אתר שבונה ברגים משותפים ← האתר שכנגד (הפלטה שלו משתתפת בסריקת הברגים) */ pairs?: Record<string, string> };
}

// ---------- פרטי חיבור מותאמים ----------

/** נוסחה או מספר. משתנים: חתך ראשי (mh mb mt mtf), מארח (hh hb htf htw), זווית ang, משתני הפרט, ותוצאות פעולות קודמות (P1.w) */
export type Expr = string;
/**
 * פנים שעליהן יושב רכיב:
 *   main — האלמנט שהקצה שלו מפורט: end (קצה לאחר חיתוך), a+/a- (דפנות במישור), w+/w- (דפנות ניצבות למישור), axis / axis- (מישור הציר המקורי, לפני shift: נורמל w קנוני — הצד החיובי זהה בשני קצוות האלמנט — לאורך הציר); axisA / axisA- (כמו axis, אבל נורמל a קנוני — לפלטה שמישורה מקביל ל-w, כמו בתמוכה בין קורות);
 *   host — המארח: hit (הפנים שהציר פוגע בהן), opp (הפנים הנגדיות), web (הווב, בצד האלמנט);
 *   מזהה פעולת פלטה — z+ / z- (שני פני הפלטה).
 */
export interface DetailRef { on: 'main' | 'host' | string; face: string; along: Expr; across: Expr }
export type DetailOp =
  | { k: 'cut'; id: string; kind: 'perp' | 'host' | 'vert' | 'horiz'; at: Expr }
  /** הסטת קצה האלמנט הראשי (ציר + חיתוך) ניצב למישור (לאורך w) — למשל בעובי הפח, כשהלשונית מחליפה את מקומו. לא חל על תושבת פטה */
  | { k: 'shift'; id: string; by: Expr }
  | { k: 'plate'; id: string; name?: string; ref: DetailRef; mode: 'flat' | 'stand'; spin: Expr; off: Expr; shape: 'rect' | 'cham' | 'tri' | 'round'; w: Expr; h: Expr; t: Expr; ch: Expr; corners: [boolean, boolean, boolean, boolean];
      /** קצה הפלטה שליד המארח נחתך בזווית במישור פני המארח (חיתוך קצה בחלק — מופיע בגיליון ובזווית ה-NC1) */ clipHost?: boolean;
      /** עם clipHost: עומק מישור החיתוך לתוך המארח מפני הפגיעה (למשל פני הווב מאחורי קצה האגפים בחתך I שנפגע מהצד) */ clipOff?: Expr }
  | { k: 'endplate'; id: string; t: Expr; w: Expr; h: Expr; dx: Expr; dy: Expr }
  | { k: 'holes'; id: string; ref: DetailRef; rows: Expr; cols: Expr; px: Expr; py: Expr; d0: Expr }
  | { k: 'bolts'; id: string; holes: string; d: Expr; grade: string; site: boolean; /** אורך אחיזה (grip) מפורש במקום המדוד בסריקה (המדידה מעוגלת למ"מ ומשתמשת בעובי הווב של הגוף) — כמו החישוב האנליטי בקוד הישן; גבול אורך תקני רגיש ל-0.1 מ"מ */ grip?: Expr; /** התנאי: הפעולה מתבצעת רק כשהביטוי ≠ 0 (אתר זוגי: הברגים נבנים באתר אחד בלבד) */ when?: Expr }
  | { k: 'slot'; id: string; L: Expr; w: Expr; dir: 'a' | 'w' }
  | { k: 'vent'; id: string; d: Expr; at: Expr }
  | { k: 'rod'; id: string; ref: DetailRef; d: Expr; L: Expr }
  | { k: 'weld'; id: string; /** מזהה פלטה, או 'main' = ריתוך ישיר של האלמנט הראשי למארח (דורש `len`) */ part: string; a: Expr; site: boolean; /** אורך ריתוך מפורש (מ"מ); בלי — לפי היקף/צלע הפלטה */ len?: Expr; /** למה לרתך: main / host / מזהה פלטה. ברירת מחדל — הרכיב שהפלטה יושבת עליו */ to?: string };
export interface DetailVar { name: string; expr: Expr; note?: string }
/**
 * פרמטר שמוצג באשף (מתכון v2). קשור למשתנה בשם `name`: ערך למופע דורס את נוסחת המשתנה, ובלי ערך — הנוסחה (ברירת המחדל).
 * סוגי פקד: number (מספר, יחידה וטווח), select (בחירה מרשימה), toggle (מתג 0/1).
 */
export interface DetailParam {
  name: string; label: string;
  kind: 'number' | 'select' | 'toggle';
  unit?: string; min?: number; max?: number;
  options?: { value: number; label: string }[];
  /** קבוצה באשף (כותרת משנה) */
  group?: string;
  /** מוצג באשף (ברירת מחדל: כן) */
  show?: boolean;
  hint?: string;
}
export interface CustomDetail {
  id: string; name: string; note?: string;
  vars: DetailVar[];
  /** מתכון v2: הפרמטרים שהאשף מציג (בלי — הפרט נראה באשף בלי שדות; תואם לאחור) */
  params?: DetailParam[];
  ops: DetailOp[];
  /** סוג האתר שעליו נבנה (לסינון ולהצעה): "brace>column" וכד' */
  family?: string;
  /** תנאי התאמה לאשף החיבורים (1.47): משפחות חתך של האלמנט ושל המארח, טווח זווית (מעלות) */
  match?: { member?: string[]; host?: string[]; angMin?: number; angMax?: number };
  /** קטגוריה בספרייה (beam / cleat / …) */
  category?: string;
  /** מקור הפרט (ספרייה מיובאת): קישור, נתיב ונימוק — מידע בלבד */
  provenance?: { url?: string; path?: string; basis?: string; commit?: string };
  /** גרסת הגיאומטריה של הפרט (שינוי = פרט אחר) */
  version?: number;
}

export interface SpliceInfo {
  id: string;
  memberId: string;
  t: Mm;
  p: Vec3;
  /** requires-design: מיקום בלבד; bolted: חיבור המשך מוברג שנבנה (פטות) */
  status: 'requires-design' | 'bolted';
  connId?: string;
}

export interface ModelNode { id: string; p: Vec3; frameId: string; role: string }

export interface GridLine {
  id: string;
  label: string;
  /** 'X' = קו במיקום x קבוע (רץ לאורך Y), 'Y' = קו במיקום y קבוע (רץ לאורך X) */
  dir: 'X' | 'Y';
  pos: Mm;
}

export type Severity = 'error' | 'warning' | 'info';
export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  elementId?: string;
  field?: string;
  /** הצעת תיקון בלחיצה: עדכון פרמטרי פטות לסט מסוים */
  fix?: { label: string; purlinKey: string; patch: Partial<PurlinSideParams> };
  /** הצעת תיקון לתומך פטה: לכל תומכי הצד, או לתומך בודד (cleatId) */
  cleatFix?: { label: string; side: string; cleatId?: string; patch: Partial<CleatParams> };
}

export interface RoofInfo {
  ridgeZ?: Mm;
  slopeLeft: number;  // יחס
  slopeRight: number; // יחס (בחד־שיפועי = slopeLeft)
}

export interface DerivedModel {
  /** הודעות שהמשתמש הסתיר (לשחזור) */
  hiddenIssues?: ValidationIssue[];
  members: Member[];
  nodes: ModelNode[];
  grid: GridLine[];
  roof: RoofInfo;
  issues: ValidationIssue[];
  byId: Map<string, Member>;
  supports: SupportPoint[];
  parts: FabPart[];
  splices: SpliceInfo[];
  connections: Connection[];
  connById: Map<string, Connection>;
  /** חתך מנורמל (צירים ומישורי גג) */
  section?: import('./section').NSection;
  /** תוכנית לא מלבנית: המודל המלבני המקומי ומיפוי נקודה לעולם */
  plan?: { shape: 'skew' | 'taper'; local: { project: Project; derived: DerivedModel }; P: (q: Vec3) => Vec3 };
  /** קטעי קושרות הגג לאורך השיפועים (לבחירת כיסוי חלקי) */
  roofSegments?: { id: string; plane: string; x0: number; x1: number }[];
  /** כנף (סככת L): קו החיבור ותחום המפתחים */
  wing?: { side: 'L' | 'R'; xLine: number; y0: number; y1: number; off: number; dir: 1 | -1;
    /** מודל הכנף במערכת המקומית שלה (לחיפוי, מזחלות ושרטוטים) ומיפוי נקודה לעולם */
    local?: { project: Project; derived: DerivedModel; mainProject: Project; P: (q: { x: number; y: number; z: number }) => { x: number; y: number; z: number } } };
}
