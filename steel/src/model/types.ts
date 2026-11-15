import type { Mm } from '../core/units';
import type { Plane, Vec3 } from '../core/vec';

/** גרסת סכמת קובץ הפרויקט. כל שינוי שובר מחייב מיגרציה ב-model/migrate.ts */
export const SCHEMA_VERSION = 6;

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
  /** מרווח רגיל */
  spacing: Mm;
  /** מדידה לאורך השיפוע (ברירת מחדל) או בהיטל אופקי (מסומן במפורש) */
  measure: 'slope' | 'horizontal';
  /** מרחק הפטה האחרונה מהקצה החיצוני של קורת הגג/הקונזולה (0 = בקצה) */
  edgeOffset: Mm;
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
}

/** מערכת קושרות ושורות קשירה לפטות. מפתחים (bays) לפי אינדקס: 0 = בין מסגרת 1 ל-2. */
export interface BracingParams {
  roof: { enabled: boolean; profile: string; bays: number[] };
  walls: { enabled: boolean; profile: string; left: number[]; right: number[] };
  /** שורת קשירה לאגף התחתון של הפטות, באמצע כל מפתח */
  purlinTies: { enabled: boolean; profile: string };
  /** חיבורי קושרות X: פח חיבור מרותך לקורה/עמוד במסגריה, הזוויתן מוברג בשטח; בורג בהצטלבות עם פח מילוי */
  conn: BraceConnParams;
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
  purlins: PurlinSystem;
  bracing: BracingParams;
}

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

export type MemberKind = 'column' | 'rafter' | 'beam' | 'brace' | 'purlin' | 'cleat' | 'plate' | 'bolt' | 'anchor';

export type ConnType = 'eave' | 'ridge' | 'base' | 'purlin-cleat' | 'brace' | 'brace-end' | 'brace-cross' | 'purlin-splice';
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
  /** פלטת בסיס בלבד: אורך ברגי/מוטות עיגון מתחת לפלטה */
  anchorLength?: Mm;
  /**
   * פלטת בסיס בלבד. embedded: פלטה מבוטנת ביסוד (פני הפלטה = מפלס הבסיס) עם מוטות עיגון מרותכים מתחתיה,
   * והעמוד מרותך אליה בשטח (חריג מאושר לעיקרון — נדרש תיקון גלוון). bolted: פלטה מרותכת לעמוד וברגי עיגון.
   */
  mode?: 'embedded' | 'bolted';
}

export type ConnectionDefaults = Record<'eave' | 'ridge' | 'base', PlateConnParams>;

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
  settings: { stockLength: Mm; stockLengths: Mm[]; kerf: Mm; checkedBy: string; approvedBy: string };
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

export type DrawingType = 'roof-plan' | 'frame' | 'side' | 'part' | 'assembly' | 'connection' | 'ga';
export interface DrawingRecord {
  id: string;
  number: string;
  type: DrawingType;
  title: string;
  /** פרמטר: מזהה מסגרת / סימון חלק / מזהה חיבור / צד */
  ref?: string;
  sheet: 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
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
  source: 'generated' | 'manual';
  manualPlacement: boolean;
  purlin?: PurlinInfo;
  /** לחלקי חיבור (זוויתן, פלטה, בורג): מזהה החיבור */
  connId?: string;
  /** תיאור חלק לייצור (לפלטה/זוויתן/בורג) */
  partDesc?: string;
}

export interface PurlinInfo {
  side: 'L' | 'R' | 'M';
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
}

export interface RoofInfo {
  ridgeZ?: Mm;
  slopeLeft: number;  // יחס
  slopeRight: number; // יחס (בחד־שיפועי = slopeLeft)
}

export interface DerivedModel {
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
}
