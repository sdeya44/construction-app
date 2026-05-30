// ============================================================================
// יצירת פרויקטים חדשים ופרויקט דוגמה
// ============================================================================

import type { CalcRow, Project, Section } from '../types';
import { SCHEMA_VERSION } from '../types';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function createEmptyProject(meta?: Partial<Project>): Project {
  const now = Date.now();
  return {
    id: uid('prj'),
    name: meta?.name ?? 'פרויקט חדש',
    client: meta?.client ?? '',
    contractor: meta?.contractor ?? '',
    date: meta?.date ?? today(),
    projectNumber: meta?.projectNumber ?? '',
    preparedBy: meta?.preparedBy ?? '',
    notes: meta?.notes ?? '',
    sections: [],
    rows: [],
    pages: [],
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };
}

/** פרויקט דוגמה מוכן לבדיקה - עם סעיפים ושורות חישוב לדוגמה */
export function createSampleProject(): Project {
  const p = createEmptyProject({
    name: 'מבנה מגורים - בניין א׳ (דוגמה)',
    client: 'עיריית באר שבע',
    contractor: 'חברת הבנייה בע״מ',
    projectNumber: '2026-104',
    preparedBy: 'מהנדס/מכין החישוב',
    notes: 'פרויקט דוגמה להמחשת המערכת. ניתן לערוך, למחוק או למחוק את כל הפרויקט ולהתחיל מחדש.',
  });

  const sections: Section[] = [
    { id: uid('sec'), code: '01.01.001', name: 'עבודות חפירה', unit: 'מ״ק', description: 'חפירה כללית לתשתית' },
    { id: uid('sec'), code: '02.01.010', name: 'בטון ב-30', unit: 'מ״ק', description: 'יציקת בטון מזוין ב-30' },
    { id: uid('sec'), code: '03.02.020', name: 'ריצוף', unit: 'מ״ר', description: 'ריצוף גרניט פורצלן' },
    { id: uid('sec'), code: '04.01.005', name: 'קירות בלוקים', unit: 'מ״ר', description: 'קירות בלוק איטונג 20 ס״מ' },
  ];

  const [excav, concrete, floor, walls] = sections;

  const mk = (r: Partial<CalcRow>): CalcRow => ({
    id: uid('row'),
    sectionId: null,
    description: '',
    page: '',
    type: 'box_volume',
    length: null,
    width: null,
    height: null,
    count: 1,
    coefficient: 1,
    unit: 'מ״ק',
    note: '',
    kind: 'normal',
    createdAt: Date.now(),
    ...r,
  });

  const rows: CalcRow[] = [
    mk({
      sectionId: excav.id, description: 'חפירת יסודות - אזור צפוני', page: 'תכנית יסודות',
      type: 'box_volume', length: 24.5, width: 1.2, height: 0.8, count: 1, unit: 'מ״ק',
      note: 'לפי חתך 1-1',
    }),
    mk({
      sectionId: excav.id, description: 'חפירת בור מעלית', page: 'תכנית יסודות',
      type: 'box_volume', length: 2.6, width: 2.4, height: 1.8, count: 1, unit: 'מ״ק',
    }),
    mk({
      sectionId: concrete.id, description: 'קיר בטון ציר A', page: 'קומה 1',
      type: 'box_volume', length: 12.4, width: 0.2, height: 3.0, count: 2, unit: 'מ״ק',
      note: 'שני קירות זהים',
    }),
    mk({
      sectionId: concrete.id, description: 'עמודים 40/40', page: 'קומה 1',
      type: 'box_volume', length: 0.4, width: 0.4, height: 3.2, count: 6, unit: 'מ״ק',
    }),
    mk({
      sectionId: floor.id, description: 'ריצוף סלון + מטבח', page: 'תכנית ריצוף',
      type: 'rect_area', length: 6.2, width: 4.8, count: 1, unit: 'מ״ר',
    }),
    mk({
      sectionId: floor.id, description: 'ניכוי עמוד מרכזי', page: 'תכנית ריצוף',
      type: 'rect_area', length: 0.4, width: 0.4, count: 1, unit: 'מ״ר', kind: 'deduction',
      note: 'הפחתה - שטח עמוד',
    }),
    mk({
      sectionId: walls.id, description: 'קיר חיצוני חזית דרום', page: 'חזיתות',
      type: 'rect_area', length: 11.5, width: 2.9, count: 1, unit: 'מ״ר',
    }),
    mk({
      sectionId: walls.id, description: 'ניכוי פתחי חלונות', page: 'חזיתות',
      type: 'rect_area', length: 1.4, width: 1.2, count: 3, unit: 'מ״ר', kind: 'deduction',
      note: '3 חלונות זהים',
    }),
  ];

  p.sections = sections;
  p.rows = rows;
  return p;
}
