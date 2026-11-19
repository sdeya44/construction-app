import type { DerivedModel, Member, Project } from '../model/types';
import type { Fabrication } from './marks';

/**
 * מיקום הרכבה קריא של אלמנט (1.36): "ציר 2 / א" לעמוד, "מסגרת 3 · שיפוע L" לקורת גג,
 * "מפתח 2–3 · פטה 4 (L)" לפטה וכו'. מבוסס על המסגרות (מספור 1..n לאורך Y) ותוויות צירי העמודים.
 */
export function memberLocation(m: Member, p: Project, d: DerivedModel): string {
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const lines = [...(d.section?.lines ?? [])].sort((a, b) => a.x - b.x);
  const fIdx = (id?: string) => (id ? fr.findIndex((f) => f.id === id) + 1 : 0);
  const lineAt = (x: number) => lines.find((l) => Math.abs(l.x - x) < 150);
  const lab = (lid?: string) => lines.find((l) => l.id === lid)?.label ?? lid ?? '';
  const midY = (m.start.y + m.end.y) / 2, midX = (m.start.x + m.end.x) / 2;
  const bay = () => {
    for (let i = 0; i < fr.length - 1; i++) if (midY >= fr[i].y - 1 && midY <= fr[i + 1].y + 1) return `מפתח ${i + 1}–${i + 2}`;
    return midY < (fr[0]?.y ?? 0) ? 'לפני מסגרת 1' : `אחרי מסגרת ${fr.length}`;
  };
  const span = () => {
    const xs = [m.start.x, m.end.x].sort((a, b) => a - b);
    for (let i = 0; i < lines.length - 1; i++) if (midX >= lines[i].x - 1 && midX <= lines[i + 1].x + 1) return `${lines[i].label}–${lines[i + 1].label}`;
    return xs[0] < (lines[0]?.x ?? 0) ? `קונזולה ${lines[0]?.label ?? ''}` : `קונזולה ${lines[lines.length - 1]?.label ?? ''}`;
  };
  const lineOf = () => m.lineId ? lab(m.lineId) : (m.id.match(/\.COL\.([^.]+)$/)?.[1] ? lab(m.id.match(/\.COL\.([^.]+)$/)![1]) : lineAt(midX)?.label);
  switch (m.kind) {
    case 'column': return `ציר ${fIdx(m.frameId) || '?'} / ${lineOf() ?? '?'}`;
    case 'rafter': return `מסגרת ${fIdx(m.frameId) || '?'} · ${span()}`;
    case 'purlin': return `${bay()} · פטה ${m.purlin?.index ?? ''} (${m.purlin?.side ?? ''})`;
    default: {
      if (m.frameId) return `מסגרת ${fIdx(m.frameId)}${lineOf() ? ` · ציר ${lineOf()}` : ` · ${span()}`}`;
      const l = lineOf();
      if (l && Math.abs(m.start.x - m.end.x) < 300) return `קיר ציר ${l} · ${bay()}`;
      return `${bay()} · ${span()}`;
    }
  }
}

/** מיקום לכל מופע של מכלול: מפתח = מזהה המכלול */
export function assemblyLocations(p: Project, d: DerivedModel, fab: Fabrication): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of fab.assemblies) {
    const part = fab.byPart.get(a.main);
    const m = part ? d.byId.get(part.memberId) : undefined;
    if (m) out.set(a.id, memberLocation(m, p, d));
  }
  return out;
}
