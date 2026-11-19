import type { BoltInfo, DerivedModel } from '../model/types';
import type { Fabrication } from './marks';

/** קבוצת אורכי ברגים שאפשר לאחד לאורך אחד (הארוך בקבוצה — תמיד בצד הבטוח) */
export interface BoltGroup { d: number; grade: string; standard: string; lengths: { length: number; qty: number }[]; to: number }
/** חלקים כמעט־זהים: אותו חתך, חומר, סוג ומספר חורים, אורך שונה עד הסף */
export interface PartGroup { profile: string; material: string; marks: { mark: string; length: number; qty: number }[]; diff: number; note: string }

const isNormal = (b: BoltInfo) => !b.rod && b.standard === 'ISO 4017';

/** אשכולות אורכים לכל קוטר/דרגה: אורך נכנס לאשכול כל עוד ההפרש מהקצר באשכול ≤ tol */
export function boltGroups(d: DerivedModel, tol: number): BoltGroup[] {
  const by = new Map<string, Map<number, number>>();
  for (const c of d.connections) for (const b of c.bolts) {
    if (!isNormal(b)) continue;
    const k = `${b.d}|${b.grade}|${b.standard}`;
    const m = by.get(k) ?? new Map<number, number>();
    m.set(b.length, (m.get(b.length) ?? 0) + 1); by.set(k, m);
  }
  const out: BoltGroup[] = [];
  for (const [k, m] of by) {
    const [dd, grade, standard] = k.split('|');
    const ls = [...m.entries()].sort((a, b) => a[0] - b[0]);
    let cur: [number, number][] = [];
    const flush = () => { if (cur.length > 1) out.push({ d: +dd, grade, standard, lengths: cur.map(([length, qty]) => ({ length, qty })), to: cur[cur.length - 1][0] }); cur = []; };
    for (const e of ls) { if (cur.length && e[0] - cur[0][0] > tol) flush(); cur.push(e); }
    flush();
  }
  return out.sort((a, b) => a.d - b.d || a.to - b.to);
}

/** מאחד אורכי ברגים במודל (במקום): כל בורג מקבל את האורך הארוך באשכול שלו */
export function unifyBolts(d: DerivedModel, tol: number | undefined): DerivedModel {
  if (!tol || tol <= 0) return d;
  const map = new Map<string, number>();
  for (const g of boltGroups(d, tol)) for (const l of g.lengths) map.set(`${g.d}|${g.grade}|${g.standard}|${l.length}`, g.to);
  if (!map.size) return d;
  for (const c of d.connections) for (const b of c.bolts) {
    if (!isNormal(b)) continue;
    const to = map.get(`${b.d}|${b.grade}|${b.standard}|${b.length}`);
    if (to) b.length = to;
  }
  return d;
}

/** הצעות האחדה לחלקים: חלקים באותו חתך וחומר שאורכם שונה עד tol מ"מ ומספר החורים זהה */
export function partGroups(fab: Fabrication, tol: number): PartGroup[] {
  const marks = new Map<string, { mark: string; profile: string; material: string; kind: string; length: number; holes: number; qty: number }>();
  for (const p of fab.parts) {
    if (p.kind === 'plate') continue;
    const r = marks.get(p.mark) ?? { mark: p.mark, profile: p.profile, material: p.material, kind: p.kind, length: Math.round(p.length), holes: p.holes.length, qty: 0 };
    r.qty++; marks.set(p.mark, r);
  }
  const by = new Map<string, typeof marks extends Map<string, infer V> ? V[] : never>();
  for (const r of marks.values()) { const k = `${r.profile}|${r.material}|${r.kind}|${r.holes}`; by.set(k, [...(by.get(k) ?? []), r]); }
  const out: PartGroup[] = [];
  for (const rs of by.values()) {
    rs.sort((a, b) => a.length - b.length);
    let cur: typeof rs = [];
    const flush = () => {
      if (cur.length > 1) {
        const diff = cur[cur.length - 1].length - cur[0].length;
        out.push({ profile: cur[0].profile, material: cur[0].material, marks: cur.map((x) => ({ mark: x.mark, length: x.length, qty: x.qty })), diff,
          note: diff === 0 ? 'אורך זהה — ההבדל במיקום החורים או בחיתוך הקצוות; בדוק אם אפשר ליישר את פרט החיבור' : `הפרש אורך ${diff} מ"מ — אפשר לייצר באורך אחיד ולהשלים בפלטת קצה/מרווח` });
      }
      cur = [];
    };
    for (const r of rs) { if (cur.length && r.length - cur[0].length > tol) flush(); cur.push(r); }
    flush();
  }
  return out.sort((a, b) => b.marks.reduce((s, m) => s + m.qty, 0) - a.marks.reduce((s, m) => s + m.qty, 0));
}
