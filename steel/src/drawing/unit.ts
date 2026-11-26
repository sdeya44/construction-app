/**
 * 1.69: גיליון "מכלול אגד" — אגד B (קורת אגד + אלכסונים) ואלכסוני Y של קורה נושאת בדילול עמודים.
 * מבט במישור הקיר (y–z) עם כל החלקים, סמלי ריתוך (ISO 2553) לכל ריתוך מסגריה, בועות סימון, מידות גיאומטריה,
 * פרט לכל פלטת חיבור (מבט פנים עם מידות וחורים), וטבלת חלקים ליחידה אחת.
 */
import type { Fabrication, MarkedPart } from '../fab/marks';
import type { Connection, DerivedModel, Member, Project } from '../model/types';
import { fitScale, View, type P, type Sheet } from './sheet';
import { cachedSolidPure, silhouetteEdges } from './solidCache';
import { plateFaceInBox } from './part';
import { approxMeasure, boxIsFree, type Box } from './layoutAudit';
import { placeLabels } from './labels';
import { renderIso } from './assembly';

type V3 = { x: number; y: number; z: number };
export interface BraceUnit { id: string; title: string; core: string[]; conns: Connection[]; hosts: string[]; refs: string[] }

const sig = (d: DerivedModel, ids: string[]) => ids.map((id) => { const m = d.byId.get(id); return m ? `${m.profile}:${Math.round(Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z))}` : '-'; }).join('|');

/** יחידות האגד בפרויקט, מקובצות לזהות (אותם חתכים ואורכים) — גיליון אחד לכל קבוצה */
export function braceUnits(p: Project, d: DerivedModel): BraceUnit[] {
  const raw: BraceUnit[] = [];
  // אגד B: קורת אגד BB.<מפתח>.<צד> + שני אלכסונים BB.…K1/K2
  for (const m of d.members.filter((x) => /^BB\.[^.]+\.[^.]+$/.test(x.id))) {
    const ks = [`${m.id}.K1`, `${m.id}.K2`].filter((id) => d.byId.has(id));
    if (!ks.length) continue; // קורת אגד בלי אלכסונים — שרטוט מכלול רגיל מספיק
    const key = m.id.slice(3);
    const conns = d.connections.filter((c) => c.id.startsWith(`C.BB.${key}.`) || c.id.startsWith(`C.CD.BB.${key}.`)); // כולל חיבורי אגד שנבנו ממתכון
    raw.push({ id: m.id, title: m.label, core: [m.id, ...ks], conns, hosts: [...new Set(conns.flatMap((c) => c.members))].filter((id) => d.byId.get(id)?.kind === 'column'), refs: [m.label] });
  }
  // אלכסוני Y בקורה נושאת: KT.<קורה>.<מסגרת>
  for (const t of p.building.transfers ?? []) {
    const ks = d.members.filter((x) => x.id.startsWith(`KT.${t.id}.`));
    if (!ks.length) continue;
    const conns = d.connections.filter((c) => c.id.startsWith(`C.KT.${t.id}.`));
    const tb = d.members.find((x) => x.id === `TB.${t.id}`);
    raw.push({ id: `TB.${t.id}`, title: `אלכסוני Y קורה נושאת ${t.id}`, core: [...(tb ? [tb.id] : []), ...ks.map((x) => x.id)], conns, hosts: [...new Set(conns.flatMap((c) => c.members))].filter((id) => d.byId.get(id)?.kind === 'column'), refs: [tb?.label ?? t.id] });
  }
  // קיבוץ יחידות זהות
  const out = new Map<string, BraceUnit>();
  for (const u of raw) {
    const k = `${u.id.split('.')[0]}|${sig(d, u.core)}`;
    const e = out.get(k);
    if (e) e.refs.push(...u.refs); else out.set(k, u);
  }
  return [...out.values()];
}

