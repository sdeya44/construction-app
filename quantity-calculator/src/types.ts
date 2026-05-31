// ============================================================================
// מודל הנתונים המרכזי של כלי חישוב כמויות הנדסי
// ============================================================================

/** יחידות מידה נתמכות */
export type Unit = 'מ׳' | 'מ״ר' | 'מ״ק' | 'יח׳' | 'טון' | 'קג';

export const UNITS: Unit[] = ['מ׳', 'מ״ר', 'מ״ק', 'יח׳', 'טון', 'קג'];

/** סוג שורה - רגילה (תוספת) או הפחתה */
export type RowKind = 'normal' | 'deduction';

/**
 * סוג החישוב. קובע אילו שדות מידה רלוונטיים וכיצד מחושבת הכמות.
 */
export type CalcType =
  | 'length' // אורך פשוט: L
  | 'rect_area' // שטח מלבן: L × W
  | 'triangle_area' // שטח משולש: (בסיס × גובה) / 2
  | 'trapezoid_area' // שטח טרפז: ((בסיס עליון + בסיס תחתון) × גובה) / 2
  | 'circle_area' // שטח עיגול: π × r²
  | 'box_volume' // נפח תיבה: L × W × H
  | 'cylinder_volume' // נפח גליל: π × r² × H
  | 'count' // ספירת יחידות
  | 'measured_length' // אורך שנמדד מהתוכנית
  | 'measured_area'; // שטח שנמדד מהתוכנית (פוליגון/מלבן/משולש)

/** מטא-דאטה לכל סוג חישוב: שם בעברית והשדות הרלוונטיים */
export interface CalcTypeMeta {
  type: CalcType;
  label: string;
  unit: Unit; // יחידת ברירת מחדל
  fields: Array<'length' | 'width' | 'height'>; // אילו שדות מידה מוצגים
  fieldLabels: Partial<Record<'length' | 'width' | 'height', string>>;
  fromPlanOnly?: boolean; // מדידה מהתוכנית בלבד
}

/** שורת חישוב בודדת בטבלת הכמויות */
export interface CalcRow {
  id: string;
  sectionId: string | null; // שיוך לסעיף בספריית הסעיפים
  description: string; // תיאור החישוב (לדוגמה: "קיר בטון ציר A")
  page: string; // עמוד/תוכנית מקור
  type: CalcType;
  length: number | null; // אורך / בסיס / רדיוס לפי הסוג
  width: number | null; // רוחב / בסיס תחתון
  height: number | null; // גובה
  count: number; // מספר יחידות (מכפיל)
  coefficient: number; // מקדם
  unit: Unit;
  note: string;
  kind: RowKind; // רגיל / הפחתה
  measuredValue?: number; // ערך נטו שנמדד מהתוכנית (לאורך/שטח שנמדדו)
  measuredGross?: number; // שטח ברוטו לפני ניכויים (cut-out)
  measuredDeductions?: number[]; // ניכויי שטח (cut-out) ביחידות מ״ר, לתצוגת הנוסחה
  annotation?: AnnotationGeometry; // גאומטריית הסימון לשכבה קבועה על התוכנית
  cropDataUrl?: string; // תצלום חתוך של אזור המדידה (לביקורת בדוח)
  createdAt: number;
}

/** סוג צורת הסימון על התוכנית */
export type AnnotationShape = 'length' | 'area' | 'count';

/** גאומטריית סימון השמורה בקואורדינטות התמונה הטבעיות (פיקסלים) */
export interface AnnotationGeometry {
  pageId: string; // העמוד שעליו בוצעה המדידה
  shape: AnnotationShape;
  points: { x: number; y: number }[];
  holes?: { x: number; y: number }[][]; // פוליגוני ניכוי (cut-out) בתוך השטח
}

/** סעיף בספריית הסעיפים */
export interface Section {
  id: string;
  code: string; // קוד סעיף, לדוגמה 01.01.001
  name: string; // שם הסעיף
  unit: Unit;
  description: string;
}

/** הגדרת קנה מידה לעמוד */
export interface PageScale {
  pixelsPerMeter: number; // פיקסלים למטר
  refPixels: number; // אורך הקו שנמדד בפיקסלים
  refMeters: number; // האורך האמיתי שהוזן
}

/** עמוד תוכנית טעון (PDF עמוד או תמונה) */
export interface PlanPage {
  id: string;
  name: string; // שם להצגה
  kind: 'image' | 'pdf';
  dataUrl?: string; // עבור תמונה
  pdfDataUrl?: string; // עבור PDF (כל הקובץ)
  pdfPageNumber?: number; // מספר העמוד בתוך ה-PDF
  scale?: PageScale; // קנה מידה לעמוד זה
}

/** הפרויקט המלא */
export interface Project {
  id: string;
  // פרטי פרויקט
  name: string;
  client: string; // שם מזמין
  contractor: string; // שם קבלן
  date: string;
  projectNumber: string;
  preparedBy: string; // שם מכין החישוב
  notes: string;
  // נתונים
  sections: Section[];
  rows: CalcRow[];
  pages: PlanPage[];
  // מטא
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
}

/** פריט ברשימת הפרויקטים השמורים */
export interface ProjectSummary {
  id: string;
  name: string;
  projectNumber: string;
  updatedAt: number;
}

export const SCHEMA_VERSION = 1;

/** מטא-דאטה לכל סוגי החישוב */
export const CALC_TYPES: CalcTypeMeta[] = [
  {
    type: 'length',
    label: 'אורך',
    unit: 'מ׳',
    fields: ['length'],
    fieldLabels: { length: 'אורך' },
  },
  {
    type: 'rect_area',
    label: 'שטח מלבן',
    unit: 'מ״ר',
    fields: ['length', 'width'],
    fieldLabels: { length: 'אורך', width: 'רוחב' },
  },
  {
    type: 'triangle_area',
    label: 'שטח משולש',
    unit: 'מ״ר',
    fields: ['length', 'width'],
    fieldLabels: { length: 'בסיס', width: 'גובה' },
  },
  {
    type: 'trapezoid_area',
    label: 'שטח טרפז',
    unit: 'מ״ר',
    fields: ['length', 'width', 'height'],
    fieldLabels: { length: 'בסיס עליון', width: 'בסיס תחתון', height: 'גובה' },
  },
  {
    type: 'circle_area',
    label: 'שטח עיגול',
    unit: 'מ״ר',
    fields: ['length'],
    fieldLabels: { length: 'רדיוס' },
  },
  {
    type: 'box_volume',
    label: 'נפח תיבה',
    unit: 'מ״ק',
    fields: ['length', 'width', 'height'],
    fieldLabels: { length: 'אורך', width: 'רוחב', height: 'גובה' },
  },
  {
    type: 'cylinder_volume',
    label: 'נפח גליל',
    unit: 'מ״ק',
    fields: ['length', 'height'],
    fieldLabels: { length: 'רדיוס', height: 'גובה' },
  },
  {
    type: 'count',
    label: 'ספירת יחידות',
    unit: 'יח׳',
    fields: [],
    fieldLabels: {},
  },
  {
    type: 'measured_length',
    label: 'אורך מהתוכנית',
    unit: 'מ׳',
    fields: [],
    fieldLabels: {},
    fromPlanOnly: true,
  },
  {
    type: 'measured_area',
    label: 'שטח מהתוכנית',
    unit: 'מ״ר',
    fields: [],
    fieldLabels: {},
    fromPlanOnly: true,
  },
];

export function calcTypeMeta(type: CalcType): CalcTypeMeta {
  return CALC_TYPES.find((c) => c.type === type) ?? CALC_TYPES[0];
}
