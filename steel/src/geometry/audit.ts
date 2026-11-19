import { dot, sub, type Vec3 } from '../core/vec';
import type { DerivedModel, Member, ValidationIssue } from '../model/types';
import { localFrame } from './frame';
import { memberSolid } from './solid';

/**
 * בדיקת אורכים ומגעים (בקרת ייצור): אורך שגוי של אלמנט מתגלה כשהקצה שלו לא מגיע לחלק שהוא אמור להיות מרותך/מוברג אליו.
 *  · ריתוך — שני החלקים חייבים לגעת (מרחק ≤ סבולת).
 *  · בורג — ציר הבורג חייב לעבור דרך כל חלק ברשימת החורים, והחור (במלואו) בתוך החלק.
 * המעטפת של כל חלק — תיבה במערכת הצירים המקומית שלו (חתך I נבדק כמעטפת מלאה). בקרה גיאומטרית, לא חוזק.
 */
export interface AuditFinding { kind: 'weld' | 'bolt'; conn: string; a: string; b?: string; gap: number; message: string }

type Box = { o: Vec3; ex: Vec3; u: Vec3; v: Vec3; t0: number; t1: number; u0: number; u1: number; v0: number; v1: number; pts: Vec3[]; segs: [Vec3, Vec3][] };

function boxOf(m: Member): Box | null {
  let s;
  try { s = memberSolid(m); } catch { return null; }
  const ring = [...s.startRing, ...s.endRing];
  if (!ring.length) return null;
  // מקצועות: אורכיים (בין הטבעות) והיקפיים בכל קצה
  const segs: [Vec3, Vec3][] = [];
  const n = Math.min(s.startRing.length, s.endRing.length);
  for (let i = 0; i < n; i++) segs.push([s.startRing[i], s.endRing[i]]);
  for (const rg of [s.startRing, s.endRing]) for (let i = 0; i < rg.length; i++) segs.push([rg[i], rg[(i + 1) % rg.length]]);
  const pts = ring;
  const f = localFrame(m);
  const loc = (p: Vec3) => { const r = sub(p, m.start); return [dot(r, f.ex), dot(r, f.u), dot(r, f.v)]; };
  const L = pts.map(loc);
  const mn = (i: number) => Math.min(...L.map((q) => q[i])), mx = (i: number) => Math.max(...L.map((q) => q[i]));
  return { o: m.start, ex: f.ex, u: f.u, v: f.v, t0: mn(0), t1: mx(0), u0: mn(1), u1: mx(1), v0: mn(2), v1: mx(2), pts, segs };
}

/** מרחק נקודה מתיבה מקומית (0 בפנים) */
function distBox(B: Box, p: Vec3): number {
  const r = sub(p, B.o);
  const t = dot(r, B.ex), u = dot(r, B.u), v = dot(r, B.v);
  const dt = Math.max(B.t0 - t, 0, t - B.t1), du = Math.max(B.u0 - u, 0, u - B.u1), dv = Math.max(B.v0 - v, 0, v - B.v1);
  return Math.hypot(dt, du, dv);
}

/** האם הקו p + s·a (s בתחום) חותך את התיבה (עם הרחבה e) — בדיקת לוחות (slab) */
function lineHits(B: Box, p: Vec3, a: Vec3, e: number, s0r = -1e9, s1r = 1e9): boolean {
  const r = sub(p, B.o);
  let lo = s0r, hi = s1r;
  for (const [ax, mn, mx] of [[B.ex, B.t0, B.t1], [B.u, B.u0, B.u1], [B.v, B.v0, B.v1]] as const) {
    const o = dot(r, ax), dd = dot(a, ax);
    if (Math.abs(dd) < 1e-9) { if (o < mn - e || o > mx + e) return false; continue; }
    let s0 = (mn - e - o) / dd, s1 = (mx + e - o) / dd;
    if (s0 > s1) [s0, s1] = [s1, s0];
    lo = Math.max(lo, s0); hi = Math.min(hi, s1);
    if (lo > hi) return false;
  }
  return true;
}

export function auditContacts(d: DerivedModel, tol = 1.5): AuditFinding[] {
  const out: AuditFinding[] = [];
  const boxes = new Map<string, Box | null>();
  const box = (id: string) => { if (!boxes.has(id)) { const m = d.byId.get(id); boxes.set(id, m && m.kind !== 'bolt' ? boxOf(m) : null); } return boxes.get(id)!; };
  for (const c of d.connections) {
    for (const w of c.welds) {
      const [a, b] = w.between;
      const A = box(a), B = box(b);
      if (!A || !B) continue;
      // מרחק בין המעטפות: הקודקוד הקרוב של כל אחד לתיבה של השני
      // מגע: מקצוע של אחד חותך את המעטפת (מורחבת בסבולת) של השני; אחרת — המרחק הקטן בין הקודקודים לתיבה
      const touch = A.segs.some(([p, q]) => lineHits(B, p, sub(q, p), tol, 0, 1)) || B.segs.some(([p, q]) => lineHits(A, p, sub(q, p), tol, 0, 1));
      if (touch) continue;
      const g = Math.min(Math.min(...A.pts.map((p) => distBox(B, p))), Math.min(...B.pts.map((p) => distBox(A, p))));
      if (g > tol) out.push({ kind: 'weld', conn: c.id, a, b, gap: g, message: `ריתוך ${c.label}: ${d.byId.get(a)?.label ?? a} ↔ ${d.byId.get(b)?.label ?? b} — מרווח ${g.toFixed(1)} מ"מ (החלקים לא נוגעים)` });
    }
    for (const bo of c.bolts) {
      if (!bo.p || !bo.axis) continue;
      for (const h of bo.holesIn) {
        const B = box(h);
        if (!B) continue;
        // ציר הבורג עובר בחלק, ומרכז החור רחוק מהשפה לפחות ברדיוס החור (בניצב לציר הבורג)
        const ok = lineHits(B, bo.p, bo.axis, -bo.hole / 2 + 0.5) || (lineHits(B, bo.p, bo.axis, 0.5) && false);
        if (!ok) {
          const hit = lineHits(B, bo.p, bo.axis, 0.5);
          out.push({ kind: 'bolt', conn: c.id, a: h, gap: hit ? bo.hole / 2 : 999, message: `בורג ${bo.id} (${c.label}): ${hit ? 'החור חורג משפת' : 'לא עובר דרך'} ${d.byId.get(h)?.label ?? h}` });
        }
      }
    }
  }
  return out;
}

export function auditIssues(d: DerivedModel): ValidationIssue[] {
  return auditContacts(d).map((f) => ({ code: f.kind === 'weld' ? 'AUDIT_WELD' : 'AUDIT_BOLT', severity: 'warning', elementId: f.a, message: f.message }));
}

