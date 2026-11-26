/**
 * UHOST-01/02: `th` (פני חומר אמיתיים) למארח U — עמוד UPN/UPE באגד B (portal) ובמסבך נעילה (lock).
 * השוואה ישן↔חדש (כמו PORTAL-01/LOCK-01) אינה תקפה כאן: הקוד הישן ממקם את קצה האלמנט לפי ציר העמוד ± tw/2 (נכון רק ל-I, שהווב שלו במרכז),
 * ולכן ב-U הקצה "חצוף" לפי קצה החתך. הקריטריון העצמאי: מרחק קצה האלמנט מפני החומר הראשונים של העמוד, לאורך ציר האלמנט
 * (חיתוך עצמאי של הציר עם מתאר החתך — לא `trueHit`). במתכון + `th` המרחק קבוע (הפרט נבנה על פני החומר) וזהה לעמוד I; בקוד הישן על U אינו קבוע.
 * מבקר-ביקורת: אותה בדיקה על הקוד הישן על U חייבת להיכשל (מוכיח שההשוואה מבחינה).
 */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultPortal } from '../src/geometry/portal';
import { defaultLockTruss } from '../src/geometry/lockTruss';
import { localFrame } from '../src/geometry/frame';
import { memberSolid } from '../src/geometry/solid';
import { getProfile } from '../src/profiles/library';
import type { DerivedModel, Member } from '../src/model/types';

type V = { x: number; y: number; z: number };
const dotv = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

/** מרחק לאורך הקרן o+t·d עד הפגיעה הראשונה במתאר החתך של העמוד (מערכת מקומית, כולל הסטת memberSolid); null אם אין */
function rayRing(col: Member, o: V, d: V): number | null {
  const f = localFrame(col), s = memberSolid(col);
  const ring = getProfile(col.profile).outline.outer.map((p) => ({ u: p.u + s.du, v: p.v + s.dv }));
  const r = { x: o.x - col.start.x, y: o.y - col.start.y, z: o.z - col.start.z };
  const p0 = { u: dotv(r, f.u), v: dotv(r, f.v) }, dd = { u: dotv(d, f.u), v: dotv(d, f.v) };
  if (Math.hypot(dd.u, dd.v) < 1e-9) return null;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, ex = b.u - a.u, ey = b.v - a.v;
    const den = dd.u * ey - dd.v * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.u - p0.u) * ey - (a.v - p0.v) * ex) / den, w = ((a.u - p0.u) * dd.v - (a.v - p0.v) * dd.u) / den;
    if (w < -1e-6 || w > 1 + 1e-6 || t < -1e-6) continue;
    best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : null;
}

/** מרחקי הקצוות (עד 400 מ"מ מעמוד) מפני החומר, לפי "מזהה אלמנט|קצה" */
function gaps(d: DerivedModel, re: RegExp): Record<string, number> {
  const cols = d.members.filter((m) => m.kind === 'column' && m.id.includes('.COL.'));
  const out: Record<string, number> = {};
  for (const m of d.members.filter((x) => re.test(x.id) && !['plate', 'bolt', 'anchor'].includes(x.kind))) {
    for (const [end, q, o] of [['s', m.start, m.end], ['e', m.end, m.start]] as const) {
      const L = Math.hypot(q.x - o.x, q.y - o.y, q.z - o.z); if (L < 1) continue;
      const dir = { x: (q.x - o.x) / L, y: (q.y - o.y) / L, z: (q.z - o.z) / L }; // מהקצה החוצה, לעבר המארח
      for (const c of cols) {
        if (Math.hypot(c.start.x - q.x, c.start.y - q.y) > 400) continue;
        const t = rayRing(c, q, dir);
        if (t !== null && t < 400) out[`${m.id}|${end}|${c.id}`] = t;
      }
    }
  }
  return out;
}

