import { useEffect, useState, type ReactNode } from 'react';
import { generate } from '../geometry/generate';
import { defaultKneeBraces } from '../geometry/knee';
import { defaultLockTruss } from '../geometry/lockTruss';
import { defaultPortal } from '../geometry/portal';
import type { Project } from '../model/types';
import { kneeSet, renderThumb, wallSet, type RealSet } from '../view/realView';

/**
 * 1.55: תמונה ריאליסטית באריח בחירה — מרונדרת מהמודל עצמו בגרסה עם האפשרות של האריח
 * (למשל: אותו מבנה עם אגד B במקום קושרות X). עד שהתמונה מוכנה — הציור הקיים.
 * הרינדור בתור (אחד בכל פעם), כדי לא לעכב את הממשק.
 */
const queue: (() => void)[] = [];
let busy = false;
function pump() {
  if (busy) return;
  const f = queue.shift(); if (!f) return;
  busy = true;
  setTimeout(() => { try { f(); } finally { busy = false; pump(); } }, 30);
}
const done = new Map<string, string>();

function hash(s: string) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

export function RealPic({ id, make, fallback, alt }: { id: string; make: () => RealSet | null; fallback: ReactNode; alt: string }) {
  const [url, setUrl] = useState<string | null>(() => done.get(id) ?? null);
  useEffect(() => {
    const hit = done.get(id); if (hit) { setUrl(hit); return; }
    let alive = true;
    queue.push(() => {
      if (!alive) return;
      const s = make(); if (!s) return;
      const u = renderThumb({ ...s, key: id }, 360, 240);
      if (u) { done.set(id, u); if (done.size > 60) done.delete(done.keys().next().value as string); }
      if (alive && u) setUrl(u);
    });
    pump();
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return url ? <img className="real-pic" src={url} alt={alt} data-real="1" /> : <>{fallback}</>;
}

// ---------- גרסאות למודל ----------
const geomKey = (p: Project) => { const b = p.building; return JSON.stringify([b.frames.map((f) => f.y), b.width, b.eaveLeft, b.eaveRight, b.columnProfile, b.rafterProfile, b.roofType, b.section ? 1 : 0]); };

export function wallTypeThumb(p: Project, k: 'x' | 'portal' | 'truss'): { id: string; make: () => RealSet | null } {
  const w = p.building.bracing.walls;
  const id = `walls|${k}|${hash(geomKey(p) + JSON.stringify([w.profile, w.portal, w.truss, w.left, w.right, w.byLine]))}`;
  return {
    id, make: () => {
      const q: Project = structuredClone(p);
      const ww = q.building.bracing.walls;
      ww.enabled = true; ww.type = k; ww.lineType = undefined; ww.portal ??= defaultPortal(); ww.truss ??= defaultLockTruss();
      const d = generate(q);
      return wallSet(q, d, {});
    },
  };
}

export function kneeDetailThumb(p: Project, detail: 'fin' | 'angle' | 'flange'): { id: string; make: () => RealSet | null } {
  const kb = p.building.kneeBraces ?? defaultKneeBraces();
  const id = `knee|${detail}|${hash(geomKey(p) + JSON.stringify({ ...kb, detail: undefined, sides: undefined, exclude: undefined }))}`;
  return {
    id, make: () => {
      const q: Project = structuredClone(p);
      q.building.kneeBraces = { ...(q.building.kneeBraces ?? defaultKneeBraces()), enabled: true, detail, sides: undefined, exclude: [] };
      const d = generate(q);
      const s = kneeSet(q, d, {});
      return s ? { ...s, tags: [] } : null;
    },
  };
}
