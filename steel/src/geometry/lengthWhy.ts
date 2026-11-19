import { add, dist, dot, linePlaneT, scale, sub, type Vec3 } from '../core/vec';
import type { DerivedModel, Member, Project } from '../model/types';
import { tryProfile } from '../profiles/library';
import { localFrame } from './frame';
import { cutLength } from './solid';

/** שורה בטבלת פירוט האורך: תיאור, ערך (מ"מ, + תוספת / − הורדה), והסבר קצר */
export interface LenRow { label: string; value: number; note?: string; kind: 'ref' | 'minus' | 'plus' | 'result' }

const tOf = (_m: Member, plane: { point: Vec3; normal: Vec3 } | undefined, from: Vec3, ex: Vec3) => (plane ? linePlaneT(from, ex, plane) ?? 0 : 0);

/**
 * פירוט אורך של אלמנט קווי: קו הייחוס, ההורדה/התוספת בכל קצה (על הציר), אורך נקי בציר,
 * תוספת הצד הארוך של קצה בשיפוע, ואורך החיתוך המרבי. לכל קצה — מה נמצא שם (חיבור, פלטות, הקורה שמעל).
 */
export function lengthBreakdown(p: Project, d: DerivedModel, m: Member): LenRow[] | null {
  if (m.kind === 'plate' || m.kind === 'bolt' || m.kind === 'anchor' || m.contour) return null;
  const f = localFrame(m);
  const L = dist(m.start, m.end);
  if (L < 1) return null;
  const t0 = tOf(m, m.startCut, m.start, f.ex);            // >0 — הקצה מתחיל אחרי נקודת ההתחלה
  const t1 = L + tOf(m, m.endCut, m.end, f.ex);             // <L — הקצה נגמר לפני נקודת הסוף
  const net = t1 - t0;
  const cl = cutLength(m);
  const rows: LenRow[] = [{ label: 'אורך קו ייחוס', value: L, kind: 'ref', note: refNote(m) }];
  const why = (end: 'start' | 'end') => endNote(p, d, m, end, end === 'start' ? add(m.start, scale(f.ex, t0)) : add(m.start, scale(f.ex, t1)));
  const perp = (pl?: { normal: Vec3 }) => !!pl && Math.abs(Math.abs(dot(pl.normal, f.ex)) - 1) < 1e-3;
  const freeNote = 'חיתוך ניצב לציר דרך הפינה — הפטה והפלטה מגיעות עד הקצה';
  if (Math.abs(t0) > 0.5) rows.push({ label: `קצה התחלה ${t0 > 0 ? 'הורדה' : 'תוספת'}`, value: -t0, kind: t0 > 0 ? 'minus' : 'plus', note: t0 < 0 && perp(m.startCut) && m.kind === 'rafter' ? freeNote : why('start') });
  const colTop = m.kind === 'column' ? columnTopRows(p, d, m, L - t1) : null;
  if (colTop) rows.push(...colTop);
  else if (Math.abs(L - t1) > 0.5) rows.push({ label: `קצה סוף ${L - t1 > 0 ? 'הורדה' : 'תוספת'}`, value: -(L - t1), kind: L - t1 > 0 ? 'minus' : 'plus', note: why('end') });
  rows.push({ label: 'אורך נקי בציר', value: net, kind: 'result' });
  const extra = cl.max - net;
  if (Math.abs(extra) > 0.5) rows.push({ label: extra > 0 ? 'תוספת — הצד הארוך בקצה משופע' : 'הפרש קצה משופע', value: extra, kind: extra > 0 ? 'plus' : 'minus', note: 'החיתוך אינו ניצב לציר; האורך המרבי נמדד בפינה הרחוקה של החתך' });
  rows.push({ label: 'אורך חיתוך מרבי', value: cl.max, kind: 'result' });
  if (Math.abs(cl.max - cl.min) > 0.5) rows.push({ label: 'אורך חיתוך מזערי', value: cl.min, kind: 'result' });
  const parts = d.parts.filter((x) => x.memberId === m.id);
  if (parts.length > 1) parts.forEach((x) => rows.push({ label: `חלק ${x.index} (חיבור המשך)`, value: x.length, kind: 'result' }));
  return rows;
}

/** עובי פלטה מהשם PL{רוחב}x{עובי} — המספר הקטן */
export function plateT(profile: string, desc?: string): number {
  const fromDesc = desc ? /PL(\d+(?:\.\d+)?)×/.exec(desc) : null;
  if (fromDesc) return Number(fromDesc[1]);
  const n = (profile.match(/[\d.]+/g) ?? []).map(Number).filter((x) => x > 0); return n.length ? Math.min(...n) : 0;
}
/** פלטות קצה בלבד (ניצבות לציר האלמנט) — מקשחים ופלטות צד אינם משנים את האורך */
const endPlates = (plates: Member[], _ex: Vec3) => plates.filter((q) => !/חיזוק|מקשח|מילוי|לשונית|תלייה/.test(q.partDesc ?? q.label));

function refNote(m: Member): string {
  if (m.kind === 'column') return 'ממפלס תחתית העמוד עד פני עליון קורת הגג בציר';
  if (m.kind === 'rafter') return m.anchor === 'top' ? 'קו פני עליון הקורה, בין נקודות הצומת' : 'ציר הקורה, בין נקודות הצומת';
  if (m.purlin) return 'קו הפטה בין הקצוות (כולל קונזולות)';
  if (m.kind === 'brace') return 'קו העבודה בין צמתי הקושרת';
  return 'קו הייחוס של האלמנט';
}