type Mk = (b: ReturnType<typeof defaultBuilding>, recipe: boolean) => void;
const MODES: { name: string; re: RegExp; mk: Mk; recipeConns: (d: DerivedModel) => number }[] = [
  {
    name: 'אגד B', re: /^BB\./,
    mk: (b, e) => { b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'portal', portal: { ...defaultPortal(), ...(e ? { engine: 'recipe' as const } : {}) } }; },
    recipeConns: (d) => d.connections.filter((c) => c.custom && c.custom.site.startsWith('BB.')).length,
  },
  {
    name: 'מסבך נעילה (לשונית)', re: /^LT\./,
    mk: (b, e) => { b.bracing.walls = { ...b.bracing.walls, enabled: true, type: 'truss', truss: { ...defaultLockTruss(), conn: 'tongue', ...(e ? { engine: 'recipe' as const } : {}) } }; },
    recipeConns: (d) => d.connections.filter((c) => c.custom && c.custom.site.startsWith('LT.')).length,
  },
];
const build = (col: string, mk: Mk, recipe: boolean) => { const b = defaultBuilding(); b.columnProfile = col; mk(b, recipe); return generate(newProject('c', b)); };
const maxDiff = (a: Record<string, number>, b: Record<string, number>) => {
  const ks = new Set([...Object.keys(a), ...Object.keys(b)]); let m = 0;
  for (const k of ks) m = Math.max(m, a[k] === undefined || b[k] === undefined ? Infinity : Math.abs(a[k]! - b[k]!));
  return m;
};

describe('UHOST-01 עמוד U: פני חומר אמיתיים (th) — מתכון מול עמוד I', () => {
  for (const mode of MODES) for (const col of ['UPN200', 'UPE200', 'C200x70x20x2.5']) it(`${mode.name} · ${col}`, () => {
    const dU = build(col, mode.mk, true), dI = build('HEA200', mode.mk, true);
    expect(mode.recipeConns(dU)).toBeGreaterThan(10);                       // השער פתוח: חיבורי מתכון נוצרו
    expect(mode.recipeConns(dU)).toBe(mode.recipeConns(dI));
    const gU = gaps(dU, mode.re), gI = gaps(dI, mode.re);
    expect(Object.keys(gU).length).toBeGreaterThan(20);
    expect(Object.keys(gU).length).toBe(Object.keys(gI).length);
    // כל הקצוות באותו מרחק מפני החומר כמו בעמוד I (±0.5 מ"מ)
    expect(maxDiff(gU, gI)).toBeLessThanOrEqual(0.5);
    // המתכון על U: ללא שגיאות וללא התנגשויות (הקוד הישן על אותו עמוד מייצר CLASH — ראו UHOST-02)
    const errs = (d: DerivedModel) => d.issues.filter((i) => i.severity === 'error' || i.code === 'CLASH').map((i) => i.code).sort();
    expect(errs(dU)).toEqual([]);
    // אותה כמות ברגים וריתוכים כמו בקוד הישן (הפרט זהה, רק ממוקם על פני החומר)
    const cnt = (d: DerivedModel) => ({ bolts: d.connections.filter((c) => mode.re.test(c.id.replace(/^C\./, '')) || c.custom?.site.match(mode.re)).reduce((s, c) => s + c.bolts.length, 0) });
    expect(cnt(dU).bolts).toBeGreaterThan(0);
    expect(cnt(dU).bolts).toBe(cnt(build(col, mode.mk, false)).bolts);
  });
});

describe('UHOST-02 בקרת הבדיקה: הקוד הישן על U חייב להיכשל בהשוואה', () => {
  for (const mode of MODES) it(`${mode.name} · UPN200 (ישן)`, () => {
    const gOld = gaps(build('UPN200', mode.mk, false), mode.re), gI = gaps(build('HEA200', mode.mk, true), mode.re);
    expect(maxDiff(gOld, gI)).toBeGreaterThan(20);
    // ובנוסף: הקוד הישן על U מתנגש עם אגף העמוד
    expect(build('UPN200', mode.mk, false).issues.filter((i) => i.code === 'CLASH').length).toBeGreaterThan(0);
    // והמערכת מזהירה על כך (COL_U_LEGACY); במתכון אין אזהרה
    expect(build('UPN200', mode.mk, false).issues.some((i) => i.code === 'COL_U_LEGACY')).toBe(true);
    expect(build('UPN200', mode.mk, true).issues.some((i) => i.code === 'COL_U_LEGACY')).toBe(false);
    expect(build('HEA200', mode.mk, false).issues.some((i) => i.code === 'COL_U_LEGACY')).toBe(false);
  });
});
