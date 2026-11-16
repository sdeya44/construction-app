import { add, dot, scale, sub, type Vec3 } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { memberSolid } from '../geometry/solid';
import { axialExtent } from '../geometry/parts';
import { getProfile, massPerMeter } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import type { DerivedModel, FabPart, Member, MemberKind, Project } from '../model/types';

/** חור בחלק: מיקום לאורך החלק (מתחילת החלק), קואורדינטה רוחבית על הפאה, קוטר, והפאה (ווב/אגף). */
export interface Hole { t: number; c: number; c2?: number; d: number; face: 'web' | 'flange' | 'section'; boltId: string }

export interface MarkedPart extends FabPart {
  mark: string;
  provisional: boolean;
  kind: MemberKind;
  desc: string;
  weight: number;   // ק"ג
  holes: Hole[];
  /** זוויות חיתוך קצה (מעלות מהניצב) */
  cutStart: number;
  cutEnd: number;
  assembly: string;   // מזהה מכלול
  signature: string;
}

export interface Assembly { id: string; mark: string; provisional: boolean; main: string; parts: string[]; weight: number; signature: string; kind: MemberKind }

export interface Fabrication { parts: MarkedPart[]; assemblies: Assembly[]; byPart: Map<string, MarkedPart>; changed: { id: string; from: string; to: string }[] }

const PREFIX: Record<MemberKind, string> = {
  column: 'c', rafter: 'r', beam: 'b', brace: 'br', purlin: 'p', girt: 'g', cleat: 'cl', plate: 'pl', bolt: 'x', anchor: 'a',
};
const APREFIX: Record<MemberKind, string> = {
  column: 'C', rafter: 'R', beam: 'B', brace: 'BR', purlin: 'P', girt: 'G', cleat: 'CL', plate: 'BP', bolt: 'X', anchor: 'A',
};

const r1 = (n: number) => (Math.round(n * 2) / 2).toFixed(1);

function cutAngle(m: Member, end: 'start' | 'end'): number {
  const f = localFrame(m);
  const pl = end === 'start' ? m.startCut : m.endCut;
  if (!pl) return 0;
  const c = Math.abs(dot(pl.normal, f.ex));
  return Math.round((Math.acos(Math.min(1, c)) * 180) / Math.PI * 10) / 10;
}

const boltIndex = new WeakMap<DerivedModel, Map<string, import('../model/types').BoltInfo[]>>();
function boltsThrough(d: DerivedModel, id: string) {
  let idx = boltIndex.get(d);
  if (!idx) {
    idx = new Map();
    for (const c of d.connections) for (const b of c.bolts) for (const h of b.holesIn) idx.set(h, [...(idx.get(h) ?? []), b]);
    boltIndex.set(d, idx);
  }
  return idx.get(id) ?? [];
}

const HOLLOW = new Set(['RHS', 'SHS', 'CHS']);
/** קוטר חור אוורור/ניקוז לגלוון לפי המידה הגדולה של החתך (הנחיה מקובלת, ISO 14713-2 — לאישור המגלוון) */
export function ventDia(D: number): number { return D <= 40 ? 10 : D <= 80 ? 12 : D <= 120 ? 16 : D <= 200 ? 20 : 25; }

export interface VentHole { p: Vec3; axis: Vec3; d: number; t: number; c: number; c2: number }
const ventCache = new WeakMap<DerivedModel, Map<string, VentHole[]>>();
/**
 * חורי אוורור/ניקוז לגלוון בפרופיל סגור (RHS/SHS/CHS) שקצהו אטום בפלטה מרותכת במסגריה:
 * שני חורים בכל קצה אטום, על פאות נגדיות ובפינות נגדיות (אוויר יוצא למעלה, אבץ מתנקז למטה).
 */
