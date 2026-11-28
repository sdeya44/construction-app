import { useMemo, useState } from 'react';
import { setBuilding, setSection, setSettings } from '../commands/commands';
import { lineLabel, moveLines, setAxisCount, toCustomSection, type CustomSection, type RoofPlaneDef } from '../model/section';
import { LenField, NumField } from './fields';
import type { Member } from '../model/types';
import { tryProfile } from '../profiles/library';
import { store, useStore } from '../store';

/**
 * 1.62: חתך המסגרת עם כל המידות — לבקשת המשתמש, במקום שרטוט שבו הגובה מופיע בקצה הקונזולה וייחוס לא ברור.
 * בכל ציר עמוד שתי מידות גובה (מ־±0.00):
 *   ▽ ראש עמוד — קצה העמוד כפי שנבנה במודל (מתחת לקורה ולפלטת הקצה) — לקריאה
 *   ▼ ע.ע. קורה — פני עליון קורת הגג על ציר העמוד — לעריכה (זה הגובה שהמנוע שומר)
 * ובנוסף: גובה הרכס/השבירה (עריכה), שיפוע לכל מישור (עריכה), מפתחים בין צירים וקונזולות (עריכה), גובה קצה הקונזולה (קריאה).
 * השרטוט נבנה מהאלמנטים של המסגרת הראשונה במודל — מה שרואים הוא מה שנבנה.
 */
type EditKey = { kind: 'axis' | 'junc' | 'slope' | 'span' | 'ovl' | 'ovr' | 'base' | 'blev'; key: string; at: { x: number; y: number }; value: number; pct?: boolean };
type Mode = 'local' | 'all';

/** ראש העמוד בפועל, על ציר העמוד: מישור החיתוך בקצה העליון (מתחת לקורה ולפלטה) — לא נקודת העבודה */
export function columnTopAt(c: Member, x: number): number {
  const topIsEnd = c.end.z >= c.start.z;
  const P = topIsEnd ? c.end : c.start, cut = topIsEnd ? c.endCut : c.startCut;
  if (!cut || Math.abs(cut.normal.z) < 1e-6) return P.z;
  return cut.point.z - (cut.normal.x * (x - cut.point.x) + cut.normal.y * (P.y - cut.point.y)) / cut.normal.z;
}
const zAt = (p: RoofPlaneDef, x: number) => p.z0 + ((p.z1 - p.z0) * (x - p.x0)) / ((p.x1 - p.x0) || 1);
const near = (a: number, b: number, t = 1) => Math.abs(a - b) < t;

