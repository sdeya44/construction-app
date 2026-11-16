/**
 * הערכת גדלים (בקשת משתמש 16.11.2026): כללי אצבע וחישוב פשוט — **לא תכן סטטי**.
 * עומס גג אחיד (קבוע + שימושי) × מקדם, מומנט M = qL²/k, בדיקת מומנט התנגדות, יחס מפתח/עומק,
 * כפיפה פשוטה בפטות ותמירות באלכסונים. התוצאה: קטן מדי (כתום) / מתאים (ירוק) / גדול מדי (סגול).
 * כל הספים ניתנים לעריכה בהגדרות הפרויקט (settings.sizing).
 */
import { getProfile, tryProfile } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import { purlinParams } from '../geometry/purlins';
import type { DerivedModel, Member, Project } from './types';

export interface SizingCfg {
  /** עומס קבוע על הגג (כיסוי, פטות, מערכות) kN/m² */
  dead: number;
  /** עומס שימושי/תחזוקה על הגג kN/m² */
  live: number;
  /** מקדם עומס כולל */
  gamma: number;
  /** M = qL²/k לקורת גג במסגרת (10 ≈ מסגרת עם חיבורים קשיחים) */
  kRafter: number;
  /** M = qL²/k לפטה (8 = קורה פשוטה) */
  kPurlin: number;
  /** קורת גג: עומק מינימלי L/x, ועומק שמעליו נחשב גדול מדי L/x */
  rafterMinDepth: number; rafterMaxDepth: number;
  /** עמוד: עומק מינימלי H/x */
  columnMinDepth: number;
  /** מקדם אורך קריסה לעמוד במישור המסגרת */
  columnK: number;
  /** פטה: גבול שקיעה L/x */
  purlinDefl: number;
  /** ניצולת מתחתיה החתך נחשב גדול מדי */
  lowUtil: number;
  /** תמירות מרבית: אלמנט לחוץ / אלמנט מתיחה בלבד */
  slenderComp: number; slenderTens: number;
}
export const DEFAULT_SIZING: SizingCfg = {
  dead: 0.25, live: 0.5, gamma: 1.4, kRafter: 10, kPurlin: 8,
  rafterMinDepth: 45, rafterMaxDepth: 22, columnMinDepth: 30, columnK: 1.5, purlinDefl: 200, lowUtil: 0.3,
  slenderComp: 200, slenderTens: 300,
};
export const sizingCfg = (p: Project): SizingCfg => ({ ...DEFAULT_SIZING, ...(p.settings.sizing ?? {}) });

export type SizeStatus = 'small' | 'ok' | 'big' | 'na';
export interface SizeResult { status: SizeStatus; util?: number; text: string }
export const SIZE_COLOR: Record<SizeStatus, number> = { small: 0xe8730c, ok: 0x2f9e5b, big: 0x8a4fd0, na: 0xb9c0c7 };
export const SIZE_LABEL: Record<SizeStatus, string> = { small: 'קטן מדי — לבדוק', ok: 'סביר', big: 'גדול מהנדרש', na: 'לא נבדק' };

const E = 210000; // MPa
const fyOf = (m: Member) => { try { return getMaterial(m.material).fy ?? 235; } catch { return 235; } };
const f1 = (n: number) => n.toFixed(1), f2 = (n: number) => n.toFixed(2);

interface Ctx { cfg: SizingCfg; trib: Map<string, number>; rafterSpan: Map<string, number>; bay: number; purlinS: Map<string, number> }

