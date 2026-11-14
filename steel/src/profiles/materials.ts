/**
 * חומרים. צפיפות פלדה 7850 ק"ג/מ"ק היא ערך מקובל (EN 1991-1-1 נספח A).
 * גבולות כניעה לפי EN 10025-2 לעובי עד 16 מ"מ — לא מאומתים מול תעודת יצרן,
 * ואינם משמשים לחישוב כלשהו בגרסה זו.
 */
export interface Material {
  id: string;
  name: string;
  density: number; // kg/m³
  fy?: number;     // MPa, מידע בלבד
  verified: false;
}

export const MATERIALS: Material[] = [
  { id: 'S235', name: 'S235JR', density: 7850, fy: 235, verified: false },
  { id: 'S275', name: 'S275JR', density: 7850, fy: 275, verified: false },
  { id: 'S355', name: 'S355J2', density: 7850, fy: 355, verified: false },
];

export function getMaterial(id: string): Material {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`חומר לא מוכר: ${id}`);
  return m;
}