/** גובה ע.ע. קורה בנקודה x — שינוי מקומי: מישורים שמכילים את x מסתובבים סביב נקודת עיגון (רכס / ציר אחר), השאר לא זזים */
export function setTosAtAxis(sec: CustomSection, x: number, v: number, mode: Mode): CustomSection {
  const inside = (p: RoofPlaneDef) => p.x0 - 1 <= x && x <= p.x1 + 1;
  if (mode === 'all') {
    const p0 = sec.planes.find(inside); if (!p0) return sec;
    const dz = v - zAt(p0, x);
    return { ...sec, template: undefined, planes: sec.planes.map((p) => ({ ...p, z0: p.z0 + dz, z1: p.z1 + dz })) };
  }
  const xs = sec.lines.map((l) => l.x);
  const junc = (px: number) => sec.planes.filter((q) => near(q.x0, px) || near(q.x1, px)).length > 1;
  return {
    ...sec, template: undefined, planes: sec.planes.map((p) => {
      if (!inside(p)) return p;
      // עיגון: הנקודה הרחוקה ביותר מ־x מבין צירים אחרים בתוך המישור וקצוות משותפים (רכס/שבירה)
      const cands = [...xs.filter((a) => a > p.x0 - 1 && a < p.x1 + 1 && !near(a, x)), ...[p.x0, p.x1].filter((e) => junc(e) && !near(e, x))];
      if (!cands.length) { const dz = v - zAt(p, x); return { ...p, z0: p.z0 + dz, z1: p.z1 + dz }; }
      const xa = cands.reduce((a, b) => (Math.abs(b - x) > Math.abs(a - x) ? b : a));
      const za = zAt(p, xa), s = (za - v) / (xa - x);
      return { ...p, z0: v + s * (p.x0 - x), z1: v + s * (p.x1 - x) };
    }),
  };
}
/** גובה רכס/שבירה (קצה משותף לשני מישורים): כל מישור מסתובב סביב הציר הקרוב שבתוכו */
export function setJunction(sec: CustomSection, xj: number, v: number): CustomSection {
  const xs = sec.lines.map((l) => l.x);
  return {
    ...sec, template: undefined, planes: sec.planes.map((p) => {
      const atStart = near(p.x0, xj), atEnd = near(p.x1, xj);
      if (!atStart && !atEnd) return p;
      const ax = xs.filter((a) => a > p.x0 - 1 && a < p.x1 + 1 && !near(a, xj));
      if (!ax.length) return atStart ? { ...p, z0: v } : { ...p, z1: v };
      const xa = ax.reduce((a, b) => (Math.abs(b - xj) < Math.abs(a - xj) ? b : a));
      const za = zAt(p, xa), s = (v - za) / (xj - xa);
      return { ...p, z0: za + s * (p.x0 - xa), z1: za + s * (p.x1 - xa) };
    }),
  };
}
/** שיפוע מישור (%): הגובה בציר הנמוך שבתוכו נשמר; קצה משותף זז והמישור השכן מתעדכן אליו */
export function setSlope(sec: CustomSection, pid: string, pct: number): CustomSection {
  const p = sec.planes.find((q) => q.id === pid); if (!p) return sec;
  const xs = sec.lines.map((l) => l.x).filter((a) => a > p.x0 - 1 && a < p.x1 + 1);
  const xa = xs.length ? xs.reduce((a, b) => (zAt(p, b) < zAt(p, a) ? b : a)) : p.x0;
  const za = zAt(p, xa);
  const dir = Math.sign(p.z1 - p.z0) || 1;
  const s = (dir * Math.abs(pct)) / 100;
  const np = { ...p, z0: za + s * (p.x0 - xa), z1: za + s * (p.x1 - xa) };
  let out: CustomSection = { ...sec, template: undefined, planes: sec.planes.map((q) => (q.id === pid ? np : q)) };
  // שכנים בקצה משותף — עוקבים אחרי הגובה החדש
  for (const [ex, ez] of [[p.x0, np.z0], [p.x1, np.z1]] as const) {
    if (sec.planes.some((q) => q.id !== pid && (near(q.x0, ex) || near(q.x1, ex)))) {
      const others = setJunction({ ...out, planes: out.planes.filter((q) => q.id !== pid) }, ex, ez);
      out = { ...out, planes: out.planes.map((q) => (q.id === pid ? q : others.planes.find((o) => o.id === q.id) ?? q)) };
    }
  }
  return out;
}

