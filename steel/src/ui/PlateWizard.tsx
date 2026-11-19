import { useState } from 'react';
import { setBuilding, setConnectionDefault, setKneeBraces } from '../commands/commands';
import { dot, sub, type Vec3 } from '../core/vec';
import { localFrame } from '../geometry/frame';
import { defaultKneeBraces } from '../geometry/knee';
import { defaultPortal } from '../geometry/portal';
import { defaultSideConn } from '../model/defaults';
import type { Connection, Member, PlateConnParams, Project } from '../model/types';
import { applyStandard, loadStandard, saveStandard } from '../persist/shopStandard';
import { tryProfile } from '../profiles/library';
import { store, useStore } from '../store';
import { cachedSolid } from '../view/scene';
import { Schematic, type SDim } from './Schematic';
import { BoltSelect } from './fields';

type Pt = { x: number; y: number };
const r1 = (v: number) => Math.round(v * 10) / 10;


function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** פרמטרים לפי סוג החיבור: ערכים אפקטיביים + פונקציית עדכון (חל על כל החיבורים מאותו סוג בפרויקט) */
function plateParams(p: Project, c: Connection): { kind: 'plate'; type: 'eave' | 'ridge' | 'base' | 'side'; v: PlateConnParams } | { kind: 'other' } {
  const t = c.type === 'rafter-side' ? 'side' : c.type;
  if (t === 'eave' || t === 'ridge' || t === 'base') return { kind: 'plate', type: t, v: p.connectionDefaults[t] };
  if (t === 'side') return { kind: 'plate', type: 'side', v: p.connectionDefaults.side ?? defaultSideConn() };
  return { kind: 'other' };
}

/**
 * אשף פלטות: שרטוט הפלטה בפועל (מהמודל) עם החתך המחובר, חורים ומידות. מידה מסומנת ✎ — לחיצה ושינוי.
 * השינוי חל על כל הפלטות מאותו סוג בפרויקט; "שמור כסטנדרט מסגריה" — ברירת מחדל לכל פרויקט חדש.
 */