function context(p: Project, d: DerivedModel): Ctx {
  const cfg = sizingCfg(p);
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const trib = new Map<string, number>();
  fr.forEach((f, i) => {
    const prev = i > 0 ? f.y - fr[i - 1].y : 0, next = i < fr.length - 1 ? fr[i + 1].y - f.y : 0;
    trib.set(f.id, (prev + next) / 2 || 6000);
  });
  const bay = fr.length > 1 ? Math.max(...fr.slice(1).map((f, i) => f.y - fr[i].y)) : 6000;
  // מפתח קורה: בין העמודים שתומכים בה (זיז — כפליים מאורך הזיז)
  const rafterSpan = new Map<string, number>();
  for (const m of d.members.filter((x) => x.kind === 'rafter')) {
    const xs = d.members.filter((c) => c.kind === 'column' && c.frameId === m.frameId).map((c) => c.start.x).sort((a, b) => a - b);
    const x0 = Math.min(m.start.x, m.end.x), x1 = Math.max(m.start.x, m.end.x), xm = (x0 + x1) / 2;
    let L = x1 - x0;
    const l = [...xs].reverse().find((x) => x <= xm + 1), r = xs.find((x) => x >= xm - 1);
    if (l !== undefined && r !== undefined && r > l) L = r - l;
    if (xs.length) { const over = Math.max(0, xs[0] - x0, x1 - xs[xs.length - 1]); L = Math.max(L, 2 * over); }
    rafterSpan.set(m.id, L);
  }
  const purlinS = new Map<string, number>();
  for (const m of d.members.filter((x) => x.purlin)) {
    const k = m.purlin!.paramKey ?? (m.purlin!.side === 'R' ? 'right' : 'left');
    purlinS.set(m.id, purlinParams(p.building.purlins, k).spacing);
  }
  return { cfg, trib, rafterSpan, bay, purlinS };
}

/** הערכת אלמנט אחד; profName — לבדיקת מועמד בבוחר הפרופילים */
function assess(m: Member, c: Ctx, d: DerivedModel, profName?: string): SizeResult {
  const pr = tryProfile(profName ?? m.profile);
  if (!pr) return { status: 'na', text: 'פרופיל לא מוכר' };
  const P = pr.props, fy = fyOf(m), cfg = c.cfg;
  const h = P.h ?? 0;
  const w = cfg.gamma * (cfg.dead + cfg.live); // kN/m²
  const status = (util: number, small: boolean, big: boolean): SizeStatus => (small || util > 1 ? 'small' : big ? 'big' : 'ok');
  if (m.kind === 'rafter') {
    const L = c.rafterSpan.get(m.id) ?? 6000, b = c.trib.get(m.frameId ?? '') ?? c.bay;
    const q = (w * b) / 1000; // kN/m
    const M = (q * (L / 1000) ** 2) / cfg.kRafter; // kNm
    const util = (M * 1e6) / ((P.Wy ?? 1) * fy);
    const hMin = L / cfg.rafterMinDepth, hMax = L / cfg.rafterMaxDepth;
    return { status: status(util, h < hMin, util < cfg.lowUtil && h > hMax), util, text: `מפתח ${f1(L / 1000)} מ' · רוחב העמסה ${f1(b / 1000)} מ' · M≈${f1(M)} kNm · ניצולת ${f2(util)} · עומק ${Math.round(h)} (מומלץ ${Math.round(hMin)}–${Math.round(hMax)})` };
  }
  if (m.kind === 'column') {
    const H = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
    const rafts = d.members.filter((x) => x.kind === 'rafter' && x.frameId === m.frameId);
    const L = Math.max(6000, ...rafts.map((x) => c.rafterSpan.get(x.id) ?? 0));
    const b = c.trib.get(m.frameId ?? '') ?? c.bay;
    const q = (w * b) / 1000;
    const M = (q * (L / 1000) ** 2) / 12, N = (q * L) / 2000; // kNm, kN
    const lam = (cfg.columnK * H) / (P.iy || 1), lamZ = H / (P.iz || 1);
    const lb = lam / (93.9 * Math.sqrt(235 / fy));
    const ph = 0.5 * (1 + 0.34 * (lb - 0.2) + lb * lb), chi = Math.min(1, 1 / (ph + Math.sqrt(Math.max(0, ph * ph - lb * lb))));
    const util = (N * 1000) / (chi * P.area * fy) + (M * 1e6) / ((P.Wy ?? 1) * fy);
    const hMin = H / cfg.columnMinDepth;
    const rh = Math.max(...rafts.map((x) => tryProfile(x.profile)?.props.h ?? 0), 0);
    const small = h < hMin || lamZ > cfg.slenderComp || h < 0.6 * rh;
    return { status: status(util, small, util < cfg.lowUtil && h > 2 * hMin && h > rh * 1.6), util, text: `גובה ${f1(H / 1000)} מ' · N≈${f1(N)} kN · M≈${f1(M)} kNm · ניצולת ${f2(util)} · λz=${Math.round(lamZ)} · עומק ${Math.round(h)} (מינ' ${Math.round(hMin)})` };
  }
  if (m.purlin) {
    const L = c.bay, s = c.purlinS.get(m.id) ?? 1200;
    const qd = (w * s) / 1000, qs = ((cfg.dead + cfg.live) * s) / 1000; // kN/m = N/mm
    const M = (qd * (L / 1000) ** 2) / cfg.kPurlin;
    const uM = (M * 1e6) / ((P.Wy ?? 1) * fy);
    const dl = (5 * qs * L ** 4) / (384 * E * (P.Iy || 1));
    const uD = dl / (L / cfg.purlinDefl);
    const util = Math.max(uM, uD);
    return { status: status(util, false, util < cfg.lowUtil), util, text: `מפתח ${f1(L / 1000)} מ' · מרווח ${f2(s / 1000)} מ' · ניצולת כפיפה ${f2(uM)} · שקיעה ${f1(dl)} מ"מ (L/${cfg.purlinDefl}=${f1(L / cfg.purlinDefl)})` };
  }
  if (m.kind === 'brace' || m.kind === 'beam') {
    if (pr.family === 'RD') return { status: 'na', text: 'מוט עגול — מתיחה בלבד' };
    let L = Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z);
    // שורת קשירה לפטות: מקובעת בכל פטה — אורך קריסה = מרווח הפטות
    if (m.id.startsWith('BR.T')) L = Math.min(L, Math.max(...[...c.purlinS.values(), 1500]));
    const i = Math.min(P.iy || 1, P.iz || 1);
    const lam = L / i;
    const tensionOnly = m.kind === 'brace' && /^BR\.(W|R)/.test(m.id);
    const lim = tensionOnly ? cfg.slenderTens : cfg.slenderComp;
    const util = lam / lim;
    return { status: status(util, false, util < 0.25), util, text: `אורך קריסה ${f2(L / 1000)} מ' · תמירות λ=${Math.round(lam)} (מרבית ${lim}${tensionOnly ? ', מתיחה' : ', לחיצה'})` };
  }
  return { status: 'na', text: 'לא נבדק (חלק חיבור)' };
}