export function ventHoles(m: Member, d: DerivedModel): VentHole[] {
  let cache = ventCache.get(d);
  if (!cache) { cache = new Map(); ventCache.set(d, cache); }
  const hit = cache.get(m.id); if (hit) return hit;
  const out: VentHole[] = [];
  cache.set(m.id, out);
  const pr = getProfile(m.profile);
  if (!HOLLOW.has(pr.family) || m.kind === 'plate') return out;
  const f = localFrame(m);
  const { tMin, tMax } = axialExtent(m);
  const s = memberSolid(m);
  const cen = s.startRing.reduce((a, q) => add(a, q), { x: 0, y: 0, z: 0 } as Vec3);
  const c0 = scale(cen, 1 / Math.max(1, s.startRing.length));
  const r0 = sub(c0, m.start);
  const uC = dot(r0, f.u), vC = dot(r0, f.v);
  const h = pr.props.h, b = pr.props.b ?? h, tw = pr.dims.t ?? 4;
  const D = Math.max(h, b), dd = ventDia(D);
  const welded = new Set<string>();
  for (const c of d.connections) for (const w of c.welds) if (w.location === 'shop' && w.between.includes(m.id)) for (const x of w.between) if (x !== m.id) welded.add(x);
  let startFace: number | null = null, endFace: number | null = null;
  for (const id of welded) {
    const pm = d.byId.get(id);
    if (!pm || pm.kind !== 'plate') continue;
    const ps = memberSolid(pm);
    const vs = [...ps.startRing, ...ps.endRing].map((q) => { const r = sub(q, m.start); return { t: dot(r, f.ex), u: dot(r, f.u) - uC, v: dot(r, f.v) - vC }; });
    const tLo = Math.min(...vs.map((q) => q.t)), tHi = Math.max(...vs.map((q) => q.t));
    const uR = Math.max(...vs.map((q) => q.u)) - Math.min(...vs.map((q) => q.u)), vR = Math.max(...vs.map((q) => q.v)) - Math.min(...vs.map((q) => q.v));
    if (uR < 0.8 * b || vR < 0.8 * h) continue; // לא מכסה את החתך (לשונית, פח צד)
    const tc = (tLo + tHi) / 2;
    if (Math.abs(tc - tMin) < 120 + (tHi - tLo) / 2) startFace = Math.max(startFace ?? -Infinity, Math.min(tHi, tMin + 400));
    else if (Math.abs(tc - tMax) < 120 + (tHi - tLo) / 2) endFace = Math.min(endFace ?? Infinity, Math.max(tLo, tMax - 400));
  }
  const cu = Math.max(0, b / 2 - tw - dd / 2 - 4);
  const push = (t: number) => {
    for (const sg of [1, -1] as const) {
      const c = uC + sg * cu, c2 = vC + sg * (h / 2);
      out.push({ p: add(add(add(m.start, scale(f.ex, t)), scale(f.u, c)), scale(f.v, c2)), axis: scale(f.v, -sg), d: dd, t, c, c2 });
    }
  };
  if (startFace !== null) push(Math.max(startFace, tMin) + dd / 2 + 15);
  if (endFace !== null) push(Math.min(endFace, tMax) - dd / 2 - 15);
  return out;
}

/** חורים באלמנט מכל הברגים שעוברים בו. */
export function memberHoles(m: Member, d: DerivedModel): Hole[] {
  const out: Hole[] = [];
  const f = localFrame(m);
  for (const b of boltsThrough(d, m.id)) {
    const r = sub(b.p, m.start);
    const t = dot(r, f.ex);
    if (Math.abs(dot(b.axis, f.ex)) > 0.9) {
      // בורג לאורך ציר האלמנט (פלטת קצה): חור במישור החתך (u, v)
      out.push({ t: 0, c: dot(r, f.u), c2: dot(r, f.v), d: b.hole, face: 'section', boltId: b.id });
      continue;
    }
    const throughV = Math.abs(dot(b.axis, f.v)) > Math.abs(dot(b.axis, f.u));
    // דרך אגף (ציר הבורג לאורך v) ⇒ קואורדינטה רוחבית u; דרך ווב ⇒ קואורדינטה v
    const cc = throughV ? dot(r, f.u) : dot(r, f.v);
    out.push({ t, c: cc, c2: throughV ? dot(r, f.v) : dot(r, f.u), d: b.hole, face: throughV ? 'flange' : 'web', boltId: b.id });
  }
  ventHoles(m, d).forEach((v, i) => out.push({ t: v.t, c: v.c, c2: v.c2, d: v.d, face: 'flange', boltId: `VENT.${i + 1}` }));
  return out.sort((a, b) => a.t - b.t || a.c - b.c);
}