export function PlateWizard({ c, plateId }: { c: Connection; plateId?: string }) {
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const [msg, setMsg] = useState('');
  const plates = c.parts.map((id) => d.byId.get(id)).filter((m): m is Member => !!m && (m.kind === 'plate' || m.kind === 'cleat'));
  const pm = (plateId && plates.find((x) => x.id === plateId)) || plates[0];
  const same = d.connections.filter((x) => x.type === c.type).length;
  if (!pm) return null;
  const f = localFrame(pm);
  const s0 = cachedSolid(pm);
  const P2 = (q: Vec3): Pt => ({ x: dot(sub(q, pm.start), f.ex), y: dot(sub(q, pm.start), f.u) });
  const outline = hull([...s0.startRing, ...s0.endRing].map(P2));
  const bx0 = Math.min(...outline.map((q) => q.x)), bx1 = Math.max(...outline.map((q) => q.x));
  const by0 = Math.min(...outline.map((q) => q.y)), by1 = Math.max(...outline.map((q) => q.y));
  const tPl = Math.abs(Math.max(...s0.startRing.map((q) => dot(q, f.v))) - Math.min(...s0.startRing.map((q) => dot(q, f.v))));
  const holes = c.bolts.filter((b) => b.holesIn.includes(pm.id)).map((b) => ({ ...P2(b.p), d: b.hole }));
  const studs = d.members.filter((a) => a.kind === 'anchor' && a.connId === c.id).map((a) => ({ ...P2(a.start), d: Number(a.profile.replace(/\D/g, '')) || 16 }));
  const pts = [...holes, ...studs];
  // חתכים מחוברים: ציר ניצב לפלטה — מתאר החתך; ציר מקביל — רצועה (היטל) בתחום הפלטה
  const hosts = c.members.map((id) => d.byId.get(id)).filter((m): m is Member => !!m && m.id !== pm.id).map((m) => {
    const fm = localFrame(m);
    const sm = cachedSolid(m);
    const perp = Math.abs(dot(fm.ex, f.v)) > 0.8;
    const ring = perp ? ([sm.startRing, sm.endRing].sort((a, b) => Math.abs(dot(sub(a[0], pm.start), f.v)) - Math.abs(dot(sub(b[0], pm.start), f.v)))[0]) : [...sm.startRing, ...sm.endRing];
    return { id: m.id, perp, pts: perp ? ring.map(P2) : hull(ring.map(P2)), prof: m.profile };
  });
  // קנ"מ לשרטוט
  const W = 200, H = 175, pad = 18;
  const k = Math.min((W - 2 * pad - 26) / (bx1 - bx0 || 1), (H - 2 * pad - 22) / (by1 - by0 || 1));
  const cx = pad + 4 + ((W - 2 * pad - 26) - (bx1 - bx0) * k) / 2, cy = pad - 4 + ((H - 2 * pad - 22) - (by1 - by0) * k) / 2;
  const X = (x: number) => cx + (x - bx0) * k, Y = (y: number) => cy + (by1 - y) * k;
  const xy = (q: Pt): [number, number] => [X(q.x), Y(q.y)];

  const pp = plateParams(p, c);
  const setPlate = (patch: Partial<PlateConnParams>) => { if (pp.kind === 'plate') store.exec(setConnectionDefault(pp.type, patch)); };
  const chain = (vals: number[]) => [...new Set(vals.map((v) => Math.round(v * 2) / 2))].sort((a, b) => a - b);
  const xs = chain([bx0, ...pts.map((q) => q.x), bx1]), ys = chain([by0, ...pts.map((q) => q.y), by1]);
  const dims: SDim[] = [];
  const v = pp.kind === 'plate' ? pp.v : null;
  // מיפוי מידות ← פרמטרים (פלטות קצה/ראש/בסיס): לאורך ex = l/pitch/rows, לאורך u = w/gauge/cols
  const along = (axis: 'x' | 'y', vals: number[], i: number): SDim['onCommit'] => {
    if (!v) return undefined;
    const n = vals.length - 1;
    const spacing = axis === 'x' ? v.pitch : v.gauge, overall = axis === 'x' ? v.l : v.w;
    const nBolt = axis === 'x' ? v.rows : v.cols;
    if (i === 0 || i === n - 1) {
      if (!(overall > 0) || nBolt < 1) return undefined;
      const inner = (nBolt - 1) * spacing;
      return (e) => setPlate(axis === 'x' ? { l: Math.round(inner + 2 * e) } : { w: Math.round(inner + 2 * e) });
    }
    if (!(spacing > 0)) return undefined;
    return (s) => setPlate(axis === 'x' ? { pitch: Math.round(s), ...(v.l > 0 ? { l: Math.round(v.l + (s - v.pitch) * (v.rows - 1)) } : {}) } : { gauge: Math.round(s), w: Math.round(v.w + (s - v.gauge) * (v.cols - 1)) });
  };
  for (let i = 1; i < xs.length; i++) dims.push({ a: [X(xs[i - 1]), Y(by0)], b: [X(xs[i]), Y(by0)], off: -8, value: xs[i] - xs[i - 1], testId: `pw-x${i - 1}`, onCommit: along('x', xs, i - 1), min: 5 });
  for (let i = 1; i < ys.length; i++) dims.push({ a: [X(bx1), Y(ys[i - 1])], b: [X(bx1), Y(ys[i])], off: -8, value: ys[i] - ys[i - 1], testId: `pw-y${i - 1}`, onCommit: along('y', ys, i - 1), min: 5 });
  if (xs.length > 2) dims.push({ a: [X(bx0), Y(by0)], b: [X(bx1), Y(by0)], off: -17, value: bx1 - bx0, testId: 'pw-L', onCommit: v && v.l > 0 ? (L) => setPlate({ l: Math.round(L) }) : undefined, derived: !(v && v.l > 0) });
  if (ys.length > 2) dims.push({ a: [X(bx1), Y(by0)], b: [X(bx1), Y(by1)], off: -17, value: by1 - by0, testId: 'pw-W', onCommit: v ? (Wd) => setPlate({ w: Math.round(Wd) }) : undefined });

  // "איך נקבע" + בדיקות מרחקי שפה (e ≥ 1.2·d0)
  const why: { t: string; bad?: boolean }[] = [];
  const d0 = holes[0]?.d ?? studs[0]?.d ?? 0;
  if (pts.length) {
    const eMin = Math.min(...pts.flatMap((q) => [q.x - bx0, bx1 - q.x, q.y - by0, by1 - q.y]));
    why.push({ t: `מרחק שפה מזערי ${r1(eMin)} מ"מ — דרוש ≥ 1.2·d0 = ${r1(1.2 * d0)}`, bad: eMin < 1.2 * d0 - 0.5 });
  }
  if (v) {
    const col = hosts.find((h) => h.perp);
    const hp = col ? tryProfile(col.prof) : null;
    if (v.cols > 1) why.push({ t: `רוחב ${r1(by1 - by0)} = ${v.cols - 1}×${v.gauge} (מרווח ברגים) + 2×${r1((by1 - by0 - (v.cols - 1) * v.gauge) / 2)} (שפה)` });
    if (v.rows > 1 && v.pitch > 0) why.push({ t: `אורך ${r1(bx1 - bx0)} = ${v.rows - 1}×${v.pitch} (מרווח שורות) + 2×${r1((bx1 - bx0 - (v.rows - 1) * v.pitch) / 2)} (שפה)` });
    else if (!(v.l > 0)) why.push({ t: `אורך ${r1(bx1 - bx0)} — נגזר מגובה החתך המחובר (${hosts.map((h) => h.prof).join(' / ')}) + הרחבה` });
    if (hp && (c.type === 'eave' || c.type === 'base')) {
      const out = (v.pitch / 2) > hp.props.h / 2;
      why.push({ t: `${hosts.find((h) => h.perp)!.prof}: h=${r1(hp.props.h)}, b=${r1(hp.props.b)} — ברגים ${out ? 'מחוץ להיטל העמוד (גישת מפתח)' : 'בתוך היטל העמוד'}`, bad: c.type === 'eave' && !out });
    }
    why.push({ t: `עובי ${v.t} · ${v.cols}×${v.rows} ברגים M${v.bolt.d} ${v.bolt.grade} · ריתוך a${v.weldSize}` });
  } else why.push({ t: `${pm.partDesc ?? pm.label} · עובי ${r1(tPl)} מ"מ · ${holes.length} חורים${d0 ? ` Ø${d0}` : ''}` });

  const saveStd = () => setMsg(saveStandard(store.state.project) ? 'נשמר — יוחל אוטומטית בכל פרויקט חדש' : 'השמירה נכשלה (אחסון חסום בדפדפן)');
  const applyStd = () => { const st = loadStandard(); if (!st) { setMsg('אין סטנדרט שמור'); return; } store.exec({ label: 'החלת סטנדרט מסגריה', run: (pr) => applyStandard(pr, st) }); setMsg('הסטנדרט הוחל על הפרויקט'); };

  return (
    <div className="plate-wiz" data-testid="plate-wizard">
      <div className="pw-h"><b>אשף פלטה</b> <span className="mono">{pm.profile.replace(/^PL/, 'PL')}</span> · {pm.partDesc ?? pm.label}</div>
      <Schematic w={W} h={H} dims={dims} testId="pw-sch" caption={`לחיצה על מידה ✎ — חל על כל ${same} החיבורים מסוג זה בפרויקט`}>
        <defs><clipPath id="pwclip"><rect x={X(bx0) - 14} y={Y(by1) - 14} width={(bx1 - bx0) * k + 28} height={(by1 - by0) * k + 28} /></clipPath></defs>
        {hosts.filter((h) => !h.perp).map((h) => <polygon key={h.id} points={h.pts.map((q) => xy(q).join(',')).join(' ')} className="sm-thin" clipPath="url(#pwclip)" />)}
        <polygon points={outline.map((q) => xy(q).join(',')).join(' ')} className="sm-plate" />
        {hosts.filter((h) => h.perp).map((h) => <polygon key={h.id} points={h.pts.map((q) => xy(q).join(',')).join(' ')} className="sm-host" />)}
        {holes.map((q, i) => <circle key={i} cx={X(q.x)} cy={Y(q.y)} r={Math.max(1.2, (q.d / 2) * k)} className="sm-bolt" />)}
        {studs.map((q, i) => <g key={`s${i}`}><circle cx={X(q.x)} cy={Y(q.y)} r={Math.max(1.2, (q.d / 2) * k)} className="sm-bolt" strokeDasharray="1 0.6" /><line x1={X(q.x) - 1.5} y1={Y(q.y) - 1.5} x2={X(q.x) + 1.5} y2={Y(q.y) + 1.5} className="sm-thin" /></g>)}
        {hosts.map((h, i) => <text key={`t${h.id}`} x={6} y={H - 6 - i * 7} className="sm-lbl-s">{h.perp ? '■' : '┄'} {h.prof}</text>)}
      </Schematic>
      <ul className="pw-why" data-testid="pw-why">{why.map((w, i) => <li key={i} className={w.bad ? 'bad' : ''}>{w.bad ? '⚠ ' : ''}{w.t}</li>)}</ul>
      {v && (
        <div className="pw-fields">
          <label>עובי<input className="inp num" data-testid="pw-t" type="number" defaultValue={v.t} key={`t${v.t}`} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== v.t && setPlate({ t: Number(e.target.value) })} /></label>
          <label>בורג<BoltSelect testId="pw-bolt" d={v.bolt.d} onChange={(n) => setPlate({ bolt: { ...v.bolt, d: n } })} /></label>
          <label>עמודות<span className="pm"><button className="btn small" data-testid="pw-cols-" onClick={() => v.cols > 1 && setPlate({ cols: v.cols - 1, w: Math.round(v.w - v.gauge) })}>−</button><b>{v.cols}</b><button className="btn small" data-testid="pw-cols+" onClick={() => setPlate({ cols: v.cols + 1, w: Math.round(v.w + v.gauge) })}>+</button></span></label>
          <label>שורות<span className="pm"><button className="btn small" data-testid="pw-rows-" onClick={() => v.rows > 1 && setPlate({ rows: v.rows - 1, ...(v.l > 0 && v.pitch > 0 ? { l: Math.round(v.l - v.pitch) } : {}) })}>−</button><b>{v.rows}</b><button className="btn small" data-testid="pw-rows+" onClick={() => setPlate({ rows: v.rows + 1, ...(v.l > 0 && v.pitch > 0 ? { l: Math.round(v.l + v.pitch) } : {}) })}>+</button></span></label>
        </div>
      )}
      {pp.kind === 'other' && <OtherPlateFields c={c} />}
      <div className="row pw-std">
        <button className="btn small" data-testid="pw-save-std" onClick={saveStd}>שמור כסטנדרט מסגריה</button>
        <button className="btn small" data-testid="pw-apply-std" onClick={applyStd}>החל סטנדרט על הפרויקט</button>
      </div>
      {msg && <div className="hint" data-testid="pw-msg">{msg}</div>}
    </div>
  );
}

