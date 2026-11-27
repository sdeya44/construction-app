/**
 * מועדפים וחיפוש לאשף החיבורים (UI בלבד). המועדפים הם העדפת משתמש בדפדפן (localStorage),
 * לא חלק מהפרויקט: אינם משנים את המודל, את הייצוא או את הגרסאות.
 */
export const FAV_KEY = 'ksp-conn-fav';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const ls = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function loadFavs(st: Store | null = ls()): Set<string> {
  try {
    const raw = st?.getItem(FAV_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}

export function saveFavs(f: Set<string>, st: Store | null = ls()): void {
  try { st?.setItem(FAV_KEY, JSON.stringify([...f])); } catch { /* אחסון חסום — המועדפים נשמרים רק לסשן */ }
}

export function toggleFav(f: Set<string>, id: string): Set<string> {
  const n = new Set(f);
  if (n.has(id)) n.delete(id); else n.add(id);
  return n;
}

export interface Searchable { id: string; title: string; desc: string; fit: { status: string; reason?: string } }

/** חיפוש חופשי (כל המילים חייבות להופיע בכותרת/תיאור/סיבת ההתאמה); מועדפים ראשונים, השאר בסדר המקורי */
export function filterCands<T extends Searchable>(cands: T[], q: string, favs: Set<string>): T[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (c: T) => { const hay = `${c.title} ${c.desc} ${c.fit.reason ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); };
  const kept = cands.filter(hit);
  return [...kept.filter((c) => favs.has(c.id)), ...kept.filter((c) => !favs.has(c.id))];
}
