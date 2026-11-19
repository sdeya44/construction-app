import type { DerivedModel, Project } from '../model/types';
import type { Assembly, Fabrication } from './marks';
import { resolveBays } from '../geometry/bracing';

/** שלב הקמה: מה מרימים, המשקל הכבד ביותר להרמה אחת והמשקל המצטבר */
export interface ErectionStep { n: number; title: string; note: string; items: { mark: string; qty: number; unit: number }[]; maxLift: number; weight: number; cum: number }

/**
 * סדר הקמה מקובל לסככת פלדה (הצעה — לאישור מנהל העבודה ובודק המנופים):
 *  1. מפתח הייצוב: שתי המסגרות של המפתח הראשון עם קושרות (גג או קיר) — עמודים, קורות, קושרות ופטות של המפתח.
 *     זהו "קופסה" יציבה שממנה ממשיכים.
 *  2. ממשיכים מסגרת אחר מסגרת לשני הכיוונים: עמודים וקורה של המסגרת, ואז הפטות והקושרות של המפתח שנסגר.
 *  3. בסוף — כל מה שלא שויך (חלקים כלליים, חיפוי).
 * שיוך מכלול: עמוד/קורה לפי המסגרת; אחר — לפי המפתח שבו נמצא אמצע האלמנט הראשי.
 */
export function erectionSequence(p: Project, d: DerivedModel, fab: Fabrication): ErectionStep[] {
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const nb = fr.length - 1;
  if (nb < 1) return [];
  const br = p.building.bracing;
  const braced = [...(br.roof.enabled ? resolveBays(br.roof.bays, nb) : []), ...(br.walls.enabled ? resolveBays([...br.walls.left, ...br.walls.right], nb) : [])];
  const b0 = braced.length ? Math.min(...braced) : 0;
  const fIdx = new Map(fr.map((f, i) => [f.id, i]));
  const bayOfY = (y: number) => { for (let i = 0; i < nb; i++) if (y >= Math.min(fr[i].y, fr[i + 1].y) - 1 && y <= Math.max(fr[i].y, fr[i + 1].y) + 1) return i; return y < fr[0].y ? 0 : nb - 1; };
  // מסגרת של מכלול "קו מסגרת" (עמוד, קורה, פלטת בסיס, חיזוקים במישור המסגרת); אחרת — אילו מסגרות חייבות לעמוד לפני ההרכבה
  const info = (a: Assembly): { frame?: number; need: number[] } => {
    const pt = fab.byPart.get(a.main);
    const m = pt ? d.byId.get(pt.memberId) : undefined;
    if (!m) return { need: [] };
    if ((m.kind === 'column' || m.kind === 'rafter') && m.frameId && fIdx.has(m.frameId)) return { frame: fIdx.get(m.frameId)!, need: [] };
    // תחום החלק בפועל (אלמנט ארוך מחולק לחלקים בחיבורי המשך — כל חלק מורכב כשהמסגרות שלו עומדות)
    const Lm = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z) || 1;
    const yAt = (t: number) => m.start.y + (m.end.y - m.start.y) * Math.max(0, Math.min(1, t / Lm));
    const ya = pt ? yAt(pt.t0) : m.start.y, yb = pt ? yAt(pt.t1) : m.end.y;
    const y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
    const near = fr.findIndex((q) => Math.abs(q.y - (y0 + y1) / 2) < 400);
    if (y1 - y0 < 400 && near >= 0 && !['purlin', 'girt', 'brace'].includes(m.kind)) return { frame: near, need: [] };
    let need = fr.map((q, i) => (q.y >= y0 - 400 && q.y <= y1 + 400 ? i : -1)).filter((i) => i >= 0);
    if (need.length < 2) { const bay = bayOfY((y0 + y1) / 2); need = [...new Set([...need, bay, bay + 1])]; }
    return { need };
  };
  const pos = new Map(fab.assemblies.map((a) => [a.id, info(a)]));
  const used = new Set<string>();
  const up = new Set<number>();
  const steps: ErectionStep[] = [];
  let cum = 0;
  const step = (title: string, note: string, pick: (a: Assembly) => boolean) => {
    const as = fab.assemblies.filter((a) => !used.has(a.id) && pick(a));
    if (!as.length) return;
    for (const a of as) used.add(a.id);
    const m = new Map<string, { mark: string; qty: number; unit: number }>();
    for (const a of as) { const r = m.get(a.mark) ?? { mark: a.mark, qty: 0, unit: a.weight }; r.qty++; m.set(a.mark, r); }
    const weight = as.reduce((s, a) => s + a.weight, 0);
    cum += weight;
    steps.push({ n: steps.length + 1, title, note, items: [...m.values()].sort((x, y) => x.mark.localeCompare(y.mark, 'en', { numeric: true })), maxLift: Math.max(...as.map((a) => a.weight)), weight, cum });
  };
  const isCol = (a: Assembly) => a.kind === 'column';
  const lab = (i: number) => String(i + 1);
  const ready = (a: Assembly) => { const q = pos.get(a.id)!; return q.frame === undefined && q.need.length > 0 && q.need.every((f) => up.has(f)); };
  // 1. מפתח הייצוב
  step(`עמודי מסגרות ${lab(b0)}–${lab(b0 + 1)} (מפתח ייצוב)`, 'הצבה על ברגי העיגון, פילוס ואנכיות, הידוק זמני', (a) => isCol(a) && [b0, b0 + 1].includes(pos.get(a.id)!.frame ?? -1));
  step(`קורות ושאר אלמנטי מסגרות ${lab(b0)}–${lab(b0 + 1)}`, 'הרמה והברגת חיבורי עמוד-קורה ורכס', (a) => [b0, b0 + 1].includes(pos.get(a.id)!.frame ?? -1));
  up.add(b0); up.add(b0 + 1);
  step(`קושרות ופטות מפתח ${lab(b0)}–${lab(b0 + 1)}`, 'השלמת הקושרות במפתח (גג וקירות) ויישור — מכאן המבנה יציב', ready);
  // 2. מסגרות נוספות — לשני הכיוונים
  const order: number[] = [];
  for (let k = 1; b0 + 1 + k <= nb || b0 - k >= 0; k++) { if (b0 + 1 + k <= nb) order.push(b0 + 1 + k); if (b0 - k >= 0) order.push(b0 - k); }
  for (const f of order) {
    step(`מסגרת ${lab(f)}: עמודים וקורה`, 'הרמה, חיבור וחיזוק זמני עד חיבור הפטות', (a) => pos.get(a.id)!.frame === f);
    up.add(f);
    step(`פטות וקושרות שנסגרו עם מסגרת ${lab(f)}`, 'חיבור למסגרות שכבר עומדות', ready);
  }
  step('השלמות', 'אלמנטים שלא שויכו למסגרת או למפתח', () => true);
  return steps;
}