/** מה נמצא בקצה: החיבור שהקצה שייך אליו, הפלטות בו ועוביין, והקורה שמעל (בעמוד) */
function endNote(p: Project, d: DerivedModel, m: Member, end: 'start' | 'end', at: Vec3): string {
  const notes: string[] = [];
  if (m.kind === 'column' && end === 'end') {
    const eave = d.connections.find((c) => c.type === 'eave' && c.members.includes(m.id));
    const raf = eave ? d.byId.get(eave.members.find((x) => x !== m.id) ?? '') : undefined;
    if (raf) {
      const pr = tryProfile(raf.profile);
      const dx = Math.hypot(raf.end.x - raf.start.x, raf.end.y - raf.start.y), dz = raf.end.z - raf.start.z;
      const k = Math.sqrt(1 + (dz / (dx || 1)) ** 2);
      notes.push(`קורת גג ${raf.profile}: ${Math.round((pr?.props.h ?? 0) * k)}${k > 1.001 ? ' (עומק אנכי בשיפוע)' : ''}`);
    }
  }
  if (m.kind === 'column' && end === 'start') {
    const base = p.connectionDefaults.base;
    if (base.enabled) notes.push((base.mode ?? 'embedded') === 'bolted' ? `פלטת בסיס מרותכת לעמוד: ${base.t}` : 'פלטה מבוטנת — העמוד עומד עליה (ללא הורדה)');
  }
  // חיבורים שהאלמנט שותף בהם, שפלטה שלהם קרובה לקצה
  const near = d.connections.filter((c) => c.members.includes(m.id) || c.parts.includes(m.id)).map((c) => {
    const plates = c.parts.map((id) => d.byId.get(id)).filter((q): q is Member => !!q && q.kind === 'plate');
    const dmin = Math.min(...plates.map((q) => Math.min(dist(q.start, at), dist(q.end, at), dist(add(q.start, scale(sub(q.end, q.start), 0.5)), at))), Infinity);
    return { c, plates, dmin };
  }).filter((x) => x.plates.length && x.dmin < 700).sort((a, b) => a.dmin - b.dmin);
  const best = near[0];
  if (best) {
    const ts = endPlates(best.plates, localFrame(m).ex).map((q) => plateT(q.profile, q.partDesc)).filter((x) => x > 0);
    const byT = new Map<number, number>(); for (const t of ts) byT.set(t, (byT.get(t) ?? 0) + 1);
    notes.push(best.c.type === 'ridge' && ts.length ? `${best.c.label} — פלטת קצה ${ts[0]} בקצה הקורה (פלטה לכל קורה)` : `${best.c.label}${byT.size ? ` — פלטות ${[...byT].map(([t, n]) => `${n}×${t}`).join(' + ')}` : ''}`);
  }
  // מרווח לפני משטח (קצה קושרת/פטה שנעצר לפני ווב): הנורמל של החיתוך
  void dot;
  return notes.join(' · ') || 'חיתוך הקצה לפי הגיאומטריה (מפגש עם אלמנט שכן)';
}

/** ראש עמוד: הורדה = עומק הקורה (אנכי) + פלטות ראש; שארית — מכפל/מרווח */
function columnTopRows(p: Project, d: DerivedModel, m: Member, total: number): LenRow[] | null {
  const eave = d.connections.find((c) => c.type === 'eave' && c.members.includes(m.id));
  const raf = eave ? d.byId.get(eave.members.find((x) => x !== m.id) ?? '') : undefined;
  if (!eave || !raf) return null;
  const pr = tryProfile(raf.profile);
  const dx = Math.hypot(raf.end.x - raf.start.x, raf.end.y - raf.start.y), dz = raf.end.z - raf.start.z;
  const k = Math.sqrt(1 + (dz / (dx || 1)) ** 2);
  const hv = (pr?.props.h ?? 0) * k;
  const plates = endPlates(eave.parts.map((id) => d.byId.get(id)).filter((q): q is Member => !!q && q.kind === 'plate'), localFrame(m).ex);
  const pt = plates.reduce((s, q) => s + plateT(q.profile, q.partDesc), 0);
  const rows: LenRow[] = [
    { label: `קצה סוף — קורת גג ${raf.profile}`, value: -hv, kind: 'minus', note: k > 1.001 ? `עומק ${pr?.props.h ?? 0} × ${k.toFixed(4)} (אנכי בשיפוע)` : 'עומק הקורה' },
  ];
  if (pt) rows.push({ label: `קצה סוף — פלטות ראש עמוד ${plates.length}×${Math.round(pt / plates.length)}`, value: -pt, kind: 'minus', note: eave.label });
  const rest = total - hv - pt;
  if (Math.abs(rest) > 0.5) rows.push({ label: rest > 0 ? 'קצה סוף — מכפל / מרווח נוסף' : 'קצה סוף — תוספת', value: -rest, kind: rest > 0 ? 'minus' : 'plus', note: 'הפרש בין ראש העמוד לפלטה — לבדיקה' });
  void p;
  return rows;
}
