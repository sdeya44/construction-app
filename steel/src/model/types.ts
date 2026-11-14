import type { Mm } from '../core/units';
import type { Plane, Vec3 } from '../core/vec';

/** גרסת סכמת קובץ הפרויקט. כל שינוי שובר מחייב מיגרציה ב-model/migrate.ts */
export const SCHEMA_VERSION = 1;

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

export type MemberKind = 'column' | 'rafter' | 'beam' | 'brace' | 'purlin';

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

export type Anchor = 'center' | 'top';

export interface Project {
  schemaVersion: number;
  id: string;
  meta: ProjectMeta;
  displayUnit: 'm' | 'mm';
  settings: { stockLength: Mm };
  building: BuildingParams;
  memberOverrides: Record<string, MemberOverride>;
  manualMembers: ManualMember[];
  deleted: string[];
  nextFrameNo: number;
  nextMemberNo: number;
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
}
