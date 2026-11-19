import { GUTTER_DEVS, gutterDev, gutterRuns, gutterSpec } from '../geometry/gutter';
import type { GutterSpec } from '../model/types';
import { OpeningsSchematic, RoofPanelSchematic, WallCladSchematic } from './schematics';
import { Schematic, type SDim } from './Schematic';
import { useState } from 'react';
import { useMemo } from 'react';
import { setBuilding } from '../commands/commands';
import { claddingTakeoff, defaultCladding, ROOF_KINDS, WALL_HE } from '../geometry/cladding';
import type { CladdingParams, OpeningDef, WallId } from '../model/types';
import { store, useStore } from '../store';
import { Adv, LenField, NumField, ProfilePicker, TextField } from './fields';
import { Icon } from './icons';

export type CladSection = 'roof' | 'walls' | 'openings' | 'takeoff';
const m2 = (n: number) => n.toFixed(1);
const m = (mm: number) => (mm / 1000).toFixed(2);

/** חיפוי גג וקירות, פטות קיר ועמודי רוח, פתחים, מזחלות וכתב כמויות */
export function CladdingPanel({ section }: { section?: CladSection } = {}) {
  const show = (k: CladSection) => !section || section === k;
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const [opSel0, setOpSel] = useState<number | null>(null);
  const [wallTab, setWallTab] = useState<WallId>('L');
  // גובה ראש הקיר (לשרטוט): עמודי הקיר בפועל
  const eaveOf = (w: string) => { const cols = d.members.filter((m) => m.kind === 'column'); const xs = cols.map((c) => c.start.x); const pick = w === 'L' ? cols.filter((c) => c.start.x === Math.min(...xs)) : w === 'R' ? cols.filter((c) => c.start.x === Math.max(...xs)) : cols; return pick.length ? Math.max(...pick.map((c) => Math.max(c.start.z, c.end.z))) - p.building.baseElevation : 6000; };
  const unit = p.displayUnit;
  const cl = p.building.cladding;
  const set = (patch: Partial<CladdingParams>) => store.exec(setBuilding({ cladding: { ...(cl ?? defaultCladding()), ...patch } }));
  const t = useMemo(() => (cl ? claddingTakeoff(p, d) : null), [p, d, cl]);
  if (!cl) {
    return (
      <div className="panel-body" data-testid="clad-panel">
        <div className="panel-title">חיפוי, פטות קיר ומזחלות</div>
        <div className="hint">חיפוי גג וקירות, פטות קיר ועמודי רוח בקירות הקצה, פתחים (שערים/חלונות), מזחלות ומרזבים — עם כתב כמויות שנכנס להצעת המחיר.</div>
        <button className="btn primary" data-testid="clad-enable" onClick={() => store.exec(setBuilding({ cladding: defaultCladding() }))}>הוספת חיפוי למבנה</button>
      </div>
    );
  }
  const ops = cl.openings;
  const opSel = opSel0 !== null && opSel0 < ops.length ? opSel0 : ops.length ? ops.length - 1 : null;
  const setOp = (i: number, patch: Partial<OpeningDef>) => set({ openings: ops.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  return (
    <div className="panel-body" data-testid="clad-panel">
      {show('roof') && <>
        <div className="panel-title">חיפוי גג ומזחלות</div>
        <label className="row"><input type="checkbox" checked={cl.roof.enabled} data-testid="clad-roof" onChange={(e) => set({ roof: { ...cl.roof, enabled: e.target.checked } })} />חיפוי גג</label>
        <div className="field"><label>סוג חיפוי גג</label>
          <select className="inp" data-testid="clad-roof-kind" value={cl.roof.kind ?? ''} onChange={(e) => { const k = e.target.value as keyof typeof ROOF_KINDS; const v = ROOF_KINDS[k]; if (v) set({ roof: { ...cl.roof, kind: k, panel: v.panel, cover: v.cover, thickness: v.thickness } }); }}>
            {!cl.roof.kind && <option value="">מותאם</option>}
            {(Object.keys(ROOF_KINDS) as (keyof typeof ROOF_KINDS)[]).map((k) => <option key={k} value={k}>{ROOF_KINDS[k].label}</option>)}
          </select></div>
        <div className="field"><label>תיאור פנל</label><TextField testId="clad-roof-panel" value={cl.roof.panel} onCommit={(v) => set({ roof: { ...cl.roof, panel: v } })} /></div>
        <RoofPanelSchematic cover={cl.roof.cover} thickness={cl.roof.thickness ?? 0} eaveExt={cl.roof.eaveExt} onSet={(patch) => set({ roof: { ...cl.roof, ...patch, ...(patch.cover !== undefined || patch.thickness !== undefined ? { kind: undefined } : {}) } })} />
        <label className="row"><input type="checkbox" checked={cl.gutter.enabled} data-testid="clad-gutter" onChange={(e) => set({ gutter: { ...cl.gutter, enabled: e.target.checked } })} />מזחלות ומרזבים</label>
        <div className="field"><label>מרזב כל</label><LenField mm={cl.gutter.downpipeSpacing} unit={unit} onCommit={(v) => set({ gutter: { ...cl.gutter, downpipeSpacing: v } })} /></div>
        {cl.gutter.enabled && <GutterSchematic pre="gsch-c" />}
        {cl.gutter.enabled && <Adv id="gutter" label="פריסה סטנדרטית, סוג תמיכה, ירידות מרזב"><GutterFields /></Adv>}
        {cl.gutter.enabled && <GutterBays />}
        <div className="field"><label>ברגים לגג (למ"ר)</label><NumField value={cl.roofScrewsPerM2} onCommit={(v) => set({ roofScrewsPerM2: v })} /></div>
      </>}
      {show('walls') && <>
        <div className="panel-title">חיפוי קירות</div>
        <label className="row"><input type="checkbox" checked={cl.walls.enabled} data-testid="clad-walls" onChange={(e) => set({ walls: { ...cl.walls, enabled: e.target.checked } })} />חיפוי קירות ומסגור קירות</label>
        {/* קיר אחד בכל פעם (1.34): לשוניות — במקום ארבעה שרטוטים ושדות כפולים */}
        <div className="wall-tabs" role="tablist" aria-label="קירות">
          {(['L', 'R', 'F', 'B'] as WallId[]).map((w) => (
            <button key={w} role="tab" aria-selected={wallTab === w} className={`wall-tab${wallTab === w ? ' on' : ''}${cl.walls.sides[w] ? '' : ' off'}`} data-testid={`clad-tab-${w}`} onClick={() => setWallTab(w)}>
              {WALL_HE[w]}<small>{cl.walls.sides[w] ? 'מחופה' : 'פתוח'}</small>
            </button>
          ))}
        </div>
        {(() => {
          const w = wallTab;
          const pw = cl.walls.per?.[w] ?? {};
          const n = w === 'L' || w === 'R' ? Math.max(0, p.building.frames.length - 1) : Math.max(0, (d.section?.lines.length ?? 2) - 1);
          const lab = (i: number) => (w === 'L' || w === 'R' ? `${i + 1}–${i + 2}` : `${d.section?.lines[i]?.label ?? i + 1}–${d.section?.lines[i + 1]?.label ?? i + 2}`);
          const setW = (patch: Partial<NonNullable<typeof pw>>) => set({ walls: { ...cl.walls, per: { ...(cl.walls.per ?? {}), [w]: { ...pw, ...patch } } } });
          const bays = Array.from({ length: n }, (_, i) => pw.bays?.[i] ?? true);
          return (
            <div className="op-card" data-testid={`clad-wall-${w}`}>
              <label className="row"><input type="checkbox" checked={cl.walls.sides[w]} data-testid={`clad-side-${w}`} onChange={(e) => set({ walls: { ...cl.walls, sides: { ...cl.walls.sides, [w]: e.target.checked } } })} /><b>{WALL_HE[w]} — מחופה</b></label>
              {cl.walls.sides[w] && <WallCladSchematic n={n} bays={bays} bottom={pw.bottom ?? cl.walls.bottom} top={pw.top ?? null} eave={eaveOf(w)} testId={`sch-clad-${w}`} labelOf={lab}
                onBays={(b) => setW({ bays: b })} onBottom={(v) => setW({ bottom: v })} onTop={(v) => setW({ top: v })}
                girts={cl.girts.enabled ? cl.girts : undefined} onGirts={(g) => set({ girts: { ...cl.girts, ...g } })}
                posts={cl.posts.enabled && (w === 'F' || w === 'B') ? { bayW: Array.from({ length: n }, (_, i) => { const ls = [...(d.section?.lines ?? [])].sort((a, c) => a.x - c.x); return ls.length > i + 1 ? ls[i + 1].x - ls[i].x : p.building.width; }), maxSpacing: cl.posts.maxSpacing } : undefined}
                onPosts={(v) => set({ posts: { ...cl.posts, maxSpacing: v } })} />}
            </div>
          );
        })()}
        <div className="hint">מפתח לא מחופה — ללא פטות קיר (ובקיר קצה גם ללא עמודי רוח). גובה עליון חלקי — פטה בראש החיפוי ופח עליון.</div>
        <Adv id="clad-walls" label="מתקדם — סוג פנל, רוחב כיסוי, ברגים">
        <div className="field"><label>סוג פנל</label><TextField value={cl.walls.panel} onCommit={(v) => set({ walls: { ...cl.walls, panel: v } })} /></div>
        <div className="field"><label>רוחב כיסוי</label><LenField mm={cl.walls.cover} unit="mm" onCommit={(v) => set({ walls: { ...cl.walls, cover: v } })} /></div>
        <div className="field"><label>תחתית החיפוי (ברירת מחדל לכל הקירות)</label><LenField mm={cl.walls.bottom} unit="mm" onCommit={(v) => set({ walls: { ...cl.walls, bottom: v } })} /></div>
        <div className="field"><label>ברגים לקיר (למ"ר)</label><NumField value={cl.wallScrewsPerM2} onCommit={(v) => set({ wallScrewsPerM2: v })} /></div>
        </Adv>
        <div className="panel-title">פטות קיר</div>
        <label className="row"><input type="checkbox" checked={cl.girts.enabled} onChange={(e) => set({ girts: { ...cl.girts, enabled: e.target.checked } })} />פטות קיר</label>
        <div className="field prof"><label>חתך</label><ProfilePicker testId="clad-girt" value={cl.girts.profile} families={['C', 'Z', 'RHS', 'UPN']} onCommit={(v) => set({ girts: { ...cl.girts, profile: v } })} /></div>
        {cl.girts.enabled && <div className="hint" style={{ marginTop: 0 }}>פטה ראשונה ומרווח — על שרטוט החזית למעלה (קווים חומים).</div>}
        <div className="panel-title">עמודי רוח בקירות הקצה</div>
        <label className="row"><input type="checkbox" checked={cl.posts.enabled} onChange={(e) => set({ posts: { ...cl.posts, enabled: e.target.checked } })} />עמודי רוח</label>
        <div className="field prof"><label>חתך</label><ProfilePicker testId="clad-post" value={cl.posts.profile} families={['IPE', 'HEA', 'RHS', 'SHS']} onCommit={(v) => set({ posts: { ...cl.posts, profile: v } })} /></div>
        {cl.posts.enabled && <div className="hint" style={{ marginTop: 0 }}>מרווח מרבי — על שרטוט חזית הקצה (לשונית "קיר קצה קדמי/אחורי", קווים סגולים).</div>}
        <div className="field prof"><label>עמודי פתח</label><ProfilePicker value={cl.jambProfile} families={['RHS', 'SHS', 'UPN', 'C']} onCommit={(v) => set({ jambProfile: v })} /></div>
      </>}
      {show('openings') && <>
        <div className="panel-title">פתחים (שערים, דלתות, חלונות)</div>
        {(['L', 'R', 'F', 'B'] as WallId[]).filter((w) => ops.some((o) => o.wall === w)).map((w) => {
          const fr = [...p.building.frames].sort((a, b) => a.y - b.y), ls = [...(d.section?.lines ?? [])].sort((a, b) => a.x - b.x);
          const side = w === 'L' || w === 'R';
          const ticks = side ? fr.map((f) => f.y - fr[0].y) : ls.map((l) => l.x - (ls[0]?.x ?? 0));
          const len = Math.max(...ticks, 1);
          return <OpeningsSchematic key={w} wall={w} len={len} eave={eaveOf(w)} ticks={ticks} ops={ops.map((o, i) => ({ i, o })).filter((q) => q.o.wall === w)}
            sel={opSel} onSel={setOpSel} setOp={setOp} testId={`sch-op-${w}`} />;
        })}
        {ops.map((o, i) => (
          <div key={o.id} className={`op-card${opSel === i ? ' sel' : ''}`} data-testid={`op-${i}`} onClick={() => setOpSel(i)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <TextField value={o.label ?? o.id} onCommit={(v) => setOp(i, { label: v })} />
              <button className="icon-btn" aria-label="מחיקת פתח" onClick={() => set({ openings: ops.filter((_, k) => k !== i) })}><Icon name="trash" /></button>
            </div>
            <div className="field"><label>קיר</label><select className="inp" value={o.wall} onChange={(e) => setOp(i, { wall: e.target.value as WallId })}>{(['L', 'R', 'F', 'B'] as WallId[]).map((w) => <option key={w} value={w}>{WALL_HE[w]}</option>)}</select></div>
            <Adv id="op" label="מתקדם — מידות בשדות">
            <div className="field"><label>{o.wall === 'L' || o.wall === 'R' ? 'מרחק מהמסגרת הראשונה' : 'מרחק מציר שמאל'}</label><LenField mm={o.pos} unit={unit} onCommit={(v) => setOp(i, { pos: v })} /></div>
            <div className="field"><label>רוחב</label><LenField mm={o.width} unit={unit} onCommit={(v) => setOp(i, { width: v })} /></div>
            <div className="field"><label>גובה</label><LenField mm={o.height} unit={unit} onCommit={(v) => setOp(i, { height: v })} /></div>
            <div className="field"><label>אדן מעל ±0.00 (0 = שער)</label><LenField mm={o.sill} unit={unit} onCommit={(v) => setOp(i, { sill: v })} /></div>
            </Adv>
          </div>
        ))}
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" data-testid="op-add-door" onClick={() => set({ openings: [...ops, { id: `O${Date.now() % 100000}`, label: `שער ${ops.length + 1}`, wall: 'F', pos: 1000, width: 4000, height: 4500, sill: 0 }] })}><Icon name="plus" />שער</button>
          <button className="btn small" data-testid="op-add-window" onClick={() => set({ openings: [...ops, { id: `O${Date.now() % 100000}`, label: `חלון ${ops.length + 1}`, wall: 'L', pos: 1500, width: 2000, height: 1000, sill: 1500 }] })}><Icon name="plus" />חלון</button>
        </div>
        <div className="hint">הפטות נקטעות בפתח; עמודי פתח משני הצדדים עד הפטה שמעל הפתח; לחלון — אדן תחתון.</div>
      </>}
      {show('takeoff') && t && <>
        <div className="panel-title">כתב כמויות חיפוי</div>
        <dl className="kv" data-testid="clad-takeoff">
          <dt>חיפוי גג</dt><dd>{m2(t.roofArea)} מ"ר</dd>
          <dt>חיפוי קירות (נטו)</dt><dd>{m2(t.wallArea)} מ"ר</dd>
          <dt>פתחים</dt><dd>{m2(t.openingArea)} מ"ר</dd>
          <dt>ברגים</dt><dd>{t.screws.toLocaleString('en-US')}</dd>
        </dl>
        {/* שורה לכל מישור/קיר עם סכום (1.35); פירוט לפי אורך — מקופל */}
        {(() => {
          const rows = [...t.roofSheets, ...t.wallSheets];
          const groups = new Map<string, { count: number; total: number; min: number; max: number }>();
          for (const r of rows) { const g = groups.get(r.where) ?? { count: 0, total: 0, min: Infinity, max: 0 }; g.count += r.count; g.total += r.count * r.length; g.min = Math.min(g.min, r.length); g.max = Math.max(g.max, r.length); groups.set(r.where, g); }
          return <>
            <table className="tbl" data-testid="clad-sheets"><thead><tr><th>מיקום</th><th>פחים</th><th>אורך פח (מ')</th><th>סה"כ (מ"א)</th></tr></thead>
              <tbody>{[...groups].map(([w, g]) => <tr key={w}><td>{w}</td><td className="n">{g.count}</td><td className="n">{Math.abs(g.max - g.min) < 1 ? m(g.min) : `${m(g.min)}–${m(g.max)}`}</td><td className="n">{m(g.total)}</td></tr>)}</tbody></table>
            {rows.length > groups.size && <Adv id="clad-sheets-all" label={`פירוט לפי אורך פח (${rows.length} שורות)`}>
              <table className="tbl"><thead><tr><th>מיקום</th><th>כמות</th><th>אורך (מ')</th></tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i}><td>{r.where}</td><td className="n">{r.count}</td><td className="n">{m(r.length)}</td></tr>)}</tbody></table>
            </Adv>}
          </>;
        })()}
        <table className="tbl" style={{ marginTop: 6 }}><thead><tr><th>פחים ומזחלות</th><th>אורך (מ')</th></tr></thead>
          <tbody>
            {t.flashings.map((f, i) => <tr key={i}><td>{f.name}</td><td className="n">{m(f.length)}</td></tr>)}
            {t.gutters.map((g, i) => <tr key={`g${i}`}><td>{g.name} · {g.downpipes} מרזבים</td><td className="n">{m(g.length)}</td></tr>)}
          </tbody></table>
      </>}
      <div style={{ marginTop: 10 }}><button className="btn small" onClick={() => { if (confirm('להסיר את החיפוי, פטות הקיר והפתחים מהמבנה?')) store.exec(setBuilding({ cladding: undefined })); }}>הסרת חיפוי</button></div>
    </div>
  );
}

/** מזחלות: באילו מפתחים יש מזחלה, ובאילו מסגרות יש ירידת מרזב — לכל מזחלה (קצה תחתון של מישור) */
/** רצועת מזחלה בתוכנית (1.34): מקטע לכל מפתח (לחיצה — יש/אין), עיגול בכל מסגרת (לחיצה — ירידת מרזב) */
function GutterStrip({ label, pid, bays, frames, dp, onBay, onDp }: { label: string; pid: string; bays: boolean[]; frames: number; dp: Set<number>; onBay: (i: number) => void; onDp: (i: number) => void }) {
  const W = 300, x0 = 16, x1 = 284, y = 22, nb = bays.length, bw = (x1 - x0) / Math.max(nb, 1);
  return (
    <div className="schem" data-testid={`gut-strip-${pid}`}>
      <div className="strip-h">{label}</div>
      <svg viewBox={`0 0 ${W} 52`} role="img" aria-label={label}>
        {bays.map((on, i) => (
          <g key={i} className="bay-cell" data-testid={`gut-bay-${pid}-${i}`} onClick={() => onBay(i)}>
            <rect x={x0 + i * bw + 1} y={y - 5} width={bw - 2} height={10} rx={2} className={on ? 'gut-on' : 'gut-off'} />
          </g>
        ))}
        {Array.from({ length: frames }, (_, i) => (
          <g key={i} className="bay-cell" data-testid={`gut-dp-${pid}-${i}`} onClick={() => onDp(i)}>
            <circle cx={x0 + i * bw} cy={y + 13} r={4.2} className={dp.has(i) ? 'dp-on' : 'dp-off'} />
            {(frames <= 16 || i % 2 === 0) && <text x={x0 + i * bw} y={y + 26} className="sm-lbl-s" textAnchor="middle">{i + 1}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

function GutterBays({ only }: { only?: string } = {}) {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const b = p.building, cl = b.cladding!;
  const fr = [...b.frames].sort((a, c) => a.y - c.y);
  const nb = fr.length - 1;
  const local = d.plan?.local.derived ?? d;
  const runs = d.section ? gutterRuns({ ...b, cladding: { ...cl, gutter: { ...cl.gutter, perRun: undefined } } }, d.section, local.members).filter((r, i, arr) => r.planeId && (!only || r.planeId === only) && arr.findIndex((q) => q.planeId === r.planeId) === i) : [];
  const cur = gutterRuns(b, d.section!, local.members);
  if (!runs.length) return null;
  const setRun = (pid: string, patch: { bays?: boolean[]; downpipes?: number[] | undefined }) => {
    const prev = cl.gutter.perRun?.[pid] ?? {};
    store.exec(setBuilding({ cladding: { ...cl, gutter: { ...cl.gutter, perRun: { ...(cl.gutter.perRun ?? {}), [pid]: { ...prev, ...patch } } } } }));
  };
  return <div className="field" style={{ display: 'block' }} data-testid="gut-bays">
    {runs.map((r) => {
      const pid = r.planeId!;
      const pr = cl.gutter.perRun?.[pid];
      const bays = Array.from({ length: nb }, (_, i) => pr?.bays?.[i] ?? true);
      const dpNow = new Set(cur.filter((x) => x.planeId === pid).flatMap((x) => x.downpipes.map((q) => fr.findIndex((f) => Math.abs(f.y - q.y) < 400))));
      return <div key={pid} style={{ marginTop: 6 }}>
        <GutterStrip label={r.label} pid={pid} bays={bays} frames={fr.length} dp={dpNow}
          onBay={(i) => setRun(pid, { bays: bays.map((x, j) => (j === i ? !x : x)) })}
          onDp={(i) => { const s0 = new Set(pr?.downpipes ?? [...dpNow]); if (s0.has(i)) s0.delete(i); else s0.add(i); setRun(pid, { downpipes: [...s0].sort((a, c) => a - c) }); }} />
        {pr?.downpipes && <button className="btn small" onClick={() => setRun(pid, { downpipes: undefined })}>ירידות אוטומטיות</button>}
      </div>;
    })}
    <div className="hint">לחיצה על מקטע — מזחלה במפתח / ללא; לחיצה על עיגול במסגרת — ירידת מרזב / ללא. בלי סימון ידני — ירידות אוטומטיות לפי "מרזב כל".</div>
  </div>;
}

/** שדות המזחלה (חתך, תמיכה, ירידות) — משותפים לתפריט החיפוי ולאשף המזחלה */
export function GutterFields() {
  const p = useStore((st) => st.project);
  const cl = p.building.cladding!;
  const set = (patch: Partial<CladdingParams>) => store.exec(setBuilding({ cladding: { ...cl, ...patch } }));
  const gs = gutterSpec(cl.gutter);
  const setG = (patch: Partial<GutterSpec>) => set({ gutter: { ...cl.gutter, spec: { ...(cl.gutter.spec ?? {}), ...patch } } });
  const n = (k: keyof GutterSpec, lbl: string) => <div className="field" key={k}><label>{lbl}</label><LenField testId={`gut-${k}`} mm={gs[k] as number} unit="mm" onCommit={(v) => setG({ [k]: v } as Partial<GutterSpec>)} /></div>;
  return <>
            <div className="hint" style={{ marginTop: 0 }}>פריסת הפח: <b>{gutterDev(gs)} מ"מ</b> · {(gs.support ?? 'web') === 'plate' ? `פלטה ${gs.plateT ?? 8} מ"מ בקצה הקורה + זוויתן ${gs.bracket.replace('x', '/')}` : (gs.support ?? 'web') === 'web' ? `זוויתן ${gs.bracket.replace('x', '/')} בחפיפה ${gs.lap ?? 150} על צד הווב (נמוך מהקורה — על פלטת קצה)` : `תומך ${gs.bracket.replace('x', '/')} ×2 בכל קצה קורה`} (מרותך במסגריה). פרט מלא בגיליון K-02.</div>
            <div className="field"><label>פריסה סטנדרטית</label>
              <select className="inp" data-testid="gut-dev" value={GUTTER_DEVS[gutterDev(gs)] ? String(gutterDev(gs)) : ''} onChange={(e) => { const v = GUTTER_DEVS[Number(e.target.value)]; if (v) setG(v); }}>
                <option value="">מותאם ({gutterDev(gs)})</option>{Object.keys(GUTTER_DEVS).map((k) => <option key={k} value={k}>{k} מ"מ</option>)}
              </select></div>
            <div className="field"><label>סוג תמיכה</label>
              <select className="inp" data-testid="gut-support" value={gs.support ?? 'web'} onChange={(e) => setG({ support: e.target.value as 'web' | 'twin' | 'plate' })}>
                <option value="web">זוויתן בחפיפה על צד הווב (נמוך מהקורה — על פלטה)</option><option value="twin">2 זוויתנים מרותכים לקצה הקורה</option><option value="plate">פלטה בקצה הקורה + זוויתן</option>
              </select></div>
            <div className="field"><label>כיוון התושבת</label>
              <select className="inp" data-testid="gut-slope" value={gs.bracketSlope ?? 'horizontal'} onChange={(e) => setG({ bracketSlope: e.target.value as 'horizontal' | 'roof' })}>
                <option value="horizontal">אופקית</option><option value="roof">בשיפוע הגג</option>
              </select></div>
            <div className="field"><label>גובה המזחלה והתושבת (+ למעלה)</label><LenField testId="gut-offset" mm={gs.bracketOffset ?? 0} unit="mm" onCommit={(v) => setG({ bracketOffset: v })} /></div>
            {gs.support === 'plate' && <div className="field"><label>עובי פלטה</label><LenField testId="gut-plateT" mm={gs.plateT ?? 8} unit="mm" onCommit={(v) => setG({ plateT: v })} /></div>}
            <div className="field"><label>חתך משתנה — תוספת עומק בירידה</label><LenField testId="gut-fall" mm={gs.fall ?? 0} unit="mm" onCommit={(v) => setG({ fall: Math.max(0, v) })} /></div>
            <div className="field prof"><label>זוויתן תומך</label><ProfilePicker value={gs.bracket} families={['L']} onCommit={(v) => setG({ bracket: v })} /></div>
            {n('hangerSpacing', 'מתלי פח כל (0=ללא)')}{n('pipeD', 'קוטר ירידת מרזב')}{n('clampSpacing', 'שלות כל')}
          </>;
}

/** חתך המזחלה בשרטוט עם מידות לעריכה בלחיצה (✎) */
export function GutterSchematic({ pre = 'gsch' }: { pre?: string } = {}) {
  const p = useStore((st) => st.project);
  const cl = p.building.cladding!;
  const gs = gutterSpec(cl.gutter);
  const setG = (patch: Partial<GutterSpec>) => store.exec(setBuilding({ cladding: { ...cl, gutter: { ...cl.gutter, spec: { ...(cl.gutter.spec ?? {}), ...patch } } } }));
  const k = 150 / Math.max(gs.bottom + 260, gs.outer + 120, 400);
  const X0 = 70, Y0 = 20 + gs.outer * k, x = (mm: number) => X0 + mm * k, y = (mm: number) => Y0 - mm * k;
  const inner = gs.inner, lap = gs.lap ?? 150, lh = 50;
  const sup = gs.support ?? 'web';
  const sl = (gs.bracketSlope ?? 'horizontal') === 'roof' ? 0.1 : 0;
  const dims: SDim[] = [
    { a: [x(0), y(0)], b: [x(gs.bottom), y(0)], off: -10, value: gs.bottom, testId: `${pre}-bottom`, onCommit: (v) => setG({ bottom: v }) },
    { a: [x(0), y(0)], b: [x(0), y(inner)], off: 12, value: inner, testId: `${pre}-inner`, onCommit: (v) => setG({ inner: v }) },
    { a: [x(gs.bottom), y(0)], b: [x(gs.bottom), y(gs.outer)], off: -12, value: gs.outer, testId: `${pre}-outer`, onCommit: (v) => setG({ outer: v }) },
    { a: [x(gs.bottom - gs.lip), y(gs.outer)], b: [x(gs.bottom), y(gs.outer)], off: 9, value: gs.lip, testId: `${pre}-lip`, onCommit: (v) => setG({ lip: Math.max(0, v) }) },
    { a: [0, 0], b: [0, 0], off: 0, value: gs.t, labelOnly: true, at: [x(gs.bottom / 2), y(gs.outer / 2)], text: `t=${gs.t}`, testId: `${pre}-t`, onCommit: (v) => setG({ t: Math.max(0.4, v) }) },
    ...(sup === 'web' ? [{ a: [x(-lap), y(-lh) + 14] as [number, number], b: [x(0), y(-lh) + 14] as [number, number], off: -6, value: lap, testId: `${pre}-lap`, onCommit: (v: number) => setG({ lap: Math.max(50, v) }) }] : []),
  ];
  return (
    <Schematic w={260} h={Math.round(Y0 + lh * k + 50)} dims={dims} testId={pre === 'gsch' ? 'gut-sch' : `${pre}-sch`} caption="חתך המזחלה — לחיצה על מידה ✎: תחתית, דפנות, שפה, עובי, חפיפה">
      {/* קצה הקורה והפטה האחרונה */}
      <rect x={x(-lap - 120)} y={y(inner - 20)} width={(lap + 120) * k} height={Math.max(8, 180 * k)} className="sm-main" fill="none" strokeWidth={1} />
      <rect x={x(-70)} y={y(inner + 10) - 0} width={50 * k} height={20 * k + 4} className="sm-main" fill="none" strokeWidth={1} />
      {/* המזחלה */}
      <polyline points={[[x(-gs.lip), y(inner)], [x(0), y(inner)], [x(0), y(0)], [x(gs.bottom), y(-gs.bottom * sl)], [x(gs.bottom), y(gs.outer - gs.bottom * sl)], [x(gs.bottom - gs.lip), y(gs.outer - gs.bottom * sl)]].map((q) => q.join(',')).join(' ')} className="sm-hi" fill="none" strokeWidth={2} />
      {/* זוויתן התמיכה */}
      {sup === 'web'
        ? <polygon points={[[x(-lap), y(lap * sl)], [x(gs.bottom + 20), y(-(gs.bottom + 20) * sl)], [x(gs.bottom + 20), y(-(gs.bottom + 20) * sl) + lh * k], [x(-lap), y(lap * sl) + lh * k]].map((q) => q.join(',')).join(' ')} className="sm-main" fill="rgba(80,100,90,.15)" strokeWidth={1} />
        : <polygon points={[[x(0), y(0)], [x(gs.bottom + 20), y(0)], [x(gs.bottom + 20), y(-5)], [x(5), y(-5)], [x(5), y(-lh)], [x(0), y(-lh)]].map((q) => q.join(',')).join(' ')} className="sm-main" fill="rgba(80,100,90,.15)" strokeWidth={1} />}
      <text x={x(gs.bottom / 2)} y={y(gs.outer) - 14} className="sm-lbl-s" textAnchor="middle">פריסה {gutterDev(gs)}</text>
      <text x={x(-lap - 60)} y={y(inner - 20) - 3} className="sm-lbl-s" textAnchor="middle">קורה + פטה</text>
    </Schematic>
  );
}

/** אשף מזחלה — נפתח בלחיצה על המזחלה בתלת־ממד */
export function GutterWizard({ planeId }: { planeId: string }) {
  const p = useStore((st) => st.project);
  const d = useStore((st) => st.derived);
  const cl = p.building.cladding;
  if (!cl?.gutter.enabled) return <div className="panel-body"><div className="hint">המזחלות כבויות.</div></div>;
  const local = d.plan?.local.derived ?? d;
  const runs = d.section ? gutterRuns(p.building, d.section, local.members).filter((r) => (r.planeId ?? r.id) === planeId) : [];
  const r0 = runs[0];
  return (
    <div className="panel-body" data-testid="gutter-wizard">
      <div className="el-head"><div className="k">מזחלה</div><div className="t"><b>{r0?.label.replace(/ \(מפתחים.*\)$/, '') ?? planeId}</b>
        <button className="icon-btn" aria-label="סגירה" onClick={() => store.set({ activeGutter: null })}><Icon name="x" /></button></div></div>
      {runs.length > 0 && <div className="hint" style={{ marginTop: 0 }}>{runs.map((r) => `${((r.y1 - r.y0) / 1000).toFixed(1)} מ' · ${r.downpipes.length} ירידות`).join(' | ')} · גובה תחתית {(r0!.zBottom / 1000).toFixed(2)}</div>}
      <GutterSchematic />
      <GutterFields />
      <GutterBays only={planeId} />
      <div className="hint">השינויים חלים על כל המזחלות בפרויקט (חתך ותמיכה); המפתחים והירידות — למזחלה הזו. פרט מלא בגיליון K-02.</div>
    </div>
  );
}
