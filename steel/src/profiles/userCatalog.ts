/**
 * קטלוג חתכים מאומת של המשתמש (מיובא מ-Excel/CSV). כאשר קיימת שורה לחתך — מידות הגיאומטריה ותכונות
 * החתך נלקחות מהטבלה והחתך מסומן "מאומת" עם שם המקור. ללא שורה — חישוב גיאומטרי, "לא מאומת".
 * יחידות פנימיות: mm, mm², mm⁴, mm³, ק"ג/מ'.
 */
export interface CatalogRow {
  name: string;          // שם מנורמל, לדוגמה IPE200
  h?: number; b?: number; tw?: number; tf?: number; r?: number; t?: number;
  A?: number; mass?: number; Iy?: number; Iz?: number; Wy?: number; Wz?: number; iy?: number; iz?: number;
}
export interface UserCatalog { source: string; importedAt: string; rows: CatalogRow[] }

let current: UserCatalog | null = null;
let index = new Map<string, CatalogRow>();
const listeners = new Set<() => void>();

export function setUserCatalog(c: UserCatalog | null) {
  current = c;
  index = new Map((c?.rows ?? []).map((r) => [r.name, r]));
  for (const l of listeners) l();
}
export const getUserCatalog = () => current;
export const catalogRow = (name: string) => index.get(name);
export const onCatalogChange = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