export function FrameSectionDims() {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const b = p.building;
  const sec: CustomSection = useMemo(() => b.section ?? toCustomSection(b, d.roof), [b, d.roof]);
  const [mode, setMode] = useState<Mode>('local');
  const [edit, setEdit] = useState<EditKey | null>(null);
  const [pop, setPop] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const apply = (s2: CustomSection, label: string) => store.exec(setSection(s2, label));
  const lines = [...sec.lines].sort((a, c) => a.x - c.x);
  const fid = [...b.frames].sort((a, c) => a.y - c.y)[0]?.id;
  const mem = d.members.filter((m) => m.frameId === fid && (m.kind === 'column' || m.kind === 'rafter' || m.kind === 'beam') && !/^(KB|W)\./.test(m.id));
  const colOf = (x: number) => mem.find((m) => m.kind === 'column' && near(m.start.x, x, 5));
  const base = b.baseElevation ?? 0;
  const L0 = Math.min(...sec.planes.map((q) => q.x0)), R1 = Math.max(...sec.planes.map((q) => q.x1));
  const zMax = Math.max(...sec.planes.flatMap((q) => [q.z0, q.z1]), 1);
  // קנה מידה
  const W = 760, H = 400, padX = 150, padTop = 70, padBot = 92;
  const k = Math.min((W - 2 * padX) / ((R1 - L0) || 1), (H - padTop - padBot) / (zMax - Math.min(0, base) || 1));
  const X = (x: number) => padX + (x - L0) * k, Y = (z: number) => H - padBot - (z - Math.min(0, base)) * k;
  const m3 = (v: number) => `\u2066${v >= 0 ? '+' : ''}${(v / 1000).toFixed(2)}\u2069`;
  const topAt = (x: number) => { const ps = sec.planes.filter((q) => q.x0 - 1 <= x && x <= q.x1 + 1); return ps.length ? Math.max(...ps.map((q) => zAt(q, x))) : 0; };
  const juncs = useMemo(() => {
    const pts = new Map<string, { x: number; z: number }>();
    for (const q of sec.planes) for (const [x, z] of [[q.x0, q.z0], [q.x1, q.z1]] as const) {
      if (sec.planes.filter((o) => near(o.x0, x) || near(o.x1, x)).length > 1 && !lines.some((l) => near(l.x, x))) pts.set(x.toFixed(0), { x, z });
    }
    return [...pts.values()];
  }, [sec]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (e: Omit<EditKey, 'at'>, sx: number, sy: number) => setEdit({ ...e, at: { x: (sx / W) * 100, y: (sy / H) * 100 } });
  const commit = (raw: number) => {
    if (!edit) return;
    const v = edit.pct ? raw : raw * 1000;
    if (edit.kind === 'axis') apply(setTosAtAxis(sec, Number(edit.key), v, mode), 'גובה ע.ע. קורה בציר');
    if (edit.kind === 'blev') store.exec(setBuilding({ baseElevation: v }));
    if (edit.kind === 'base') { const be = b.baseElevation ?? 0; store.exec(setBuilding({ lineBase: { ...(b.lineBase ?? {}), [edit.key]: be + v } })); }
    if (edit.kind === 'junc') apply(setJunction(sec, Number(edit.key), v), 'גובה רכס');
    if (edit.kind === 'slope') apply(setSlope(sec, edit.key, v), 'שיפוע גג');
    if (edit.kind === 'span') {
      const i = Number(edit.key), delta = v - (lines[i + 1].x - lines[i].x);
      apply(moveLines(sec, new Map(lines.filter((_, j) => j > i).map((l) => [l.id, l.x + delta]))), 'מפתח בין צירים');
    }
    if (edit.kind === 'ovl' || edit.kind === 'ovr') {
      const pl = edit.kind === 'ovl' ? sec.planes.reduce((a, q) => (q.x0 < a.x0 ? q : a)) : sec.planes.reduce((a, q) => (q.x1 > a.x1 ? q : a));
      const s = (pl.z1 - pl.z0) / ((pl.x1 - pl.x0) || 1);
      const patch = edit.kind === 'ovl' ? { x0: lines[0].x - v, z0: pl.z1 - s * (pl.x1 - (lines[0].x - v)) } : { x1: lines[lines.length - 1].x + v, z1: pl.z0 + s * (lines[lines.length - 1].x + v - pl.x0) };
      apply({ ...sec, template: undefined, planes: sec.planes.map((q) => (q.id === pl.id ? { ...q, ...patch } : q)) }, 'קונזולה');
    }
    setEdit(null);
  };
  const band = (m: Member) => {
    const h = tryProfile(m.profile)?.props.h ?? 200;
    const A = { x: X(m.start.x), y: Y(m.start.z) }, B = { x: X(m.end.x), y: Y(m.end.z) };
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L; if (ny < 0) { nx = -nx; ny = -ny; } // נורמל כלפי מטה (במסך)
    const t = h * k, top = m.anchor === 'top' && m.kind !== 'column';
    const o0 = top ? 0 : -t / 2, o1 = top ? t : t / 2;
    const pts = [[A.x + nx * o0, A.y + ny * o0], [B.x + nx * o0, B.y + ny * o0], [B.x + nx * o1, B.y + ny * o1], [A.x + nx * o1, A.y + ny * o1]];
    return <polygon key={m.id} points={pts.map((q) => q.join(',')).join(' ')} className={`fs-m ${m.kind}`} />;
  };
  const yDim = H - padBot + 30, yOv = H - padBot + 50;
  // מידה נוספת (אופציונלית) בכל ציר: פני עליון הפטות / הגג הגמור — לתיאום עם האדריכל (קריאה בלבד)
  const extra = p.settings.heightDatum === 'purlin' || p.settings.heightDatum === 'roof' ? p.settings.heightDatum : null;
  const extraAt = (x: number) => {
    const q = sec.planes.filter((o) => o.x0 - 1 <= x && x <= o.x1 + 1).sort((a2, c) => zAt(c, x) - zAt(a2, x))[0]; if (!q) return null;
    const kk = Math.sqrt(1 + ((q.z1 - q.z0) / ((q.x1 - q.x0) || 1)) ** 2);
    const pm = d.members.find((m) => m.purlin?.side === q.id) ?? d.members.find((m) => m.purlin);
    const ph = (pm ? tryProfile(pm.profile)?.props.h : undefined) ?? 0;
    const rc = b.cladding?.roof;
    return zAt(q, x) + ph * kk + (extra === 'roof' && rc?.enabled ? (rc.thickness ?? 0) : 0);
  };
  return (
    <div className="fs" data-testid="frame-section">
      <div className="fs-head">
        <b>חתך מסגרת — גבהים מ־±0.00</b>
        <span className="fs-mode" role="radiogroup" aria-label="כששינוי גובה בציר">
          <span>שינוי גובה בציר:</span>
          <button role="radio" aria-checked={mode === 'local'} className={`tbtn${mode === 'local' ? ' on' : ''}`} onClick={() => setMode('local')} data-testid="fs-mode-local" title="הרכס והצירים האחרים נשארים — השיפוע משתנה">רק בציר הזה</button>
          <button role="radio" aria-checked={mode === 'all'} className={`tbtn${mode === 'all' ? ' on' : ''}`} onClick={() => setMode('all')} data-testid="fs-mode-all" title="כל הגג עולה/יורד — השיפועים נשמרים">כל הגג (שיפוע נשמר)</button>
        </span>
        <span className="fs-mode">
          <label className="fs-num" title="חלוקה שווה בין הצירים הקיצוניים">צירים<NumField testId="fs-axis-n" value={sec.lines.length} onCommit={(v) => apply(setAxisCount(sec, v), 'מספר צירים')} /></label>
          <label className="fs-num" title="רוחב בין הצירים הקיצוניים — חלוקה שווה">רוחב<LenField testId="fs-axis-w" mm={lines[lines.length - 1].x - lines[0].x} unit={p.displayUnit} onCommit={(v) => apply(setAxisCount(sec, sec.lines.length, v), 'רוחב כולל')} /></label>
          <button className="btn small" data-testid="fs-add-axis" onClick={() => {
            const last = lines[lines.length - 1], prev = lines[lines.length - 2];
            const dx = prev ? last.x - prev.x : 6000, nx = last.x + dx;
            let id = 'C1'; for (let n = 1; sec.lines.some((q) => q.id === id); n++) id = `C${n}`;
            apply({ ...sec, template: undefined, lines: [...sec.lines, { id, x: nx }], planes: sec.planes.map((q) => {
              if (q.x1 < last.x - 1) return q; const sl = (q.z1 - q.z0) / ((q.x1 - q.x0) || 1); return { ...q, x1: q.x1 + dx, z1: q.z1 + sl * dx };
            }) }, 'הוספת ציר');
          }}>+ ציר</button>
          <span>הגובה בציר נקבע ל:</span>
          <select className="inp" value={b.heightRef} data-testid="fs-href" onChange={(e) => store.exec(setBuilding({ heightRef: e.target.value as 'TOS' | 'AXIS' }))}>
            <option value="TOS">פני עליון הקורה</option><option value="AXIS">ציר הקורה</option>
          </select>
        </span>
        <label className="fs-mode">מידה נוספת בכל ציר:
          <select className="inp" value={extra ?? ''} data-testid="fs-extra" onChange={(e) => store.exec(setSettings({ heightDatum: (e.target.value || 'tos') as 'tos' | 'purlin' | 'roof' }))}>
            <option value="">ללא</option><option value="purlin">פני עליון הפטות</option><option value="roof">פני הגג הגמור (פטה + פנל)</option>
          </select></label>
      </div>
      <div className="fs-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="fs-svg" role="img" aria-label="חתך מסגרת עם מידות">
          <line x1={8} y1={Y(base)} x2={W - 8} y2={Y(base)} className="fs-g" />
          {mem.map(band)}
          {/* צירים: בועה, קו ציר, ושתי מידות גובה */}
          {lines.map((l, i) => {
            const col = colOf(l.x), ct = col ? columnTopAt(col, l.x) : null, tos = topAt(l.x);
            const right = l.x >= (L0 + R1) / 2, lx = X(l.x) + (right ? 10 : -10), anc = right ? 'start' : 'end';
            return (
              <g key={l.id} data-testid={`fs-ax-${i}`}>
                <line x1={X(l.x)} y1={Y(base) + 4} x2={X(l.x)} y2={Y(tos) - 14} className="fs-axis" />
                <g className="fs-lvl ed" onClick={() => setPop(pop?.id === l.id ? null : { id: l.id, at: { x: (X(l.x) / W) * 100, y: ((Y(base) + 30) / H) * 100 } })} data-testid={`fs-bub-${i}`}>
                  <circle cx={X(l.x)} cy={Y(base) + 16} r={10} className={`fs-bub${l.wall ? ' wall' : ''}`} /><text x={X(l.x)} y={Y(base) + 20} className="fs-t c b">{b.lineLabels?.[l.id] || lineLabel(i)}</text></g>
                {col && (() => { const zb = Math.min(col.start.z, col.end.z), rel = zb - (b.baseElevation ?? 0); return (
                  <g className="fs-lvl ed" onClick={() => open({ kind: 'base', key: l.id, value: rel }, lx, Y(zb) - 18)} data-testid={`fs-base-${i}`}>
                    <text x={lx} y={Y(zb) - 6} className={`fs-t ${anc} base`}>{`תחתית עמוד ${rel ? m3(rel) : '\u2066±0.00\u2069'}`}</text></g>); })()}
                {l.wall && <text x={X(l.x)} y={Y(tos) + 40} className="fs-t c tip">קיר קיים</text>}
                <g className="fs-lvl ed" onClick={() => open({ kind: 'axis', key: String(l.x), value: tos }, lx, Y(tos) - 16)} data-testid={`fs-tos-${i}`}>
                  <path d={`M${X(l.x) - 5},${Y(tos) - 9} h10 l-5,7 z`} className="fs-tri tos" />
                  <text x={lx} y={Y(tos) - 4} className={`fs-t ${anc} tos`}>{`${b.heightRef === 'AXIS' ? 'ציר קורה' : 'ע.ע. קורה'} ${m3(tos)}`}</text>
                </g>
                {extra && (() => { const ze = extraAt(l.x); return ze === null ? null : <g className="fs-lvl" data-testid={`fs-extra-${i}`}>
                  <text x={lx} y={Y(tos) - 22} className={`fs-t ${anc} ext`}>{`${extra === 'roof' ? 'גג גמור' : 'ע.ע. פטה'} ${m3(ze)}`}</text></g>; })()}
                {ct !== null && <g className="fs-lvl" data-testid={`fs-col-${i}`}>
                  <path d={`M${X(l.x) - 5},${Y(ct) + 2} h10 l-5,7 z`} className="fs-tri col" />
                  <text x={lx} y={Y(ct) + 14} className={`fs-t ${anc} col`}>{`ראש עמוד ${m3(ct)}`}</text>
                </g>}
              </g>
            );
          })}
          {/* מידות אנכיות בצירים הקיצוניים (מחוץ למסגרת): ±0.00 → ראש עמוד → ע.ע. קורה */}
          {[lines[0], lines[lines.length - 1]].filter((l, i, a) => i === 0 || a[0].id !== l.id).map((l, i) => {
            const col = colOf(l.x); if (!col) return null;
            const ct = columnTopAt(col, l.x), tos = topAt(l.x), z0 = Math.min(col.start.z, col.end.z);
            const vx = i === 0 ? X(Math.min(l.x, L0)) - 108 : X(Math.max(l.x, R1)) + 108;
            const seg = (a: number, c: number, key: string) => <g key={key} className="fs-dim">
              <line x1={vx} y1={Y(a)} x2={vx} y2={Y(c)} /><line x1={vx - 4} y1={Y(a)} x2={vx + 4} y2={Y(a)} /><line x1={vx - 4} y1={Y(c)} x2={vx + 4} y2={Y(c)} />
              <text x={vx - 5} y={(Y(a) + Y(c)) / 2} className="fs-t c" transform={`rotate(-90 ${vx - 5} ${(Y(a) + Y(c)) / 2})`}>{Math.round(c - a)}</text></g>;
            return <g key={`v${l.id}`} data-testid={`fs-vdim-${i}`}>{seg(z0, ct, 'a')}{seg(ct, tos, 'b')}</g>;
          })}
          {/* רכס / שבירה */}
          {juncs.map((j) => (
            <g key={j.x} className="fs-lvl ed" onClick={() => open({ kind: 'junc', key: String(j.x), value: j.z }, X(j.x), Y(j.z) - 30)} data-testid="fs-ridge">
              <path d={`M${X(j.x) - 5},${Y(j.z) - 23} h10 l-5,7 z`} className="fs-tri tos" />
              <text x={X(j.x)} y={Y(j.z) - 27} className="fs-t c tos">{`רכס ע.ע. ${m3(j.z)}`}</text>
            </g>
          ))}
          {/* שיפועים */}
          {sec.planes.map((q) => {
            // השיפוע — באמצע המפתח הרחב ביותר בתוך המישור (לא על ציר, שם יש תוויות גובה)
            const pts = [q.x0, ...lines.map((l) => l.x).filter((x) => x > q.x0 + 1 && x < q.x1 - 1), q.x1];
            let xm = (q.x0 + q.x1) / 2, gap = 0;
            for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > gap) { gap = pts[i] - pts[i - 1]; xm = (pts[i] + pts[i - 1]) / 2; }
            const s = ((q.z1 - q.z0) / ((q.x1 - q.x0) || 1)) * 100;
            return <g key={q.id} className="fs-lvl ed" onClick={() => open({ kind: 'slope', key: q.id, value: Math.abs(s), pct: true }, X(xm), Y(zAt(q, xm)) - 22)} data-testid={`fs-slope-${q.id}`}>
              <text x={X(xm)} y={Y(zAt(q, xm)) - 10} className="fs-t c slope">{`${Math.abs(s).toFixed(1)}%`}</text></g>;
          })}
          {/* קצה קונזולה — קריאה בלבד */}
          {[sec.planes.reduce((a, q) => (q.x0 < a.x0 ? q : a)), sec.planes.reduce((a, q) => (q.x1 > a.x1 ? q : a))].map((q, i) => {
            const x = i ? q.x1 : q.x0, z = i ? q.z1 : q.z0;
            if (lines.some((l) => near(l.x, x, 50))) return null;
            // גובה קצה הקונזולה — ליד מידת הקונזולה למטה (לא על תוויות הציר)
            return <text key={i} x={X(x)} y={yOv + 16} className="fs-t c tip" data-testid={`fs-tip-${i}`}>{`קצה ע.ע. ${m3(z)}`}</text>;
          })}
          {/* מפתחים וקונזולות */}
          {lines.slice(1).map((l, i) => {
            const a = X(lines[i].x), c = X(l.x);
            return <g key={`s${i}`} className="fs-dim ed" onClick={() => open({ kind: 'span', key: String(i), value: l.x - lines[i].x }, (a + c) / 2, yDim - 8)} data-testid={`fs-span-${i}`}>
              <line x1={a} y1={yDim} x2={c} y2={yDim} /><line x1={a} y1={yDim - 4} x2={a} y2={yDim + 4} /><line x1={c} y1={yDim - 4} x2={c} y2={yDim + 4} />
              <text x={(a + c) / 2} y={yDim - 4} className="fs-t c">{((l.x - lines[i].x) / 1000).toFixed(2)}</text></g>;
          })}
          {<g className="fs-dim ed" onClick={() => open({ kind: 'ovl', key: '', value: Math.max(0, lines[0].x - L0) }, (X(L0) + X(lines[0].x)) / 2, yOv - 8)} data-testid="fs-ovl"><title>קונזולה שמאל — לחיצה לעריכה (גם כשהיא 0)</title>
            <line x1={X(L0)} y1={yOv} x2={X(lines[0].x)} y2={yOv} /><text x={(X(L0) + X(lines[0].x)) / 2} y={yOv - 4} className="fs-t c">{(Math.max(0, lines[0].x - L0) / 1000).toFixed(2)}</text></g>}
          {<g className="fs-dim ed" onClick={() => open({ kind: 'ovr', key: '', value: Math.max(0, R1 - lines[lines.length - 1].x) }, (X(R1) + X(lines[lines.length - 1].x)) / 2, yOv - 8)} data-testid="fs-ovr"><title>קונזולה ימין — לחיצה לעריכה (גם כשהיא 0)</title>
            <line x1={X(lines[lines.length - 1].x)} y1={yOv} x2={X(R1)} y2={yOv} /><text x={(X(R1) + X(lines[lines.length - 1].x)) / 2} y={yOv - 4} className="fs-t c">{(Math.max(0, R1 - lines[lines.length - 1].x) / 1000).toFixed(2)}</text></g>}
          <g className="fs-lvl ed" onClick={() => open({ kind: 'blev', key: '', value: base }, W - 50, Y(base) - 20)} data-testid="fs-base-level"><text x={W - 10} y={Y(base) - 5} className="fs-t end b">{`מפלס בסיס ${base ? m3(base) : '\u2066±0.00\u2069'}`}</text></g>
        </svg>
        {pop && (() => { const l = sec.lines.find((q) => q.id === pop.id); if (!l) return null; const i = lines.findIndex((q) => q.id === l.id); return (
          <div className="fs-pop" style={{ left: `${pop.at.x}%`, top: `${pop.at.y}%` }} data-testid="fs-pop" role="dialog" aria-label="ציר">
            <label>שם הציר<input className="inp" data-testid="fs-ax-name" defaultValue={b.lineLabels?.[l.id] ?? ''} placeholder={lineLabel(i)} key={l.id}
              onBlur={(e) => { const v = e.target.value.trim(); if (v === (b.lineLabels?.[l.id] ?? '')) return; const nl = { ...(b.lineLabels ?? {}) }; if (v) nl[l.id] = v; else delete nl[l.id]; store.exec(setBuilding({ lineLabels: Object.keys(nl).length ? nl : undefined })); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></label>
            <label className="row"><input type="checkbox" data-testid="fs-ax-wall" checked={!!l.wall} onChange={(e) => apply({ ...sec, lines: sec.lines.map((q) => (q.id === l.id ? { ...q, wall: e.target.checked || undefined } : q)) }, 'קיר קיים')} />קיר קיים (ללא עמוד)</label>
            <div className="row">{sec.lines.length > 2 && <button className="btn small" data-testid="fs-ax-del" onClick={() => { setPop(null); apply({ ...sec, template: undefined, lines: sec.lines.filter((q) => q.id !== l.id) }, 'מחיקת ציר'); }}>מחיקת הציר</button>}
              <span className="sp" /><button className="btn small" onClick={() => setPop(null)}>סגירה</button></div>
          </div>); })()}
        {edit && <input className="inp num fs-inp" autoFocus data-testid="fs-input" style={{ left: `${edit.at.x}%`, top: `${edit.at.y}%` }}
          defaultValue={edit.pct ? edit.value.toFixed(1) : (edit.value / 1000).toFixed(3)} title={edit.pct ? 'אחוזים' : 'מטר'}
          onKeyDown={(e) => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value.replace(',', '.')); if (Number.isFinite(v)) commit(v); else setEdit(null); } if (e.key === 'Escape') setEdit(null); }}
          onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); const cur = edit.pct ? edit.value : edit.value / 1000; if (Number.isFinite(v) && Math.abs(v - cur) > 1e-6) commit(v); else setEdit(null); }} />}
      </div>
      <div className="fs-legend"><span><i className="fs-tri tos" />ע.ע. קורה — פני עליון קורת הגג על ציר העמוד (לעריכה)</span><span><i className="fs-tri col" />ראש עמוד — כפי שנבנה (מתחת לקורה ולפלטה)</span><span>לחיצה על מידה כתומה / שיפוע / מפתח — עריכה</span></div>
    </div>
  );
}
