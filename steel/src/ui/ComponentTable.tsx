import { useMemo, useState } from 'react';
import type { Member } from '../model/types';
import { store, useStore } from '../store';
import { massPerMeter, tryProfile } from '../profiles/library';
import { assemblyOf, FAM_NAME } from './AssemblyCard';

/**
 * טבלת מופעים לרכיב (1.53): כל המכלולים של הרכיב בשורות — מיקום, סוג, חתכים, חלקים ומשקל.
 * ריחוף על שורה מדגיש בכתום במודל; לחיצה בוחרת את המכלול ומתמקדת בו (ומשם — חלון האלמנט עם כל האפשרויות).
 */
export function ComponentTable({ match, testId }: { match: RegExp; testId: string }) {
  const d = useStore((s) => s.derived);
  const [hover, setHover] = useState<string | null>(null);
  const rows = useMemo(() => {
    const by = new Map<string, { title: string; fam: string; ids: string[]; main: Member }>();
    for (const m of d.members) {
      if (!match.test(m.id) || m.kind === 'plate' || m.kind === 'bolt' || m.kind === 'cleat') continue;
      const a = assemblyOf(m, d);
      const key = a?.title ?? m.id;
      const r = by.get(key) ?? { title: a ? (a.title.split(' — ')[1] ?? a.title) : m.label, fam: a ? FAM_NAME[a.family] : m.label, ids: [], main: m };
      r.ids.push(m.id); by.set(key, r);
    }
    const dens = 7850;
    return [...by.values()].map((r) => {
      const ms = r.ids.map((i) => d.byId.get(i)!).filter(Boolean);
      const profs = [...new Set(ms.map((x) => x.profile))];
      const kg = ms.reduce((a, x) => { const p = tryProfile(x.profile); const L = Math.hypot(x.end.x - x.start.x, x.end.y - x.start.y, x.end.z - x.start.z) / 1000; return a + (p ? massPerMeter(p, dens) * L : 0); }, 0);
      return { ...r, profs, n: ms.length, kg };
    }).sort((a, b) => a.title.localeCompare(b.title, 'he', { numeric: true }));
  }, [d, match]);
  const total = rows.reduce((a, r) => a + r.kg, 0);
  const hi = (ids: string[] | null) => store.set({ scopeHi: ids });
  if (!rows.length) return <div className="hint">אין מופעים לרכיב הזה במודל.</div>;
  return (
    <div className="ctab-wrap" data-testid={testId}>
      <table className="ctab">
        <thead><tr><th>מיקום</th><th>סוג</th><th>חתכים</th><th className="n">חלקים</th><th className="n">ק"ג</th></tr></thead>
        <tbody onMouseLeave={() => { setHover(null); hi(null); }}>
          {rows.map((r, i) => (
            <tr key={r.title + i} className={hover === r.title ? 'on' : ''} data-testid={`${testId}-row-${i}`}
              onMouseEnter={() => { setHover(r.title); hi(r.ids); }}
              onClick={() => { hi(null); store.select([r.main.id]); setTimeout(() => (window as unknown as { __ksp?: { viewport?: { focusIds?: (x: string[], p?: number) => void } } }).__ksp?.viewport?.focusIds?.(r.ids, 600), 40); }}>
              <td>{r.title}</td><td>{r.fam}</td><td className="mono">{r.profs.join(' · ')}</td><td className="n">{r.n}</td><td className="n">{r.kg.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={3}>{rows.length} מכלולים</td><td className="n">{rows.reduce((a, r) => a + r.n, 0)}</td><td className="n">{total.toFixed(0)}</td></tr></tfoot>
      </table>
      <div className="hint">ריחוף על שורה — הדגשה במודל · לחיצה — בחירה והתמקדות (משם: שינוי סוג, חתך ופרט).</div>
    </div>
  );
}
