import type { Project } from '../model/types';

/**
 * "סטנדרט מסגריה": ערכי פלטות וחיבורים של המשתמש (עובי, ברגים, מרחקי שפה, מרווחים) — נשמרים במכשיר ומוחלים
 * אוטומטית על כל פרויקט חדש. אינם כוללים גיאומטריה של מבנה.
 */
const KEY = 'ksp-shop-standard';
export interface ShopStandard {
  savedAt: string;
  connectionDefaults: Project['connectionDefaults'];
  braceConn: Project['building']['bracing']['conn'];
  purlinSplice: Project['building']['purlins']['splice'];
  cleat: Project['building']['purlins']['left']['cleat'];
  knee?: Partial<NonNullable<Project['building']['kneeBraces']>>;
  portal?: Partial<NonNullable<Project['building']['bracing']['walls']['portal']>>;
}

export function captureStandard(p: Project): ShopStandard {
  const kb = p.building.kneeBraces, pt = p.building.bracing.walls.portal;
  return {
    savedAt: new Date().toISOString(),
    connectionDefaults: structuredClone(p.connectionDefaults),
    braceConn: structuredClone(p.building.bracing.conn),
    purlinSplice: structuredClone(p.building.purlins.splice),
    cleat: structuredClone(p.building.purlins.left.cleat),
    knee: kb ? { plateT: kb.plateT, plateW: kb.plateW, plateL: kb.plateL, bolt: kb.bolt, gauge: kb.gauge, pitch: kb.pitch, weldSize: kb.weldSize, boltsPerEnd: kb.boltsPerEnd, detail: kb.detail } : undefined,
    portal: pt ? { plateT: pt.plateT, bolt: pt.bolt, pitch: pt.pitch, weldSize: pt.weldSize, boltsPerEnd: pt.boltsPerEnd, beamBolts: pt.beamBolts } : undefined,
  };
}

export function saveStandard(p: Project): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(captureStandard(p))); return true; } catch { return false; }
}
export function loadStandard(): ShopStandard | null {
  try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as ShopStandard) : null; } catch { return null; }
}
export function clearStandard() { try { localStorage.removeItem(KEY); } catch { /* */ } }

/** החלת הסטנדרט על פרויקט (פרויקט חדש או לפי בקשה) */
export function applyStandard(p: Project, st: ShopStandard | null = loadStandard()): Project {
  if (!st) return p;
  const n = structuredClone(p);
  n.connectionDefaults = { ...n.connectionDefaults, ...structuredClone(st.connectionDefaults) };
  n.building.bracing.conn = { ...n.building.bracing.conn, ...st.braceConn };
  n.building.purlins.splice = { ...n.building.purlins.splice, ...st.purlinSplice };
  n.building.purlins.left.cleat = { ...n.building.purlins.left.cleat, ...st.cleat };
  n.building.purlins.right.cleat = { ...n.building.purlins.right.cleat, ...st.cleat };
  if (st.knee && n.building.kneeBraces) n.building.kneeBraces = { ...n.building.kneeBraces, ...st.knee };
  if (st.portal && n.building.bracing.walls.portal) n.building.bracing.walls.portal = { ...n.building.bracing.walls.portal, ...st.portal };
  return n;
}