/** חיבורים שאינם פלטת קצה/ראש/בסיס: השדות שקובעים את הפח (לכל החיבורים מאותו סוג) */
function OtherPlateFields({ c }: { c: Connection }) {
  const b = useStore((s) => s.project.building);
  const num = (label: string, val: number, on: (v: number) => void, tid: string) => (
    <label>{label}<input className="inp num" data-testid={tid} type="number" defaultValue={val} key={`${tid}${val}`} onBlur={(e) => { const x = Number(e.target.value); if (x > 0 && x !== val) on(x); }} /></label>
  );
  if (c.type === 'knee') {
    const kb = b.kneeBraces ?? defaultKneeBraces();
    return (
      <div className="pw-fields">
        <label>פרט חיבור<select className="inp" data-testid="pw-kb-detail" value={kb.detail === 'flange' ? 'flange' : 'fin'} onChange={(e) => store.exec(setKneeBraces({ detail: e.target.value as 'fin' | 'flange' }))}>
          <option value="fin">פח מרותך + לשונית בחריץ</option><option value="flange">פלטת קצה מוברגת לאגף</option>
        </select></label>
        {num('עובי פח', kb.plateT, (v) => store.exec(setKneeBraces({ plateT: v })), 'pw-kb-t')}
        {kb.detail !== 'flange' && <label>ברגים בקצה<select className="inp" data-testid="pw-kb-n" value={kb.boltsPerEnd ?? 2} onChange={(e) => store.exec(setKneeBraces({ boltsPerEnd: Number(e.target.value) }))}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
        <label>בורג<BoltSelect d={kb.bolt.d} onChange={(n) => store.exec(setKneeBraces({ bolt: { ...kb.bolt, d: n } }))} /></label>
      </div>
    );
  }
  if (c.id.startsWith('C.BB') || c.id.startsWith('C.PB')) {
    const pt = b.bracing.walls.portal ?? defaultPortal();
    const set = (patch: Partial<typeof pt>) => store.exec(setBuilding({ bracing: { ...b.bracing, walls: { ...b.bracing.walls, portal: { ...pt, ...patch } } } }));
    return (
      <div className="pw-fields">
        {num('עובי פח', pt.plateT, (v) => set({ plateT: v }), 'pw-pb-t')}
        <label>ברגים באלכסון<select className="inp" value={pt.boltsPerEnd ?? 2} onChange={(e) => set({ boltsPerEnd: Number(e.target.value) })}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>ברגים בקורה<select className="inp" value={pt.beamBolts ?? 2} onChange={(e) => set({ beamBolts: Number(e.target.value) })}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
    );
  }
  if (c.type === 'brace-end' || c.type === 'brace-cross' || c.type === 'brace') {
    const bc = b.bracing.conn;
    const set = (patch: Partial<typeof bc>) => store.exec(setBuilding({ bracing: { ...b.bracing, conn: { ...bc, ...patch } } }));
    return (
      <div className="pw-fields">
        {num('עובי פח', bc.gussetT, (v) => set({ gussetT: v }), 'pw-br-t')}
        {num('ברגים בקצה', bc.boltsPerEnd, (v) => set({ boltsPerEnd: Math.round(v) }), 'pw-br-n')}
        {num('מרווח ברגים', bc.pitch, (v) => set({ pitch: v }), 'pw-br-p')}
        {num('מרחק קצה', bc.endDist, (v) => set({ endDist: v }), 'pw-br-e')}
        {num('שפת פח', bc.gussetEdge, (v) => set({ gussetEdge: v }), 'pw-br-g')}
        <label>בורג<BoltSelect d={bc.bolt.d} onChange={(n) => set({ bolt: { ...bc.bolt, d: n } })} /></label>
      </div>
    );
  }
  if (c.type === 'purlin-splice') {
    const sp = b.purlins.splice;
    const set = (patch: Partial<typeof sp>) => store.exec(setBuilding({ purlins: { ...b.purlins, splice: { ...sp, ...patch } } }));
    return (
      <div className="pw-fields">
        {num('עובי פלטה', sp.plateT, (v) => set({ plateT: v }), 'pw-ps-t')}
        {num('מרחק מהתפר', sp.jointOffset, (v) => set({ jointOffset: v }), 'pw-ps-o')}
        {num('שפה', sp.edge, (v) => set({ edge: v }), 'pw-ps-e')}
        <label>בורג<BoltSelect d={sp.bolt.d} onChange={(n) => set({ bolt: { ...sp.bolt, d: n } })} /></label>
      </div>
    );
  }
  if (c.type === 'purlin-cleat') return <div className="hint">תומך פטה: עריכת מידות הזוויתן והברגים — "פתח בעורך החיבור" (כל התומכים בשיפוע או תומך בודד).</div>;
  return <div className="hint">פח זה נקבע אוטומטית מהחתכים המחוברים (ראה "איך נקבע"). שינוי — דרך החתכים או הגדרות החיבור.</div>;
}
