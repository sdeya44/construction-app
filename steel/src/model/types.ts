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
  };
  walls: {
    enabled: boolean; profile: string; left: number[]; right: number[];
    /** x = קושרות X (ברירת מחדל); portal = אגד B: קורת RHS בין העמודים + שני אלכסונים קטנים */
    type?: 'x' | 'portal';
    /** מפתחים לכל ציר עמודים (מזהה ציר → מפתחים). חסר = left לציר הראשון ו-right לאחרון */
    byLine?: Record<string, number[]>;
    portal?: PortalBraceParams;
  };
  /** שורת קשירה לאגף התחתון של הפטות, באמצע כל מפתח */
  purlinTies: { enabled: boolean; profile: string };
  /** חיבורי קושרות X: פח חיבור מרותך לקורה/עמוד במסגריה, הזוויתן מוברג בשטח; בורג בהצטלבות עם פח מילוי */
  conn: BraceConnParams;
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
  truss?: TrussSpec;
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
}
export interface CladdingParams {
  roof: { enabled: boolean; panel: string; cover: Mm; eaveExt: Mm };
  walls: { enabled: boolean; sides: Record<WallId, boolean>; panel: string; cover: Mm; bottom: Mm;
    /** לכל קיר: מפתחים מחופים (L/R: בין מסגרות; F/B: בין שורות העמודים), גובה תחתון/עליון מעל ±0.00 (ריק = ברירת מחדל / עד הגג) */
    per?: Partial<Record<WallId, { bays?: boolean[]; bottom?: Mm; top?: Mm | null }>> };
  girts: { enabled: boolean; profile: string; first: Mm; spacing: Mm };
  posts: { enabled: boolean; profile: string; maxSpacing: Mm };
  jambProfile: string;
  openings: OpeningDef[];
  gutter: { enabled: boolean; downpipeSpacing: Mm; spec?: Partial<GutterSpec> };
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
  /** fin (ברירת מחדל, פרט הלקוח): פח מרותך למארח + לשונית בחריץ ה-RHS, מוברגים בחפיפה; flange: פלטת קצה מוברגת לאגף המארח */
  detail?: 'fin' | 'flange' | 'stub';
  /** ברגים בכל קצה (בשורה לאורך הציר) */
  boltsPerEnd?: number;
  /** פלטות קצה: עובי; רוחב/אורך — לפרט flange בלבד (בפרט stub נגזרים מהפרופיל והברגים) */
  plateT: Mm; plateW: Mm; plateL: Mm;
  bolt: BoltSpec; gauge: Mm; pitch: Mm;
  weldSize: Mm;
  /** חיבורים שבוטלו ידנית: מזהה "קו.מישור.צד" */
  exclude: string[];
  /** הגדרה לכל צד בנפרד (מזהה "קו.מישור.צד"): ביטול / ירידה / זווית / מרחק / חתך — דורס את הכללי */
  sides?: Record<string, KneeSideOverride>;
}
export interface KneeSideOverride { on?: boolean; drop?: Mm; angle?: number; reach?: Mm; mode?: 'angle' | 'reach'; profile?: string }

export interface ProjectMeta {
  name: string;
  number: string;
  description: string;
  designer: string;
  client: string;
  createdAt: string;
  updatedAt: string;
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
  mode?: 'embedded' | 'bolted';
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
  /** שיוך פרט מותאם לקצה אלמנט: "מזהה אלמנט|start" או "|end" ⇒ מזהה פרט */
  detailAssign?: Record<string, string>;
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

export type DrawingType = 'cover' | 'plates' | 'cladding' | 'gutter' | 'roof-plan' | 'anchor-plan' | 'frame' | 'side' | 'part' | 'assembly' | 'connection' | 'ga';
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
  /** פרט מותאם: מזהה הפרט ומפתח האתר */
  custom?: { detailId: string; site: string };
}

// ---------- פרטי חיבור מותאמים ----------

/** נוסחה או מספר. משתנים: חתך ראשי (mh mb mt mtf), מארח (hh hb htf htw), זווית ang, משתני הפרט, ותוצאות פעולות קודמות (P1.w) */
export type Expr = string;
/**
 * פנים שעליהן יושב רכיב:
 *   main — האלמנט שהקצה שלו מפורט: end (קצה לאחר חיתוך), a+/a- (דפנות במישור), w+/w- (דפנות ניצבות למישור);
 *   host — המארח: hit (הפנים שהציר פוגע בהן), opp (הפנים הנגדיות), web (הווב, בצד האלמנט);
 *   מזהה פעולת פלטה — z+ / z- (שני פני הפלטה).
 */
export interface DetailRef { on: 'main' | 'host' | string; face: string; along: Expr; across: Expr }
export type DetailOp =
  | { k: 'cut'; id: string; kind: 'perp' | 'host' | 'vert' | 'horiz'; at: Expr }
  | { k: 'plate'; id: string; name?: string; ref: DetailRef; mode: 'flat' | 'stand'; spin: Expr; off: Expr; shape: 'rect' | 'cham' | 'tri' | 'round'; w: Expr; h: Expr; t: Expr; ch: Expr; corners: [boolean, boolean, boolean, boolean] }
  | { k: 'endplate'; id: string; t: Expr; w: Expr; h: Expr; dx: Expr; dy: Expr }
  | { k: 'holes'; id: string; ref: DetailRef; rows: Expr; cols: Expr; px: Expr; py: Expr; d0: Expr }
  | { k: 'bolts'; id: string; holes: string; d: Expr; grade: string; site: boolean }
  | { k: 'slot'; id: string; L: Expr; w: Expr; dir: 'a' | 'w' }
  | { k: 'vent'; id: string; d: Expr; at: Expr }
  | { k: 'rod'; id: string; ref: DetailRef; d: Expr; L: Expr }
  | { k: 'weld'; id: string; part: string; a: Expr; site: boolean; /** למה לרתך: main / host / מזהה פלטה. ברירת מחדל — הרכיב שהפלטה יושבת עליו */ to?: string };
export interface DetailVar { name: string; expr: Expr; note?: string }
export interface CustomDetail {
  id: string; name: string; note?: string;
  vars: DetailVar[];
  ops: DetailOp[];
  /** סוג האתר שעליו נבנה (לסינון ולהצעה): "brace>column" וכד' */
  family?: string;
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
  /** כנף (סככת L): קו החיבור ותחום המפתחים */
  wing?: { side: 'L' | 'R'; xLine: number; y0: number; y1: number; off: number; dir: 1 | -1;
    /** מודל הכנף במערכת המקומית שלה (לחיפוי, מזחלות ושרטוטים) ומיפוי נקודה לעולם */
    local?: { project: Project; derived: DerivedModel; mainProject: Project; P: (q: { x: number; y: number; z: number }) => { x: number; y: number; z: number } } };
}
