import { dot, sub } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { memberSolid } from '../geometry/solid';
import { axialExtent } from '../geometry/parts';
import { kgPerMeter } from '../core/units';
import { getProfile } from '../profiles/library';
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
  column: 'c', rafter: 'r', beam: 'b', brace: 'br', purlin: 'p', cleat: 'cl', plate: 'pl', bolt: 'x', anchor: 'a',
};
const APREFIX: Record<MemberKind, string> = {
  column: 'C', rafter: 'R', beam: 'B', brace: 'BR', purlin: 'P', cleat: 'CL', plate: 'BP', bolt: 'X', anchor: 'A',
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
    out.push({ t, c: cc, d: b.hole, face: throughV ? 'flange' : 'web', boltId: b.id });
  }
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
    const sig = [m.kind, p.profile, p.material, r1(p.length), cutStart, cutEnd, holes.map((h) => `${h.face}${r1(h.t)}/${r1(h.c)}/${r1(h.c2 ?? 0)}/${h.d}`).join(';')].join('|');
    parts.push({
      ...p, mark: '', provisional: false, kind: m.kind, desc: m.partDesc ?? `${m.profile}`,
      weight: (kgPerMeter(pr.props.area, getMaterial(p.material).density) * p.length) / 1000,
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
    return (ps.find((x) => t >= x.t0 - 1 && t <= x.t1 + 1) ?? ps[0]).id;
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
