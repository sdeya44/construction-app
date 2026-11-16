import { useMemo } from 'react';
import { setBuilding } from '../commands/commands';
import { claddingTakeoff, defaultCladding, WALL_HE } from '../geometry/cladding';
import type { CladdingParams, OpeningDef, WallId } from '../model/types';
import { store, useStore } from '../store';
import { LenField, NumField, ProfilePicker, TextField } from './fields';
import { Icon } from './icons';

export type CladSection = 'roof' | 'walls' | 'openings' | 'takeoff';
const m2 = (n: number) => n.toFixed(1);
const m = (mm: number) => (mm / 1000).toFixed(2);

/** חיפוי גג וקירות, פטות קיר ועמודי רוח, פתחים, מזחלות וכתב כמויות */
export function CladdingPanel({ section }: { section?: CladSection } = {}) {
  const show = (k: CladSection) => !section || section === k;
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
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
  const setOp = (i: number, patch: Partial<OpeningDef>) => set({ openings: ops.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  return (
    <div className="panel-body" data-testid="clad-panel">
      {show('roof') && <>
        <div className="panel-title">חיפוי גג ומזחלות</div>
        <label className="row"><input type="checkbox" checked={cl.roof.enabled} data-testid="clad-roof" onChange={(e) => set({ roof: { ...cl.roof, enabled: e.target.checked } })} />חיפוי גג</label>
        <div className="field"><label>סוג פנל</label><TextField testId="clad-roof-panel" value={cl.roof.panel} onCommit={(v) => set({ roof: { ...cl.roof, panel: v } })} /></div>
        <div className="field"><label>רוחב כיסוי</label><LenField mm={cl.roof.cover} unit="mm" onCommit={(v) => set({ roof: { ...cl.roof, cover: v } })} /></div>
        <div className="field"><label>בליטה לתוך המזחלה</label><LenField mm={cl.roof.eaveExt} unit="mm" onCommit={(v) => set({ roof: { ...cl.roof, eaveExt: v } })} /></div>
        <label className="row"><input type="checkbox" checked={cl.gutter.enabled} data-testid="clad-gutter" onChange={(e) => set({ gutter: { ...cl.gutter, enabled: e.target.checked } })} />מזחלות ומרזבים</label>
        <div className="field"><label>מרזב כל</label><LenField mm={cl.gutter.downpipeSpacing} unit={unit} onCommit={(v) => set({ gutter: { ...cl.gutter, downpipeSpacing: v } })} /></div>
        <div className="field"><label>ברגים לגג (למ"ר)</label><NumField value={cl.roofScrewsPerM2} onCommit={(v) => set({ roofScrewsPerM2: v })} /></div>
      </>}
      {show('walls') && <>
        <div className="panel-title">חיפוי קירות</div>
        <label className="row"><input type="checkbox" checked={cl.walls.enabled} data-testid="clad-walls" onChange={(e) => set({ walls: { ...cl.walls, enabled: e.target.checked } })} />חיפוי קירות ומסגור קירות</label>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {(['L', 'R', 'F', 'B'] as WallId[]).map((w) => <label key={w} className="row"><input type="checkbox" checked={cl.walls.sides[w]} data-testid={`clad-side-${w}`} onChange={(e) => set({ walls: { ...cl.walls, sides: { ...cl.walls.sides, [w]: e.target.checked } } })} />{WALL_HE[w]}</label>)}
        </div>
        <div className="field"><label>סוג פנל</label><TextField value={cl.walls.panel} onCommit={(v) => set({ walls: { ...cl.walls, panel: v } })} /></div>
        <div className="field"><label>רוחב כיסוי</label><LenField mm={cl.walls.cover} unit="mm" onCommit={(v) => set({ walls: { ...cl.walls, cover: v } })} /></div>
        <div className="field"><label>תחתית החיפוי מעל ±0.00</label><LenField mm={cl.walls.bottom} unit="mm" onCommit={(v) => set({ walls: { ...cl.walls, bottom: v } })} /></div>
        <div className="field"><label>ברגים לקיר (למ"ר)</label><NumField value={cl.wallScrewsPerM2} onCommit={(v) => set({ wallScrewsPerM2: v })} /></div>
        <div className="panel-title">פטות קיר</div>
        <label className="row"><input type="checkbox" checked={cl.girts.enabled} onChange={(e) => set({ girts: { ...cl.girts, enabled: e.target.checked } })} />פטות קיר</label>
        <div className="field prof"><label>חתך</label><ProfilePicker testId="clad-girt" value={cl.girts.profile} families={['C', 'Z', 'RHS', 'UPN']} onCommit={(v) => set({ girts: { ...cl.girts, profile: v } })} /></div>
        <div className="field"><label>פטה ראשונה מעל ±0.00</label><LenField mm={cl.girts.first} unit="mm" onCommit={(v) => set({ girts: { ...cl.girts, first: v } })} /></div>
        <div className="field"><label>מרווח</label><LenField mm={cl.girts.spacing} unit={unit} testId="clad-girt-spacing" onCommit={(v) => set({ girts: { ...cl.girts, spacing: v } })} /></div>
        <div className="panel-title">עמודי רוח בקירות הקצה</div>
        <label className="row"><input type="checkbox" checked={cl.posts.enabled} onChange={(e) => set({ posts: { ...cl.posts, enabled: e.target.checked } })} />עמודי רוח</label>
        <div className="field prof"><label>חתך</label><ProfilePicker testId="clad-post" value={cl.posts.profile} families={['IPE', 'HEA', 'RHS', 'SHS']} onCommit={(v) => set({ posts: { ...cl.posts, profile: v } })} /></div>
        <div className="field"><label>מרווח מרבי</label><LenField mm={cl.posts.maxSpacing} unit={unit} onCommit={(v) => set({ posts: { ...cl.posts, maxSpacing: v } })} /></div>
        <div className="field prof"><label>עמודי פתח</label><ProfilePicker value={cl.jambProfile} families={['RHS', 'SHS', 'UPN', 'C']} onCommit={(v) => set({ jambProfile: v })} /></div>
      </>}
      {show('openings') && <>
        <div className="panel-title">פתחים (שערים, דלתות, חלונות)</div>
        {ops.map((o, i) => (
          <div key={o.id} className="op-card" data-testid={`op-${i}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <TextField value={o.label ?? o.id} onCommit={(v) => setOp(i, { label: v })} />
              <button className="icon-btn" aria-label="מחיקת פתח" onClick={() => set({ openings: ops.filter((_, k) => k !== i) })}><Icon name="trash" /></button>
            </div>
            <div className="field"><label>קיר</label><select className="inp" value={o.wall} onChange={(e) => setOp(i, { wall: e.target.value as WallId })}>{(['L', 'R', 'F', 'B'] as WallId[]).map((w) => <option key={w} value={w}>{WALL_HE[w]}</option>)}</select></div>
            <div className="field"><label>{o.wall === 'L' || o.wall === 'R' ? 'מרחק מהמסגרת הראשונה' : 'מרחק מציר שמאל'}</label><LenField mm={o.pos} unit={unit} onCommit={(v) => setOp(i, { pos: v })} /></div>
            <div className="field"><label>רוחב</label><LenField mm={o.width} unit={unit} onCommit={(v) => setOp(i, { width: v })} /></div>
            <div className="field"><label>גובה</label><LenField mm={o.height} unit={unit} onCommit={(v) => setOp(i, { height: v })} /></div>
            <div className="field"><label>אדן מעל ±0.00 (0 = שער)</label><LenField mm={o.sill} unit={unit} onCommit={(v) => setOp(i, { sill: v })} /></div>
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
        <table className="tbl"><thead><tr><th>מיקום</th><th>כמות</th><th>אורך (מ')</th></tr></thead>
          <tbody>{[...t.roofSheets, ...t.wallSheets].map((r, i) => <tr key={i}><td>{r.where}</td><td className="n">{r.count}</td><td className="n">{m(r.length)}</td></tr>)}</tbody></table>
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
