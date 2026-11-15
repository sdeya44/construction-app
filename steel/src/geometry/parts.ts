import { add, dot, scale, sub } from '../core/vec';
import type { FabPart, Member, Project, SpliceInfo, ValidationIssue } from '../model/types';
import { localFrame } from './frame';
import { memberSolid } from './solid';

const MIN_PART = 100; // mm — חלק קצר מזה אינו מעשי
/** עובי כל אחת משתי פלטות חיבור ההמשך בקורת I — החלק מתקצר בעובייה בכל צד של התפר */
export const BEAM_SPLICE_T = 12;

/** תחום האלמנט לאורך צירו (t ביחס לנקודת ההתחלה), כולל חיתוכי קצה. */
export function axialExtent(m: Member): { tMin: number; tMax: number } {
  const f = localFrame(m);
  if (!m.startCut && !m.endCut) return { tMin: 0, tMax: f.length };
  const s = memberSolid(m);
  const tMin = Math.min(...s.startRing.map((p) => dot(sub(p, m.start), f.ex)));
  const tMax = Math.max(...s.endRing.map((p) => dot(sub(p, m.start), f.ex)));
  return { tMin, tMax };
}

/**
 * חלוקת מכלול לחלקי ייצור לפי מיקומי חיבורי המשך. קו/מכלול רציף אינו משתנה —
 * רק רשימת החלקים. חיבור המשך מסומן "דורש תכנון" (אין אישור הנדסי אוטומטי).
 */
export function buildParts(members: Member[], project: Project, conns?: Map<string, unknown>): { parts: FabPart[]; splices: SpliceInfo[]; issues: ValidationIssue[] } {
  const parts: FabPart[] = [], splices: SpliceInfo[] = [], issues: ValidationIssue[] = [];
  const stock = project.settings.stockLength;
  for (const m of members) {
    const { tMin, tMax } = axialExtent(m);
    const raw = project.splices[m.id] ?? [];
    const ts = [...new Set(raw)].sort((a, b) => a - b);
    const valid = ts.filter((t) => t > tMin + MIN_PART && t < tMax - MIN_PART);
    if (valid.length !== ts.length) {
      issues.push({ code: 'SPLICE_RANGE', severity: 'warning', elementId: m.id, message: `${m.label}: חיבור המשך מחוץ לאלמנט או קרוב מדי לקצה (פחות מ-${MIN_PART} מ"מ) — לא נכלל` });
    }
    for (let i = 1; i < valid.length; i++) {
      if (valid[i] - valid[i - 1] < MIN_PART) issues.push({ code: 'SPLICE_CLOSE', severity: 'warning', elementId: m.id, message: `${m.label}: שני חיבורי המשך קרובים מ-${MIN_PART} מ"מ` });
    }
    const f = localFrame(m);
    const cuts = [tMin, ...valid, tMax];
    // חיבור המשך בפלטות קצה: החלקים מסתיימים בפני הפלטות
    const gap = (t: number) => (conns?.has(`C.RS.${m.id}.${ts.indexOf(t) + 1}`) ? BEAM_SPLICE_T : 0);
    for (let i = 0; i < cuts.length - 1; i++) {
      const t0 = cuts[i] + (i > 0 ? gap(cuts[i]) : 0), t1 = cuts[i + 1] - (i < cuts.length - 2 ? gap(cuts[i + 1]) : 0);
      const length = t1 - t0;
      parts.push({ id: `${m.id}.P${i + 1}`, memberId: m.id, index: i + 1, t0, t1, length, profile: m.profile, material: m.material });
      if (length > stock + 0.5) {
        issues.push({ code: 'PART_STOCK', severity: 'warning', elementId: m.id, message: `${m.label}: חלק ${i + 1} באורך ${(length / 1000).toFixed(3)} מ' ארוך מחומר הגלם (${(stock / 1000).toFixed(2)} מ') — הוסף חיבור המשך או שנה אורך חומר גלם` });
      }
    }
    valid.forEach((t, i) => {
      const k = ts.indexOf(t) + 1;
      const cid = `C.PS.${m.id}.${k}`;
      const bolted = !!conns?.has(cid);
      splices.push({ id: `${m.id}.S${i + 1}`, memberId: m.id, t, p: add(m.start, scale(f.ex, t)), status: bolted ? 'bolted' : 'requires-design', ...(bolted ? { connId: cid } : {}) });
    });
  }
  const rd = splices.filter((x) => x.status === 'requires-design').length;
  if (rd) {
    issues.push({ code: 'SPLICE_DESIGN', severity: 'info', message: `${rd} חיבורי המשך מסומנים "דורש תכנון" — אין אישור הנדסי אוטומטי לחיבור המשך` });
  }
  return { parts, splices, issues };
}
