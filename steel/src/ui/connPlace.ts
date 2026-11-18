import type { Connection, Member } from '../model/types';

/** מיקום קריא של חיבור: "מסגרת 3 · ציר א · פטה 5 (שיפוע L)" — מהאלמנטים שהוא מחבר */
export function connPlace(c: Connection, d: { byId: Map<string, Member>; section?: { lines: { id: string; label: string }[] } }, frames: { id: string; y: number }[]): string {
  const fr = [...frames].sort((a, b) => a.y - b.y);
  const parts: string[] = [];
  const add = (x: string) => { if (x && !parts.includes(x)) parts.push(x); };
  for (const id of c.members) {
    const m = d.byId.get(id);
    if (!m) continue;
    if (m.frameId) { const i = fr.findIndex((f) => f.id === m.frameId); if (i >= 0) add(`מסגרת ${i + 1}`); }
    const lid = m.lineId ?? id.match(/\.COL\.([^.]+)$/)?.[1];
    if (lid) { const l = d.section?.lines.find((q) => q.id === lid); add(`ציר ${l?.label ?? lid}`); }
    if (m.purlin) add(`פטה ${m.purlin.index} (שיפוע ${m.purlin.side})`);
  }
  return parts.join(' · ') || c.label;
}