/**
 * מספור: חלקים זהים (חתך, חומר, אורך, חיתוכים, חורים) מקבלים אותו סימון. סימון קיים ברישום נשמר
 * (יציבות); חתימה חדשה מקבלת סימון זמני עד הרצת "מספור". שינוי סימון של חלק נרשם בהיסטוריה.
 */
export function computeFabrication(project: Project, d: DerivedModel): Fabrication {
  const reg = project.marks;
  const counters = { ...reg.counters };
  const parts: MarkedPart[] = [];
  for (const p of d.parts) {
    const m = d.byId.get(p.memberId);
    if (!m) continue;
    const pr = getProfile(p.profile);
    const first = p.index === 1, last = p.t1 >= axialExtent(m).tMax - 0.01;
    const holes = memberHoles(m, d).filter((h) => h.t >= p.t0 - 0.01 && h.t <= p.t1 + 0.01).map((h) => ({ ...h, t: h.t - p.t0 }));
    const cutStart = first ? cutAngle(m, 'start') : 0, cutEnd = last ? cutAngle(m, 'end') : 0;
    // חתימה: חורים באגף/ווב — מיקום לאורך ורוחב בלבד (c2 = צד ראש הבורג, לא משנה ייצור); חלק הפוך קצה-לקצה זהה
    const hs = (rev: boolean) => holes.map((h) => h.face === 'section' ? `${h.face}${r1(h.t)}/${r1(h.c)}/${r1(h.c2 ?? 0)}/${h.d}` : `${h.face}${r1(rev ? p.length - h.t : h.t)}/${r1(h.c)}/${h.d}`).sort().join(';');
    const fwd = [m.kind, p.profile, p.material, r1(p.length), cutStart, cutEnd, hs(false)].join('|');
    const rev = holes.some((h) => h.face === 'section') ? fwd : [m.kind, p.profile, p.material, r1(p.length), cutEnd, cutStart, hs(true)].join('|');
    const sig = rev < fwd ? rev : fwd;
    parts.push({
      ...p, mark: '', provisional: false, kind: m.kind, desc: m.partDesc ?? `${m.profile}`,
      weight: (massPerMeter(pr, getMaterial(p.material).density) * p.length) / 1000,
      holes, cutStart, cutEnd, assembly: '', signature: sig,
    });
  }
  // סימונים: קיימים מהרישום, חדשים לפי סדר דטרמיניסטי
  const newSigs = [...new Set(parts.filter((x) => !reg.parts[x.signature]).map((x) => x.signature))].sort();
  const assigned: Record<string, string> = {};
  for (const sg of newSigs) {
    const kind = sg.split('|')[0] as MemberKind;
    const pre = PREFIX[kind];
    counters[pre] = (counters[pre] ?? 0) + 1;
    assigned[sg] = `${pre}${counters[pre]}`;
  }
  for (const x of parts) {
    x.mark = reg.parts[x.signature] ?? assigned[x.signature];
    x.provisional = !reg.parts[x.signature];
  }
  const byPart = new Map(parts.map((x) => [x.id, x]));

  // מכלולים: איחוד חלקים המרותכים במסגריה
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; parent.set(a, r); return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (const x of parts) parent.set(x.id, x.id);
  const partsOf = new Map<string, MarkedPart[]>();
  for (const x of parts) partsOf.set(x.memberId, [...(partsOf.get(x.memberId) ?? []), x]);
  const partAt = (memberId: string, pt: { x: number; y: number; z: number }) => {
    const m = d.byId.get(memberId);
    const ps = partsOf.get(memberId) ?? [];
    if (!m || !ps.length) return null;
    if (ps.length === 1) return ps[0].id;
    const t = dot(sub(pt, m.start), localFrame(m).ex);
    // בתוך תחום חלק; אחרת (פלטת המשך בעובי התפר) — החלק הקרוב ביותר
    const dist = (x: MarkedPart) => (t < x.t0 ? x.t0 - t : t > x.t1 ? t - x.t1 : 0);
    return [...ps].sort((a, b) => dist(a) - dist(b))[0].id;
  };
  for (const c of d.connections) for (const w of c.welds) {
    if (w.location !== 'shop') continue;
    const a = partAt(w.between[0], w.from), b = partAt(w.between[1], w.from);
    if (a && b) union(a, b);
  }
  const groups = new Map<string, MarkedPart[]>();
  for (const x of parts) { const r = find(x.id); groups.set(r, [...(groups.get(r) ?? []), x]); }
  const assemblies: Assembly[] = [];
  const aNew: { a: Assembly; sig: string }[] = [];
  for (const [, ps] of groups) {
    const main = [...ps].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0];
    const sig = [main.mark, ...ps.filter((x) => x !== main).map((x) => x.mark).sort()].join('+');
    const a: Assembly = { id: `AS.${main.id}`, mark: reg.assemblies[sig] ?? '', provisional: !reg.assemblies[sig], main: main.id, parts: ps.map((x) => x.id), weight: ps.reduce((s, x) => s + x.weight, 0), signature: sig, kind: main.kind };
    for (const x of ps) x.assembly = a.id;
    assemblies.push(a);
    if (!a.mark) aNew.push({ a, sig });
  }
  const aSigs = [...new Set(aNew.map((x) => x.sig))].sort();
  const aAssigned: Record<string, string> = {};
  for (const sg of aSigs) {
    const kind = aNew.find((x) => x.sig === sg)!.a.kind;
    const pre = APREFIX[kind];
    counters[pre] = (counters[pre] ?? 0) + 1;
    aAssigned[sg] = `${pre}${counters[pre]}`;
  }
  for (const { a, sig } of aNew) a.mark = aAssigned[sig];
  assemblies.sort((a, b) => a.mark.localeCompare(b.mark, 'en', { numeric: true }));
  const changed = parts.filter((x) => reg.lastByPart[x.id] && reg.lastByPart[x.id] !== x.mark).map((x) => ({ id: x.id, from: reg.lastByPart[x.id], to: x.mark }));
  return { parts, assemblies, byPart, changed };
}

/** כתיבת הסימונים הזמניים לרישום (פקודת "מספור"), כולל היסטוריית שינויים. */
export function commitNumbering(project: Project, fab: Fabrication): Project['marks'] {
  const reg = structuredClone(project.marks);
  const now = new Date().toISOString();
  for (const x of fab.parts) {
    reg.parts[x.signature] = x.mark;
    const pre = x.mark.replace(/\d+$/, '');
    reg.counters[pre] = Math.max(reg.counters[pre] ?? 0, Number(x.mark.slice(pre.length)));
    if (reg.lastByPart[x.id] && reg.lastByPart[x.id] !== x.mark) reg.history.push({ date: now, id: x.id, from: reg.lastByPart[x.id], to: x.mark });
    reg.lastByPart[x.id] = x.mark;
  }
  for (const a of fab.assemblies) {
    reg.assemblies[a.signature] = a.mark;
    const pre = a.mark.replace(/\d+$/, '');
    reg.counters[pre] = Math.max(reg.counters[pre] ?? 0, Number(a.mark.slice(pre.length)));
  }
  reg.numberedAt = now;
  return reg;
}

void memberSolid;
