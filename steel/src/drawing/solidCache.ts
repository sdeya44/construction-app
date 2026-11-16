import { memberSolid, type Solid } from '../geometry/solid';
import type { Member } from '../model/types';

const cache = new Map<string, Solid>();
/** מטמון מוצקים ללא תלות במנוע התצוגה (לשימוש בשרטוטים ובבדיקות). */
export function cachedSolidPure(m: Member): Solid {
  const k = JSON.stringify([m.start, m.end, m.profile, m.rollDeg, m.mirror, m.anchor, m.refUp, m.startCut, m.endCut, m.snip]);
  let s = cache.get(k);
  if (!s) { s = memberSolid(m); if (cache.size > 60000) cache.clear(); cache.set(k, s); }
  return s;
}

export function clearPureCache() { cache.clear(); }

/**
 * קווי צללית של אלמנט מנסרתי בהיטל נתון: שני הקודקודים הקיצוניים בניצב לציר המוטל, מטבעת ההתחלה לטבעת הסוף.
 * נדרש לחתכים עם פינות מעוגלות (RHS/CHS/צינור) שאין להם קווי שבירה אורכיים.
 */
export function silhouetteEdges(m: Member, proj: (q: { x: number; y: number; z: number }) => { x: number; y: number }): [number, number][] {
  const s = cachedSolidPure(m);
  const n = s.startRing.length;
  if (n < 3 || s.endRing.length !== n) return [];
  const ps = s.startRing.map(proj), pe = s.endRing.map(proj);
  const cS = ps.reduce((a, q) => ({ x: a.x + q.x / n, y: a.y + q.y / n }), { x: 0, y: 0 });
  const cE = pe.reduce((a, q) => ({ x: a.x + q.x / n, y: a.y + q.y / n }), { x: 0, y: 0 });
  const dx = cE.x - cS.x, dy = cE.y - cS.y, L = Math.hypot(dx, dy);
  if (L < 1e-6) return [];
  const px = -dy / L, py = dx / L;
  let iMin = 0, iMax = 0, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < n; i++) { const v = (ps[i].x - cS.x) * px + (ps[i].y - cS.y) * py; if (v < vMin) { vMin = v; iMin = i; } if (v > vMax) { vMax = v; iMax = i; } }
  return [[iMin, iMin], [iMax, iMax]];
}
