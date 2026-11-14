import { add, dot, scale, sub } from '../core/vec';
import type { FabPart, Member, Project, SpliceInfo, ValidationIssue } from '../model/types';
import { localFrame } from './frame';
import { memberSolid } from './solid';

const MIN_PART = 100; // mm — חלק קצר מזה אינו מעשי

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
export function buildParts(members: Member[], project: Project): { parts: FabPart[]; splices: SpliceInfo[]; issues: ValidationIssue[] } {
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
    for (let i = 0; i < cuts.length - 1; i++) {
      const length = cuts[i + 1] - cuts[i];
      parts.push({ id: `${m.id}.P${i + 1}`, memberId: m.id, index: i + 1, t0: cuts[i], t1: cuts[i + 1], length, profile: m.profile, material: m.material });
      if (length > stock + 0.5) {
        issues.push({ code: 'PART_STOCK', severity: 'warning', elementId: m.id, message: `${m.label}: חלק ${i + 1} באורך ${(length / 1000).toFixed(3)} מ' ארוך מחומר הגלם (${(stock / 1000).toFixed(2)} מ') — הוסף חיבור המשך או שנה אורך חומר גלם` });
      }
    }
    valid.forEach((t, i) => splices.push({ id: `${m.id}.S${i + 1}`, memberId: m.id, t, p: add(m.start, scale(f.ex, t)), status: 'requires-design' }));
  }
  if (splices.length) {
    issues.push({ code: 'SPLICE_DESIGN', severity: 'info', message: `${splices.length} חיבורי המשך מסומנים "דורש תכנון" — אין אישור הנדסי אוטומטי לחיבור המשך` });
  }
  return { parts, splices, issues };
}