const cache = new WeakMap<DerivedModel, { key: string; map: Map<string, SizeResult> }>();
/** הערכה לכל האלמנטים (מטמון לפי המודל וההגדרות) */
export function sizingAll(p: Project, d: DerivedModel): Map<string, SizeResult> {
  const key = JSON.stringify(p.settings.sizing ?? {});
  const hit = cache.get(d);
  if (hit && hit.key === key) return hit.map;
  const c = context(p, d);
  const map = new Map<string, SizeResult>();
  for (const m of d.members) if (['column', 'rafter', 'purlin', 'brace', 'beam'].includes(m.kind)) map.set(m.id, assess(m, c, d));
  cache.set(d, { key, map });
  return map;
}

/** הערכת פרופיל מועמד לתפקיד: הגרוע מבין כל האלמנטים בתפקיד (קטן > מתאים > גדול) */
export function assessCandidate(p: Project, d: DerivedModel, role: 'column' | 'rafter' | 'purlin', profName: string): SizeResult {
  const c = context(p, d);
  const ms = d.members.filter((m) => (role === 'purlin' ? !!m.purlin : m.kind === role));
  if (!ms.length) return { status: 'na', text: '' };
  const rs = ms.map((m) => assess(m, c, d, profName));
  const worst = rs.find((r) => r.status === 'small') ?? rs.reduce((a, r) => ((r.util ?? 0) > (a.util ?? 0) ? r : a), rs[0]);
  if (worst.status !== 'small' && rs.every((r) => r.status === 'big')) return { ...worst, status: 'big' };
  if (worst.status === 'big' && rs.some((r) => r.status === 'ok')) return { ...worst, status: 'ok' };
  return worst;
}
void getProfile;