/** גיליון מכלול אגד. מחזיר תווית קנ"מ */
export function braceUnitSheet(sh: Sheet, def: { ref?: string }, d: DerivedModel, fab: Fabrication, units: BraceUnit[], area: { x0: number; y0: number; x1: number; y1: number }): string {
  const u = units.find((x) => x.id === def.ref);
  if (!u) return '—';
  const E = sh.ents;
  const partIds = [...new Set([...u.core, ...u.conns.flatMap((c) => c.parts)])].filter((id) => d.byId.has(id));
  const hostIds = u.hosts;
  const pr = (q: V3): P => ({ x: q.y, y: q.z }); // מישור הקיר / הציר (x קבוע)
  const pts = (ids: string[]) => ids.flatMap((id) => { const s = cachedSolidPure(d.byId.get(id)!); return [...s.startRing, ...s.endRing].map(pr); });
  const markOf = (id: string) => fab.parts.find((x) => x.memberId === id)?.mark ?? '';
  const welds = u.conns.flatMap((c) => c.welds).filter((w) => w.location === 'shop');
  const tubeOf = (id: string) => /^(RHS|SHS|CHS)/.test(d.byId.get(id)?.profile ?? '');
  // אזורים: טבלה משמאל; מימין — מבט כללי למעלה, שני פרטים מוגדלים באמצע, פרטי פלטות ברצועה התחתונה
  const tblW = 120;
  const plates = [...new Map(partIds.map((id) => fab.parts.find((q) => q.memberId === id)).filter((q): q is MarkedPart => !!q && d.byId.get(q.memberId)?.kind === 'plate').map((q) => [q.mark, q])).values()];
  const stripH = plates.length ? 62 : 0;
  const RX0 = area.x0 + tblW + 6, RX1 = area.x1 - 4;
  const yDet0 = area.y0 + stripH + 10, yDet1 = yDet0 + (area.y1 - yDet0) * 0.58, yOv0 = yDet1 + 10, yOv1 = area.y1 - 6;
  const boxOfIds = (ids: string[], m: number) => { const q = pts(ids); return { x0: Math.min(...q.map((a) => a.x)) - m, x1: Math.max(...q.map((a) => a.x)) + m, y0: Math.min(...q.map((a) => a.y)) - m, y1: Math.max(...q.map((a) => a.y)) + m }; };
  type BB = { x0: number; x1: number; y0: number; y1: number };
  /** מבט אחד: חלקים בתוך התיבה, ובאפשרות — ריתוכים, בועות ומידות */
  const region = (bx: BB, va: BB, title: string, opt: { welds: boolean; balloons: 'main' | 'all'; dims: boolean }) => {
    const sc = fitScale(bx.x1 - bx.x0, bx.y1 - bx.y0, va.x1 - va.x0 - 24, va.y1 - va.y0 - 14);
    const v = new View(sh, sc, { x: (va.x0 + va.x1) / 2, y: (va.y0 + va.y1) / 2 - 3 }, { x: (bx.x0 + bx.x1) / 2, y: (bx.y0 + bx.y1) / 2 });
    const inBox = (a: P, b: P): [P, P] | null => {
      let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
      for (const [pp, q] of [[-dx, a.x - bx.x0], [dx, bx.x1 - a.x], [-dy, a.y - bx.y0], [dy, bx.y1 - a.y]] as const) {
        if (pp === 0) { if (q < 0) return null; continue; }
        const r = q / pp;
        if (pp < 0) { if (r > t1) return null; t0 = Math.max(t0, r); } else { if (r < t0) return null; t1 = Math.min(t1, r); }
      }
      return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
    };
    const draw = (m: Member, layer: 'OUTLINE' | 'THIN') => {
      const s = cachedSolidPure(m);
      const seg = (a: V3, b: V3) => { const c = inBox(pr(a), pr(b)); if (c && Math.hypot(c[0].x - c[1].x, c[0].y - c[1].y) > 0.3 * sc) v.line(c[0], c[1], layer); };
      for (let i = 0; i < s.edges.length; i += 6) seg({ x: s.edges[i]!, y: s.edges[i + 1]!, z: s.edges[i + 2]! }, { x: s.edges[i + 3]!, y: s.edges[i + 4]!, z: s.edges[i + 5]! });
      for (const [i, j] of silhouetteEdges(m, pr)) seg(s.startRing[i]!, s.endRing[j]!);
    };
    for (const id of hostIds) draw(d.byId.get(id)!, 'THIN');
    for (const id of partIds) { const m = d.byId.get(id)!; draw(m, m.kind === 'bolt' ? 'THIN' : 'OUTLINE'); }
    for (const c of u.conns) for (const b of c.bolts) for (const suf of ['.H', '.S', '.N', '.W']) { const m = d.byId.get(`${b.id}${suf}`); if (m) draw(m, 'THIN'); }
    E.push({ k: 'text', p: { x: va.x1, y: va.y1 }, s: `${title}  1:${sc}`, h: 2.8, align: 'right', layer: 'TEXT', bold: true });
    const inside = (q: P) => q.x >= va.x0 && q.x <= va.x1 && q.y >= va.y0 && q.y <= va.y1 - 4;
    if (opt.dims) {
      const mid = (m: Member) => ({ x: (m.start.y + m.end.y) / 2, y: (m.start.z + m.end.z) / 2 });
      for (const m of u.core.map((id) => d.byId.get(id)!).filter((m) => m.kind === 'brace')) {
        const a = pr(m.start), b = pr(m.end);
        const lo = a.y < b.y ? a : b, hi = a.y < b.y ? b : a;
        v.dim({ x: lo.x, y: lo.y }, { x: hi.x, y: lo.y }, { x: 1, y: 0 }, -6);
        v.dim({ x: hi.x, y: lo.y }, { x: hi.x, y: hi.y }, { x: 0, y: 1 }, hi.x > lo.x ? 6 : -6);
        const ang = (Math.atan2(Math.abs(hi.y - lo.y), Math.abs(hi.x - lo.x)) * 180) / Math.PI;
        const q = v.p(mid(m).x, mid(m).y);
        placeLabels(sh, [{ p: { x: q.x, y: q.y + 4 }, s: `${ang.toFixed(1)}°`, h: 2.5, layer: 'DIM' }], va, approxMeasure, false);
      }
      if (hostIds.length >= 2) {
        const ys = hostIds.map((id) => d.byId.get(id)!.start.y).sort((a1, b1) => a1 - b1);
        v.dim({ x: ys[0]!, y: bx.y1 - 100 }, { x: ys[ys.length - 1]!, y: bx.y1 - 100 }, { x: 1, y: 0 }, 6, `${Math.round(ys[ys.length - 1]! - ys[0]!)} c-c`);
      }
    }
    if (opt.welds) {
      const seen = new Set<string>();
      for (const w of welds) {
        const at = v.p(w.from.y, w.from.z);
        if (!inside(at)) continue;
        const key = `${Math.round(at.x)}|${Math.round(at.y)}|${w.a}`;
        if (seen.has(key)) continue; seen.add(key);
        const plate = [w.between[0], w.between[1]].find((id) => d.byId.get(id)?.kind === 'plate') ?? w.between[1];
        let bend: P | null = null;
        for (const r of [10, 14, 18, 24, 30]) {
          for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [0, -1]] as const) {
            const q = { x: at.x + dx * r, y: at.y + dy * r * 0.8 };
            const b: Box = { x: q.x - 1, r: q.x + 26, y: q.y - 3, t: q.y + 2 };
            if (b.x < va.x0 || b.r > va.x1 || b.y < va.y0 || b.t > va.y1 - 5) continue;
            if (boxIsFree(E, b, 0.8)) { bend = q; break; }
          }
          if (bend) break;
        }
        bend ??= { x: at.x + 12, y: at.y + 10 };
        weldSymbol(sh, at, bend, w.a, tubeOf(w.between[0]) || tubeOf(w.between[1]), markOf(plate));
      }
    }
    // בועות: סימון אחד לכל חלק בתוך המבט
    const doneMk = new Set<string>();
    for (const id of opt.balloons === 'main' ? u.core : [...u.core, ...partIds]) {
      const m = d.byId.get(id); const mk = markOf(id);
      if (!m || !mk || doneMk.has(mk) || m.kind === 'bolt') continue;
      const s0 = cachedSolidPure(m), ring = [...s0.startRing, ...s0.endRing];
      const c3 = ring.reduce((a, q) => ({ x: a.x + q.x / ring.length, y: a.y + q.y / ring.length, z: a.z + q.z / ring.length }), { x: 0, y: 0, z: 0 });
      // נקודת עיגון: מרכז החלק, או (לחלק ארוך שחורג מהמבט) הנקודה הקרובה למרכז המבט
      let pc = v.p(c3.y, c3.z);
      if (!inside(pc)) { const cm = { x: (bx.x0 + bx.x1) / 2, y: (bx.y0 + bx.y1) / 2 }; const a = pr(m.start), b = pr(m.end); const dd = { x: b.x - a.x, y: b.y - a.y }; const t = Math.max(0, Math.min(1, ((cm.x - a.x) * dd.x + (cm.y - a.y) * dd.y) / ((dd.x ** 2 + dd.y ** 2) || 1))); pc = v.p(a.x + dd.x * t, a.y + dd.y * t); }
      if (!inside(pc)) continue;
      doneMk.add(mk);
      let c: P | null = null;
      for (const r of [9, 13, 17, 22, 28]) for (const [dx, dy] of [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1]] as const) {
        if (c) break;
        const q = { x: pc.x + dx * r, y: pc.y + dy * r };
        const bb: Box = { x: q.x - 3.6, r: q.x + 3.6, y: q.y - 3.6, t: q.y + 3.6 };
        if (bb.x < va.x0 || bb.r > va.x1 || bb.y < va.y0 || bb.t > va.y1 - 5) continue;
        if (boxIsFree(E, bb, 0.6)) c = q;
      }
      c ??= { x: pc.x, y: pc.y + 9 };
      const dl = Math.hypot(c.x - pc.x, c.y - pc.y) || 1;
      E.push({ k: 'line', a: pc, b: { x: c.x - ((c.x - pc.x) / dl) * 3.4, y: c.y - ((c.y - pc.y) / dl) * 3.4 }, layer: 'MARK' });
      E.push({ k: 'circle', c, r: 3.4, layer: 'MARK' });
      E.push({ k: 'text', p: { x: c.x, y: c.y - 1 }, s: mk, h: mk.length > 3 ? 2 : 2.5, align: 'center', layer: 'MARK', bold: true });
    }
    return sc;
  };
  // מבט כללי: כל היחידה (בלי הקורה הנושאת הארוכה) — מידות ובועות לחלקים הראשיים
  const ov = boxOfIds(partIds.filter((id) => !id.startsWith('TB.')), 350);
  const scO = region(ov, { x0: RX0, x1: RX1, y0: yOv0, y1: yOv1 }, `מבט כללי במישור הציר — ${u.title}`, { welds: false, balloons: 'main', dims: true });
  sh.scale = scO;
  // פרטים מוגדלים: חלקי החיבור הקרובים לכל עמוד (לפי ציר y)
  const ends = hostIds.map((h) => d.byId.get(h)!).sort((a, b) => a.start.y - b.start.y);
  const plateIds = partIds.filter((id) => d.byId.get(id)?.kind === 'plate');
  const groups = ends.map(() => [] as string[]);
  for (const id of plateIds) { const q = pts([id]); const yy = q.reduce((a, b) => a + b.x, 0) / q.length; let bi = 0; ends.forEach((c, i) => { if (Math.abs(c.start.y - yy) < Math.abs(ends[bi]!.start.y - yy)) bi = i; }); groups[bi]!.push(id); }
  const nD = Math.max(1, groups.filter((g) => g.length).length), dw = (RX1 - RX0) / nD;
  groups.filter((g) => g.length).forEach((g, i) => {
    const b = boxOfIds(g, 180);
    region(b, { x0: RX1 - (i + 1) * dw + 4, x1: RX1 - i * dw, y0: yDet0, y1: yDet1 }, `פרט ${String.fromCharCode(1488 + i)} — ריתוכים וחלקים`, { welds: true, balloons: 'all', dims: false });
  });

  // ---- פרטי פלטות החיבור (מבט פנים, מידות וחורים)
  if (plates.length) {
    const n = Math.min(plates.length, 6), sx0 = area.x0 + tblW + 6, sx1 = area.x1 - 4, w = (sx1 - sx0) / n;
    plates.slice(0, n).forEach((pm, i) => plateFaceInBox(sh, pm, d, { x0: sx1 - (i + 1) * w + 3, x1: sx1 - i * w, y0: area.y0 + 2, y1: area.y0 + stripH }));
    E.push({ k: 'text', p: { x: sx1, y: area.y0 + stripH + 3 }, s: `פרטי פלטות החיבור — מידות במ"מ, מרכזי חורים מהשפות${plates.length > n ? ` (ועוד ${plates.length - n} בגיליון הפלטות)` : ''}`, h: 2.5, align: 'right', layer: 'TEXT', bold: true });
  }

  // ---- טבלת חלקים ליחידה + הערות
  const cnt = new Map<string, { q: number; p: MarkedPart }>();
  for (const id of partIds) { const pt = fab.parts.find((x) => x.memberId === id); if (!pt || d.byId.get(id)?.kind === 'bolt') continue; const e = cnt.get(pt.mark) ?? { q: 0, p: pt }; e.q++; cnt.set(pt.mark, e); }
  const x1 = area.x0 + tblW, cw = [16, 10, 58, 36], rh = 4.4;
  let y = area.y1 - 4;
  const T = (s: string, xR: number, h = 2.4, bold = false) => E.push({ k: 'text', p: { x: xR, y }, s, h, align: 'right', layer: 'TEXT', bold });
  T('רשימת חלקים — יחידה אחת', x1, 2.8, true); y -= 6;
  const row = (vals: string[], bold = false) => { let xr = x1; vals.forEach((t, i) => { const mx = Math.floor((cw[i]! - 1.5) / (2.4 * 0.58)); T(t.length > mx ? `${t.slice(0, mx - 1)}…` : t, xr - 1, 2.4, bold); xr -= cw[i]!; }); y -= rh; E.push({ k: 'line', a: { x: area.x0, y: y + 2.6 }, b: { x: x1, y: y + 2.6 }, layer: 'THIN' }); };
  row(['סימון', 'כמות', 'תיאור', 'חתך'], true);
  for (const { q, p: pt } of [...cnt.values()].sort((a, b) => a.p.mark.localeCompare(b.p.mark, 'en', { numeric: true }))) row([pt.mark, String(q), pt.desc, pt.profile]);
  y -= 4;
  const bolts = new Map<string, number>();
  for (const c of u.conns) for (const b of c.bolts) { const k = `M${b.d}×${Math.round(b.length)} ${b.grade}${b.location === 'site' ? ' (שטח)' : ''}`; bolts.set(k, (bolts.get(k) ?? 0) + 1); }
  for (const [k, q] of bolts) { T(`${q}× ${k}`, x1); y -= 4; }
  y -= 2;
  const aS = [...new Set(welds.map((w) => w.a))].sort((a1, b1) => a1 - b1);
  for (const s of [
    u.id.startsWith('BB.') ? `ריתוך פינתי במסגריה a=${aS.join('/') || '—'} מ"מ: פחים לעמודים ולקורת האגד, לשוניות לאלכסונים ולקורת האגד (בחריץ, היקפי)` : `ריתוך פינתי במסגריה a=${aS.join('/') || '—'} מ"מ: פחים לעמודים ולקורה הנושאת, לשוניות לאלכסונים (בחריץ, היקפי)`,
    'חיבורי השטח מוברגים בלבד; גלוון חם לאחר ריתוך',
    `זהה ל: ${u.refs.slice(0, 6).join(' · ')}${u.refs.length > 6 ? ` ועוד ${u.refs.length - 6}` : ''}`,
  ]) {
    const words = s.split(' '); let cur = '';
    for (const wd of words) { if (approxMeasure(`${cur} ${wd}`, 2.3) > tblW - 4) { T(cur.trim(), x1, 2.3); y -= 3.8; cur = wd; } else cur += ` ${wd}`; }
    if (cur.trim()) { T(cur.trim(), x1, 2.3); y -= 3.8; }
    y -= 1.2;
  }
  // ---- 1.69.1: תלת־ממד מוצלל של היחידה (בלי העמודים והקורה הנושאת הארוכים), עם סימוני החלקים
  {
    const isoIds = [...partIds.filter((id) => !id.startsWith('TB.')), ...u.conns.flatMap((c) => c.bolts.flatMap((b) => ['.H', '.S', '.N', '.W'].map((sf) => `${b.id}${sf}`)))].filter((id) => d.byId.has(id));
    const ms = [...new Set(isoIds)].map((id) => d.byId.get(id)!);
    const top = Math.min(y - 4, area.y0 + 150);
    if (top - area.y0 > 50 && ms.length) renderIso(sh, ms, ms.map((m) => fab.parts.find((x) => x.memberId === m.id)?.mark ?? ''), { x0: area.x0 + 2, x1: area.x0 + tblW, y0: area.y0 + 4, y1: top }, null, () => ({ t: 0, u: 0, v: 0 }), 'תלת־ממד (ללא קנ"מ)', [], 0, true);
  }
  return `1:${scO}`;
}

