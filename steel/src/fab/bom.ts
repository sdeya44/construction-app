import type { DerivedModel, Project } from '../model/types';
import type { Fabrication } from './marks';

export interface ProfileRow { profile: string; material: string; count: number; length: number; weight: number }
export interface PartRow { mark: string; kind: string; desc: string; profile: string; material: string; length: number; qty: number; unitWeight: number; weight: number; holes: number; provisional: boolean }
export interface AssemblyRow { mark: string; main: string; qty: number; parts: number; unitWeight: number; weight: number }
export interface BoltRow { desc: string; d: number; length: number; grade: string; standard: string; location: string; qty: number; nuts: number; washers: number }
export interface WeldRow { a: number; location: string; count: number; length: number }
export interface Bom { profiles: ProfileRow[]; parts: PartRow[]; assemblies: AssemblyRow[]; bolts: BoltRow[]; welds: WeldRow[]; totalWeight: number }

const num = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** כתב כמויות נגזר מהמודל: חתכים, חלקים לפי סימון, מכלולים, ברגים וריתוכים. */
export function computeBom(d: DerivedModel, fab: Fabrication): Bom {
  const prof = new Map<string, ProfileRow>();
  const parts = new Map<string, PartRow>();
  for (const p of fab.parts) {
    const k = `${p.profile}|${p.material}`;
    const r = prof.get(k) ?? { profile: p.profile, material: p.material, count: 0, length: 0, weight: 0 };
    r.count++; r.length += p.length; r.weight += p.weight; prof.set(k, r);
    const q = parts.get(p.mark) ?? { mark: p.mark, kind: p.kind, desc: p.desc, profile: p.profile, material: p.material, length: p.length, qty: 0, unitWeight: p.weight, weight: 0, holes: p.holes.length, provisional: p.provisional };
    q.qty++; q.weight += p.weight; parts.set(p.mark, q);
  }
  const asm = new Map<string, AssemblyRow>();
  for (const a of fab.assemblies) {
    const r = asm.get(a.mark) ?? { mark: a.mark, main: fab.byPart.get(a.main)?.mark ?? '', qty: 0, parts: a.parts.length, unitWeight: a.weight, weight: 0 };
    r.qty++; r.weight += a.weight; asm.set(a.mark, r);
  }
  const bolts = new Map<string, BoltRow>();
  const welds = new Map<string, WeldRow>();
  for (const c of d.connections) {
    for (const b of c.bolts) {
      const anchor = b.standard !== 'ISO 4017';
      const desc = anchor ? `בורג עיגון M${b.d}×${b.length}` : `M${b.d}×${b.length}`;
      const k = `${desc}|${b.grade}|${b.location}`;
      const r = bolts.get(k) ?? { desc, d: b.d, length: b.length, grade: b.grade, standard: b.standard, location: b.location, qty: 0, nuts: 0, washers: 0 };
      r.qty++; r.nuts++; r.washers += anchor ? 1 : 2; bolts.set(k, r);
    }
    for (const w of c.welds) {
      const k = `${w.a}|${w.location}`;
      const r = welds.get(k) ?? { a: w.a, location: w.location, count: 0, length: 0 };
      r.count++; r.length += w.length; welds.set(k, r);
    }
  }
  const profiles = [...prof.values()].sort((a, b) => num(a.profile, b.profile));
  return {
    profiles,
    parts: [...parts.values()].sort((a, b) => num(a.mark, b.mark)),
    assemblies: [...asm.values()].sort((a, b) => num(a.mark, b.mark)),
    bolts: [...bolts.values()].sort((a, b) => a.d - b.d || a.length - b.length),
    welds: [...welds.values()].sort((a, b) => a.a - b.a),
    totalWeight: profiles.reduce((s, r) => s + r.weight, 0),
  };
}

// ---------------- אופטימיזציית חיתוך ----------------

export interface Bar { stock: number; cuts: { mark: string; length: number }[]; used: number; waste: number }
export interface CutPlan { profile: string; material: string; bars: Bar[]; stockTotal: number; partsTotal: number; kerfTotal: number; waste: number; utilization: number; tooLong: { mark: string; length: number }[] }

/**
 * חלוקה לאורכי חומר גלם: First-Fit-Decreasing על כל אורכי המלאי המותרים, בחירת המוט הקצר ביותר
 * שמכיל את החלק. כל חיתוך מוסיף רוחב להב (קרף). הנחות: ללא שוליים בקצוות, ללא ניצול שאריות מפרויקטים אחרים.
 * פלטות, זוויתנים קצרים ומוטות עיגון נכללים לפי חתך; פלטות אינן מקוננות בגיליון.
 */
export function cutPlans(fab: Fabrication, project: Project): CutPlan[] {
  const kerf = project.settings.kerf;
  const stocks = [...new Set([...(project.settings.stockLengths ?? []), project.settings.stockLength])].filter((x) => x > 0).sort((a, b) => a - b);
  const maxStock = Math.max(...stocks);
  const groups = new Map<string, { mark: string; length: number }[]>();
  for (const p of fab.parts) {
    if (p.kind === 'plate') continue;
    const k = `${p.profile}|${p.material}`;
    groups.set(k, [...(groups.get(k) ?? []), { mark: p.mark, length: p.length }]);
  }
  const plans: CutPlan[] = [];
  for (const [k, items] of [...groups.entries()].sort()) {
    const [profile, material] = k.split('|');
    const tooLong = items.filter((x) => x.length > maxStock);
    const todo = items.filter((x) => x.length <= maxStock).sort((a, b) => b.length - a.length || a.mark.localeCompare(b.mark));
    const bars: Bar[] = [];
    for (const it of todo) {
      const need = it.length + kerf;
      let bar = bars.filter((b) => b.stock - b.used >= it.length && b.stock - b.used - it.length >= 0)
        .sort((a, b) => (a.stock - a.used) - (b.stock - b.used))[0];
      if (!bar) {
        const st = stocks.find((s) => s >= it.length)!;
        bar = { stock: st, cuts: [], used: 0, waste: 0 };
        bars.push(bar);
      }
      bar.cuts.push(it);
      bar.used = Math.min(bar.stock, bar.used + need);
    }
    for (const b of bars) {
      const parts = b.cuts.reduce((s, c) => s + c.length, 0);
      b.waste = b.stock - parts;
    }
    const stockTotal = bars.reduce((s, b) => s + b.stock, 0);
    const partsTotal = todo.reduce((s, x) => s + x.length, 0);
    const kerfTotal = bars.reduce((s, b) => s + Math.max(0, b.cuts.length - (b.used >= b.stock ? 1 : 0)) * kerf, 0);
    plans.push({ profile, material, bars, stockTotal, partsTotal, kerfTotal, waste: stockTotal - partsTotal, utilization: stockTotal ? partsTotal / stockTotal : 0, tooLong });
  }
  return plans;
}
