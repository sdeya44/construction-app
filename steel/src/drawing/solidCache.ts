import { memberSolid, type Solid } from '../geometry/solid';
import type { Member } from '../model/types';

const cache = new Map<string, Solid>();
/** מטמון מוצקים ללא תלות במנוע התצוגה (לשימוש בשרטוטים ובבדיקות). */
export function cachedSolidPure(m: Member): Solid {
  const k = JSON.stringify([m.start, m.end, m.profile, m.rollDeg, m.mirror, m.anchor, m.refUp, m.startCut, m.endCut]);
  let s = cache.get(k);
  if (!s) { s = memberSolid(m); if (cache.size > 60000) cache.clear(); cache.set(k, s); }
  return s;
}