/** סמל ריתוך ISO 2553: חץ מהמפרק, קו ייחוס + קו זיהוי מקווקו, משולש פינתי, a, עיגול היקפי, סימון החלק */
function weldSymbol(sh: Sheet, at: P, bend: P, a: number, allAround: boolean, mk: string) {
  const E = sh.ents;
  E.push({ k: 'line', a: at, b: bend, layer: 'MARK' });
  const ang = Math.atan2(at.y - bend.y, at.x - bend.x);
  for (const da of [0.4, -0.4]) E.push({ k: 'line', a: at, b: { x: at.x - 2 * Math.cos(ang + da), y: at.y - 2 * Math.sin(ang + da) }, layer: 'MARK' });
  const L2 = 15;
  E.push({ k: 'line', a: bend, b: { x: bend.x + L2, y: bend.y }, layer: 'MARK' });
  E.push({ k: 'line', a: { x: bend.x, y: bend.y + 1.1 }, b: { x: bend.x + L2, y: bend.y + 1.1 }, layer: 'HIDDEN' });
  const tx = bend.x + 6;
  E.push({ k: 'poly', pts: [{ x: tx, y: bend.y }, { x: tx, y: bend.y - 2.4 }, { x: tx + 2.4, y: bend.y }], closed: true, layer: 'MARK' });
  E.push({ k: 'text', p: { x: tx - 0.8, y: bend.y - 2.2 }, s: `a${a}`, h: 1.9, align: 'right', layer: 'MARK' });
  if (allAround) E.push({ k: 'circle', c: bend, r: 1.1, layer: 'MARK' });
  if (mk) E.push({ k: 'text', p: { x: bend.x + L2 + 1, y: bend.y - 0.6 }, s: mk, h: 1.9, align: 'left', layer: 'MARK' });
}
