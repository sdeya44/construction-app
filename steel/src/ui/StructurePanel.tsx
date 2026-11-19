import { useState } from 'react';
import { addFrame, removeFrame, respaceFrames, setBuilding, setFrameY, setMeta, setSettings } from '../commands/commands';
import type { BuildingParams, LockTrussParams, PortalBraceParams, RhsTrussParams, RidgeReinfParams } from '../model/types';
import { defaultPortal } from '../geometry/portal';
import { defaultLockTruss } from '../geometry/lockTruss';
import { defaultRhsTruss } from '../geometry/hbrace';
import { defaultRidgeReinf } from '../model/defaults';
import { defaultRodEnd, resolveBays, wallBays } from '../geometry/bracing';
import { catalogNames } from '../profiles/library';
import { MATERIALS } from '../profiles/materials';
import { store, useStore } from '../store';
import { Adv, BoltSelect, LenField, NumField, ProfilePicker, TextField, useEdit, Help } from './fields';
import { Icon } from './icons';
import { HaunchEditor, KneeEditor, SectionEditor } from './SectionEditor';
import { ClassicRoofDims } from './TriDims';
import { FramesStrip, GussetSchematic, LockTrussSchematic, PortalSchematic, RidgeSchematic, WallsPlan } from './schematics';
import { MenuPic, OffCard } from './pics';

export function ProfileDatalist() {
  return (
    <datalist id="profiles">
      {catalogNames().flatMap((g) => g.names).map((n) => <option key={n} value={n} />)}
    </datalist>
  );
}

export type StructSection = 'project' | 'geometry' | 'profiles' | 'bracing' | 'frames';
export function StructurePanel({ section }: { section?: StructSection } = {}) {
  const show = (k: StructSection) => !section || section === k;
  const p = useStore((s) => s.project);
  const roof = useStore((s) => s.derived.roof);
  const b = p.building;
  const u = p.displayUnit;
  const set = (patch: Partial<BuildingParams>) => store.exec(setBuilding(patch));
  const frames = b.frames;
  const [nf, setNf] = useState(frames.length);
  const [sp, setSp] = useState(6000);

  return (
    <div className="panel-body" data-testid="structure-panel">
      {show('project') && <>
      <div className="panel-title">פרויקט</div>
      <div className="field wide"><label>שם</label><TextField value={p.meta.name} onCommit={(v) => store.exec(setMeta({ name: v }))} /></div>
      <div className="field wide"><label>מספר</label><TextField value={p.meta.number} onCommit={(v) => store.exec(setMeta({ number: v }))} /></div>
      <div className="field wide"><label>לקוח</label><TextField value={p.meta.client} onCommit={(v) => store.exec(setMeta({ client: v }))} /></div>
      <div className="field wide"><label>מתכנן</label><TextField value={p.meta.designer} onCommit={(v) => store.exec(setMeta({ designer: v }))} /></div>
      <div className="field"><label>יחידות תצוגה</label>
        <select className="inp" value={u} onChange={(e) => store.exec(setSettings({ displayUnit: e.target.value as 'm' | 'mm' }))}>
          <option value="m">מטר</option><option value="mm">מילימטר</option>
        </select>
      </div>
      <div className="field"><label>אורך חומר גלם</label><LenField mm={p.settings.stockLength} unit={u} min={1} onCommit={(v) => store.exec(setSettings({ stockLength: v }))} /></div>
      <div className="field"><label>חלוקה אוטומטית לחומר גלם</label><label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="auto-splice" checked={p.settings.autoSplice !== false} onChange={(e) => store.exec(setSettings({ autoSplice: e.target.checked }))} />{p.settings.autoSplice !== false ? 'כן — אלמנט ארוך מחולק עם חיבור המשך' : 'לא'}</label></div>
      {p.settings.autoSplice !== false && <>
        <div className="field"><label>אופן החלוקה</label>
          <select className="inp" data-testid="splice-mode" value={p.settings.spliceMode ?? 'stock'} onChange={(e) => store.exec(setSettings({ spliceMode: e.target.value as 'stock' | 'equal' }))}>
            <option value="stock">מוט מלא ({(p.settings.stockLength / 1000).toFixed(1)} מ') + השלמה</option><option value="equal">חלקים שווים</option>
          </select></div>
        {(['beams', 'columns'] as const).map((k) => (
          <div className="field" key={k}><label>{k === 'beams' ? 'חיבור המשך קורות' : 'חיבור המשך עמודים'}</label>
            <select className="inp" data-testid={`splice-joint-${k}`} value={p.settings.spliceJoint?.[k] ?? 'bolted'} onChange={(e) => store.exec(setSettings({ spliceJoint: { ...p.settings.spliceJoint, [k]: e.target.value as 'bolted' | 'welded' } }))}>
              <option value="bolted">מוברג בשטח — פלטות קצה</option>
              <option value="welded">מרותך במסגריה — פלטות כיסוי (יוצא כחלק אחד)</option>
            </select></div>
        ))}
        <div className="field"><label>פלטות חיזוק בחיבור המשך קורה</label><label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="splice-stiff" checked={!!p.settings.spliceStiffeners} onChange={(e) => store.exec(setSettings({ spliceStiffeners: e.target.checked }))} />{p.settings.spliceStiffeners ? 'כן — משולשים מעל ומתחת' : 'לא'}</label></div>
      </>}
      </>}

      {show('geometry') && <>
      <SectionEditor />
      <div className="panel-title">גיאומטריית מבנה</div>
      {!b.section && <Adv id="quick2" label="מידות מהירות — מבנה 2 צירים (סוג גג, רוחב, רכס)">
      <div className="field"><label>סוג גג</label>
        <select className="inp" value={b.roofType} data-testid="roofType" onChange={(e) => {
          const t = e.target.value as BuildingParams['roofType'];
          const purlins = { ...b.purlins, left: { ...b.purlins.left, first: t === 'mono' ? 0 : 300, manualPositions: null } };
          set(t === 'gable' ? { roofType: t, eaveRight: b.eaveLeft, ridgeX: b.width / 2, purlins } : { roofType: t, eaveRight: b.eaveLeft + Math.max(500, b.width * 0.1), purlins });
        }}>
          <option value="gable">דו־שיפועי</option><option value="mono">חד־שיפועי</option>
        </select>
      </div>
      <div className="field"><label>רוחב (מפתח צירים)</label><LenField testId="width" mm={b.width} unit={u} onCommit={(v) => set(b.roofType === 'gable' && Math.abs(b.ridgeX - b.width / 2) < 1 ? { width: v, ridgeX: v / 2 } : { width: v })} /></div>
      {b.roofType === 'gable' && <div className="field"><label>מיקום רכס מציר א</label><LenField testId="ridgeX" mm={b.ridgeX} unit={u} onCommit={(v) => set({ ridgeX: v })} /></div>}
      <ClassicRoofDims b={b} unit={u} set={set} testId="cl" />
      {b.roofType === 'gable' && Math.abs(b.eaveRight - b.eaveLeft) > 0.5 && <dl className="kv">
        <dt>שיפוע ימין (נגזר)</dt><dd>{(roof.slopeRight * 100).toFixed(2)}%</dd>
      </dl>}
      </Adv>}
      <div className="field"><label>ייחוס גבהים</label>
        <select className="inp" value={b.heightRef} onChange={(e) => set({ heightRef: e.target.value as BuildingParams['heightRef'] })}>
          <option value="TOS">פני עליון קורת גג (TOS)</option><option value="AXIS">ציר קורת הגג</option>
        </select>
      </div>
      <div className="hint" data-testid="height-ref-hint" style={{ marginTop: 0 }}>{b.heightRef === 'TOS'
        ? 'כל גובה שמוזן (ובמידות על המודל) = פני עליון קורת הגג בציר העמוד. גובה העמוד עצמו נמוך ממנו: פחות עומק הקורה האנכי ופחות שתי פלטות ראש העמוד; ראש העמוד חתוך בשיפוע — בשרטוט החלק: אורך בצד העליון, בצד התחתון ובציר.'
        : 'כל גובה שמוזן = ציר קורת הגג בציר העמוד. גובה העמוד = הגובה פחות חצי עומק הקורה האנכי ופחות שתי פלטות ראש העמוד.'}</div>

      </>}
      {show('profiles') && <>
      <div className="panel-title">חתכים וחומר</div>
      <div className="field prof"><label>עמודים</label><ProfilePicker testId="columnProfile" role="column" value={b.columnProfile} families={['HEA', 'HEB', 'HEM', 'IPE', 'RHS', 'SHS', 'CHS']} onCommit={(v) => set({ columnProfile: v })} /></div>
      <div className="field prof"><label>קורות גג</label><ProfilePicker testId="rafterProfile" role="rafter" value={b.rafterProfile} families={['IPE', 'HEA', 'HEB', 'RHS', 'UPN']} onCommit={(v) => set({ rafterProfile: v })} /></div>
      <div className="field"><label>חומר</label>
        <select className="inp" value={b.material} onChange={(e) => set({ material: e.target.value })}>
          {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      </>}
      {show('bracing') && <BracingEditor />}
      {(show('frames') || show('geometry')) && <>
      <div className="panel-title">אורך המבנה ומסגרות (לאורך Y)</div>
      <div className="field"><label>אורך המבנה</label><LenField testId="bld-length" mm={frames[frames.length - 1].y - frames[0].y} unit={u} min={1000} onCommit={(v) => store.exec(respaceFrames(frames.length, v / (frames.length - 1)))} /></div>
      <div className="field"><label>מספר מפתחים</label><NumField testId="bld-bays" value={frames.length - 1} onCommit={(v) => { const nb = Math.max(1, Math.round(v)); store.exec(respaceFrames(nb + 1, (frames[frames.length - 1].y - frames[0].y) / nb)); }} /></div>
      <div className="hint" style={{ marginTop: 0 }}>אורך ומספר מפתחים ⇒ מרווחים שווים. מרווח שונה — לחיצה על המידה בתוכנית המסגרות שלמטה.</div>
      <PlanShapeFields />
      <div className="panel-title">מסגרות ({frames.length})
        <button className="btn small" data-testid="add-frame" onClick={() => {
          const last = frames[frames.length - 1];
          const prev = frames[frames.length - 2];
          store.exec(addFrame(last.y + (prev ? last.y - prev.y : 6000)));
        }}><Icon name="plus" />מסגרת</button>
      </div>
      <FramesStrip frames={frames} po={{ start: b.purlinOverhangStart, end: b.purlinOverhangEnd }} onPo={(k, v) => set(k === 'start' ? { purlinOverhangStart: Math.max(0, v) } : { purlinOverhangEnd: Math.max(0, v) })} onTotal={(v) => store.exec(respaceFrames(frames.length, v / (frames.length - 1)))}
        onBay={(i, v) => { const delta = v - (frames[i + 1].y - frames[i].y); store.exec(setBuilding({ frames: frames.map((g, j) => (j > i ? { ...g, y: g.y + delta } : g)) })); }} />
      <Adv id="frames-tbl" label="טבלת מסגרות — מיקומים, מחיקה, חלוקה מחדש">
      <table className="tbl" data-testid="frames-table">
        <thead><tr><th>#</th><th>מזהה</th><th>מיקום Y</th><th>מרווח</th><th /></tr></thead>
        <tbody>
          {frames.map((f, i) => (
            <tr key={f.id}>
              <td>{i + 1}</td>
              <td style={{ direction: 'ltr', fontFamily: 'var(--mono)', fontSize: 11.5 }}>{f.id}</td>
              <td><LenField mm={f.y} unit={u} onCommit={(v) => store.exec(setFrameY(f.id, v))} /></td>
              <td>{i > 0 ? <LenField mm={f.y - frames[i - 1].y} unit={u} min={1} onCommit={(v) => {
                const delta = v - (f.y - frames[i - 1].y);
                store.exec(setBuilding({ frames: frames.map((g, j) => (j >= i ? { ...g, y: g.y + delta } : g)) }));
              }} /> : <span className="hint">—</span>}</td>
              <td><button className="icon-btn" title="מחיקת מסגרת" onClick={() => store.exec(removeFrame(f.id))}><Icon name="x" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">מרווח שמשתנה מזיז את כל המסגרות שאחריו. מזהה המסגרת נשמר גם כשהמיקום משתנה.</div>
      <div className="panel-title">חלוקה אחידה מחדש</div>
      <div className="field"><label>מספר מסגרות</label><NumField value={nf} onCommit={(v) => setNf(Math.round(v))} /></div>
      <div className="field"><label>מרווח</label><LenField mm={sp} unit={u} onCommit={setSp} /></div>
      <button className="btn" data-testid="respace" onClick={() => store.exec(respaceFrames(nf, sp))}>החל חלוקה</button>
      </Adv>
      </>}
    </div>
  );
}


function RhsFields() {
  const br = useStore((s) => s.project.building.bracing);
  const r = br.roof.rhs ?? defaultRhsTruss();
  const set = (patch: Partial<RhsTrussParams>) => store.exec(setBuilding({ bracing: { ...br, roof: { ...br.roof, rhs: { ...r, ...patch } } } }));
  return (
    <>
      <div className="field prof"><label>מוט (לאורך Y)</label><ProfilePicker testId="rhs-strut" value={r.strut} families={['RHS', 'SHS', 'CHS']} onCommit={(v) => set({ strut: v })} /></div>
      <div className="field prof"><label>אלכסון</label><ProfilePicker testId="rhs-diag" value={r.diag} families={['RHS', 'SHS', 'CHS']} onCommit={(v) => set({ diag: v })} /></div>
      <div className="field"><label>פנלים בשיפוע (0 = אוטו׳)</label><NumField value={r.panels} onCommit={(v) => set({ panels: Math.max(0, Math.round(v)) })} /></div>
      <div className="hint">פח מרותך לווב הקורה בכל צומת; לשונית {r.tongueT} מ"מ בחריץ ה-RHS; {r.boltsPerEnd}×M{r.bolt.d} בשטח. המוט מעל הפח, האלכסון מתחתיו.</div>
    </>
  );
}

/** מפתחי קיר לכל ציר עמודים (כולל צירים פנימיים) */
function WallLines({ nb }: { nb: number }) {
  const br = useStore((s) => s.project.building.bracing);
  const lines = useStore((s) => s.derived.section?.lines) ?? [];
  const ls = [...lines].sort((a, b) => a.x - b.x);
  const cur = new Map(wallBays(br, ls.map((l) => l.id)).map(([id, b]) => [id, resolveBays(b, nb)] as [string, number[]]));
  const toggle = (id: string, bay: number) => {
    const byLine: Record<string, number[]> = {};
    for (const l of ls) {
      const s0 = new Set(cur.get(l.id) ?? []);
      if (l.id === id) { if (s0.has(bay)) s0.delete(bay); else s0.add(bay); }
      byLine[l.id] = [...s0].sort((p, q) => p - q);
    }
    store.exec(setBuilding({ bracing: { ...br, walls: { ...br.walls, byLine, left: byLine[ls[0]?.id] ?? [], right: byLine[ls[ls.length - 1]?.id] ?? [] } } }));
  };
  return <WallsPlan lines={ls} nb={nb} bays={cur} kind={br.walls.type ?? 'x'} onToggle={toggle} />;
}

/** צורת תוכנית: מלבן / מקבילית / טרפז */
function PlanShapeFields() {
  const b = useStore((s) => s.project.building);
  const u = useStore((s) => s.project.displayUnit);
  const pl = b.plan ?? { shape: 'rect' as const };
  const set = (patch: Partial<NonNullable<BuildingParams['plan']>>) => store.exec(setBuilding({ plan: { ...pl, ...patch } }));
  return <>
    <div className="field"><label>צורת התוכנית</label>
      <select className="inp" data-testid="plan-shape" value={pl.shape} disabled={!!b.wing?.enabled} onChange={(e) => set({ shape: e.target.value as 'rect' | 'skew' | 'taper', skewDeg: pl.skewDeg ?? 15, taperLine: pl.taperLine ?? 'last', taperEnd: pl.taperEnd ?? 2000 })}>
        <option value="rect">מלבן</option><option value="skew">מקבילית — מסגרות מוסטות באלכסון</option><option value="taper">טרפז — ציר קצה משופע (מפתח משתנה)</option>
      </select></div>
    {pl.shape === 'skew' && <div className="field"><label>זווית הסטה</label><NumField testId="plan-skew" value={pl.skewDeg ?? 15} suffix="°" onCommit={(v) => set({ skewDeg: Math.max(-40, Math.min(40, v)) })} /></div>}
    {pl.shape === 'taper' && <>
      <div className="field"><label>הציר המשופע</label>
        <select className="inp" data-testid="plan-taper-line" value={pl.taperLine ?? 'last'} onChange={(e) => set({ taperLine: e.target.value as 'first' | 'last' })}>
          <option value="last">הציר האחרון</option><option value="first">הציר הראשון</option>
        </select></div>
      <div className="field"><label>הזזה במסגרת האחרונה (+ החוצה)</label><LenField testId="plan-taper" mm={pl.taperEnd ?? 2000} unit={u} onCommit={(v) => set({ taperEnd: v })} /></div>
    </>}
    {pl.shape !== 'rect' && <Help>המסגרות נבנות זהות ומוצבות לפי הצורה. מקבילית: הפטות והקושרות מקבילות לקירות המשופעים, התושבות מסובבות. טרפז: שיפוע הגג נשמר — העמוד בציר המשופע מתארך/מתקצר, והפטות ליד הציר מקבילות לו. {b.wing?.enabled ? 'לא זמין עם כנף L.' : ''}</Help>}
  </>;
}

/** שדות נעילה אופקית. lineId — עריכה לציר אחד בלבד (חריגה); בלי — לכל הצירים */
export function LockTrussFields({ lineId }: { lineId?: string } = {}) {
  const br = useStore((s) => s.project.building.bracing);
  const ed = useEdit();
  const g = br.walls.truss ?? defaultLockTruss();
  const p: LockTrussParams = { ...g, ...(lineId ? br.walls.lineTruss?.[lineId] ?? {} : {}) };
  const set = (patch: Partial<LockTrussParams>) => store.exec(setBuilding({ bracing: { ...br, walls: lineId
    ? { ...br.walls, lineTruss: { ...(br.walls.lineTruss ?? {}), [lineId]: { ...(br.walls.lineTruss?.[lineId] ?? {}), ...patch } } }
    : { ...br.walls, truss: { ...g, ...patch } } } }));
  const shape = <>
    {ed.showProfile && <>
      <div className="field prof"><label>סיב וחגורה</label><ProfilePicker testId="lt-chord" value={p.chord} families={['RHS', 'SHS']} onCommit={(v) => set({ chord: v })} /></div>
      <div className="field prof"><label>אלכסונים</label><ProfilePicker testId="lt-diag" value={p.diag} families={['RHS', 'SHS', 'CHS']} onCommit={(v) => set({ diag: v })} /></div>
    </>}
    <LockTrussSchematic p={p} set={set} />
    <div className="field"><label>מיקום המסבך</label>
      <select className="inp" data-testid="lt-pos" value={p.position} onChange={(e) => set({ position: e.target.value as 'above' | 'below' })}>
        <option value="above">מעל הסיב הרציף</option><option value="below">מתחת לסיב הרציף</option>
      </select></div>
    <div className="field"><label>מרווח בין אלכסונים בצומת</label><NumField testId="lt-nodegap" value={p.nodeGap ?? 20} suffix='מ"מ' onCommit={(v) => set({ nodeGap: Math.max(0, v) })} /></div>
    <div className="field"><label>סיב בשאר המפתחים</label><label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="lt-cont" checked={p.continuous} onChange={(e) => set({ continuous: e.target.checked })} />{p.continuous ? 'כן' : 'לא'}</label></div>
  </>;
  const conn = <>
    <div className="field"><label>חיבור לעמוד</label>
      <select className="inp" data-testid="lt-conn" value={p.conn} onChange={(e) => set({ conn: e.target.value as 'plate' | 'tongue', connA: undefined, connB: undefined })}>
        <option value="plate">פלטת קצה + 4 ברגים דרך העמוד</option><option value="tongue">פח + לשונית (כמו אלכסון עמוד-קורה)</option>
      </select></div>
    {lineId && (['A', 'B'] as const).map((k) => <div className="field" key={k}><label>חיבור בצד {k === 'A' ? 'העמוד הראשון במפתח' : 'העמוד השני במפתח'}</label>
      <select className="inp" data-testid={`lt-conn-${k}`} value={(k === 'A' ? p.connA : p.connB) ?? p.conn} onChange={(e) => set({ [k === 'A' ? 'connA' : 'connB']: e.target.value as 'plate' | 'tongue' })}>
        <option value="plate">פלטת קצה + ברגים דרך העמוד</option><option value="tongue">פח + לשונית</option>
      </select></div>)}
    {[p.conn, p.connA, p.connB].includes('tongue') && <div className="field"><label>כיוון הפח והלשונית</label>
      <select className="inp" data-testid="lt-orient" value={p.finOrient ?? 'horizontal'} onChange={(e) => set({ finOrient: e.target.value as 'horizontal' | 'vertical' })}>
        <option value="horizontal">שוכבים (חריץ אופקי בסיב)</option><option value="vertical">במישור המסבך</option>
      </select></div>}
    <div className="field"><label>עובי פלטות</label><NumField value={p.plateT} suffix='מ"מ' onCommit={(v) => set({ plateT: v })} /></div>
    <div className="field"><label>קוטר בורג</label><BoltSelect d={p.bolt.d} onChange={(d) => set({ bolt: { ...p.bolt, d } })} /></div>
  </>;
  if (ed.embed) return ed.showShape ? shape : conn;
  return (
    <>
      {shape}
      <Adv id="lt" label="חיבור לעמוד — פלטות וברגים">{conn}</Adv>
      <Help>לפי תוכנית 130 "פרט נעילה אופקית": סיב RHS רציף בכל המפתחים של הציר; במפתחים הנעולים מסבך — חגורה שנייה ואלכסונים מרותכים במסגריה (מכלול אחד). פלטה: פלטת קצה מרותכת לכל סיב, 4 ברגים ארוכים דרך העמוד שמחברים את שני המפתחים. לשונית: כמו פרט האלכסון עמוד-קורה.</Help>
    </>
  );
}

export function PortalFields({ lineId }: { lineId?: string } = {}) {
  const br = useStore((s) => s.project.building.bracing);
  const ed = useEdit();
  const g = br.walls.portal ?? defaultPortal();
  const p: PortalBraceParams = { ...g, ...(lineId ? br.walls.linePortal?.[lineId] ?? {} : {}) };
  const set = (patch: Partial<PortalBraceParams>) => store.exec(setBuilding({ bracing: { ...br, walls: lineId
    ? { ...br.walls, linePortal: { ...(br.walls.linePortal ?? {}), [lineId]: { ...(br.walls.linePortal?.[lineId] ?? {}), ...patch } } }
    : { ...br.walls, portal: { ...g, ...patch } } } }));
  const shape = <>
    <PortalSchematic invert={!!p.invert} params={p} onSet={set} />
    {ed.showProfile && <>
      <div className="field prof"><label>קורת אגד</label><ProfilePicker testId="pb-beam" value={p.beam} families={['RHS', 'SHS']} onCommit={(v) => set({ beam: v })} /></div>
      <div className="field prof"><label>אלכסונים</label><ProfilePicker testId="pb-brace" value={p.brace} families={['RHS', 'SHS', 'CHS']} onCommit={(v) => set({ brace: v })} /></div>
    </>}
    <div className="field"><label>כיוון האלכסונים</label>
      <div className="seg" role="radiogroup" aria-label="כיוון האלכסונים">
        <button className={`tbtn${!p.invert ? ' on' : ''}`} role="radio" aria-checked={!p.invert} data-testid="pb-dir-down" onClick={() => set({ invert: false })}>למטה (רגיל)</button>
        <button className={`tbtn${p.invert ? ' on' : ''}`} role="radio" aria-checked={!!p.invert} data-testid="pb-dir-up" onClick={() => set({ invert: true })}>למעלה (הפוך)</button>
      </div></div>
    <div className="field"><label>קורת אגד בשאר המפתחים</label><label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="pb-cont" checked={p.continuous ?? true} onChange={(e) => set({ continuous: e.target.checked })} />{(p.continuous ?? true) ? 'כן — ללא אלכסונים' : 'לא'}</label></div>
  </>;
  const conn = <>
    <div className="field"><label>חיבור קורת האגד לעמוד</label>
      <select className="inp" data-testid="pb-orient" value={p.finOrient ?? 'horizontal'} onChange={(e) => set({ finOrient: e.target.value as 'horizontal' | 'vertical' })}>
        <option value="horizontal">פח ולשונית שוכבים — הקורה על ציר העמודים</option><option value="vertical">פח ולשונית במישור הקיר — הקורה מוסטת בעובי פח</option>
      </select></div>
    <div className="field"><label>ברגים בקצה אלכסון</label>
      <select className="inp" data-testid="pb-bolts" value={p.boltsPerEnd ?? 2} onChange={(e) => set({ boltsPerEnd: Number(e.target.value) })}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}×M{p.bolt.d} — {n / 2} {n === 2 ? 'שורה' : 'שורות'} של 2 לרוחב</option>)}</select></div>
    <div className="field"><label>ברגים בקצה קורת האגד</label>
      <select className="inp" data-testid="pb-beam-bolts" value={p.beamBolts ?? 2} onChange={(e) => set({ beamBolts: Number(e.target.value) })}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}×M{p.bolt.d} — {n / 2} {n === 2 ? 'שורה' : 'שורות'} של 2 לרוחב</option>)}</select></div>
    <div className="field"><label>עובי פלטות</label><NumField value={p.plateT} suffix='מ"מ' onCommit={(v) => set({ plateT: v })} /></div>
    <div className="field"><label>קוטר בורג</label><BoltSelect d={p.bolt.d} onChange={(d) => set({ bolt: { ...p.bolt, d } })} /></div>
  </>;
  if (ed.embed) return ed.showShape ? shape : conn;
  return (
    <>
      {shape}
      <Adv id="pb" label="חיבורים — פלטות וברגים">{conn}</Adv>
      <Help>פרט חיבור (לכל הקצוות, פרט הלקוח): פח מרותך לעמוד/לקורה במסגריה; בקצה ה-RHS חריץ ברוחב עובי הפח ולשונית מרותכת בתוכו; בשטח הלשונית צמודה לפח ומוברגת. בשאר המפתחים של הציר — קורת אגד בלבד, להעברת הכוחות האופקיים לאגד.</Help>
    </>
  );
}

function RidgeReinfEditor() {
  const rr = useStore((s) => s.project.building.ridgeReinf) ?? { ...defaultRidgeReinf(), type: 'none' as const };
  const hasRidge = useStore((s) => s.derived.connections.some((c) => c.type === 'ridge'));
  const set = (patch: Partial<RidgeReinfParams>) => store.exec(setBuilding({ ridgeReinf: { ...rr, ...patch } }));
  return (
    <>
      <div className="panel-title">חיזוק רכס</div>
      <div className="field"><label>שיטה</label>
        <select className="inp" data-testid="ridge-reinf" value={rr.type} onChange={(e) => set({ type: e.target.value as RidgeReinfParams['type'] })}>
          <option value="none">ללא</option><option value="plate">פלטה מוגבהת + פלטות חיזוק</option><option value="tie">פרופיל אופקי מתחת לרכס</option>
        </select>
      </div>
      <RidgeSchematic />
      {rr.type === 'plate' && <>
      </>}
      {rr.type === 'tie' && <>
        <div className="field prof"><label>חתך הפרופיל</label><ProfilePicker testId="rr-tie" value={rr.tieProfile} families={['IPE', 'UPN', 'HEA', 'RHS']} onCommit={(v) => set({ tieProfile: v })} /></div>
        <div className="field"><label>מרווח מתחת לקורות ברכס</label><NumField testId="rr-gap" value={rr.tieGap} suffix='מ"מ' onCommit={(v) => set({ tieGap: v })} /></div>
      </>}
      {!hasRidge && rr.type !== 'none' && <div className="hint">אין רכס במודל (גג חד־שיפועי או רכס מעל עמוד) — החיזוק לא נבנה.</div>}
      <Help>פלטה: פלטות הקצה ברכס מוגבהות ונוספת שורת ברגים; פלטה משולשת מרותכת מתחת לכל קורה. פרופיל: קורה אופקית בין שתי קורות הגג, מוברגת לפחים מרותכים לתחתית הקורות. אין בדיקת חוזק.</Help>
    </>
  );
}

export type BraceSection = 'knee' | 'ridge' | 'roof' | 'walls' | 'ties';
/** חיזוקים וקשיחות: אלכסוני עמוד-קורה, חיזוק רכס, קושרות גג, קשיחות קירות (X / אגד B), שורות קשירה */
export function BracePanel({ part }: { part?: BraceSection }) {
  return (
    <div className="panel-body" data-testid="brace-panel">
      {(!part || part === 'knee') && <><KneeEditor /><HaunchEditor /></>}
      {(!part || part !== 'knee') && <BracingEditor part={part} />}
    </div>
  );
}

/**
 * קושרות גג — רשת אחת בתוכנית (בקשת משתמש 18.11.2026): המפתחים משמאל לימין כמו בתוכנית הגג (1, 2, 3…),
 * הקטעים לרוחב (בין צירי העמודים) מלמעלה למטה. לחיצה על תא: ללא → X אחד → 2 → 3 (לאורך השיפוע) → ללא.
 */
function RoofXGrid() {
  const b = useStore((s) => s.project.building);
  const d = useStore((s) => s.derived);
  const segs = [...(d.roofSegments ?? [])].sort((p, q) => p.x0 - q.x0 || p.id.localeCompare(q.id));
  const br = b.bracing;
  const nb = b.frames.length - 1;
  if (!segs.length || nb < 1) return null;
  const bays = new Set(resolveBays(br.roof.bays, nb));
  const off = new Set(br.roof.segOff ?? []);
  const cnt = br.roof.segCount ?? {};
  const state = (bay: number, sg: string) => (!bays.has(bay) || off.has(`${bay}|${sg}`) ? 0 : cnt[`${bay}|${sg}`] ?? 1);
  const click = (bay: number, sg: string) => {
    const k = `${bay}|${sg}`, cur = state(bay, sg), next = cur >= 3 ? 0 : cur + 1;
    const nBays = new Set(bays), nOff = new Set(off), nCnt = { ...cnt };
    if (next === 0) {
      nOff.add(k); delete nCnt[k];
      if (segs.every((q) => q.id === sg || nOff.has(`${bay}|${q.id}`))) { nBays.delete(bay); for (const q of segs) nOff.delete(`${bay}|${q.id}`); }
    } else {
      if (!nBays.has(bay)) { nBays.add(bay); for (const q of segs) if (q.id !== sg) nOff.add(`${bay}|${q.id}`); }
      nOff.delete(k);
      if (next > 1) nCnt[k] = next; else delete nCnt[k];
    }
    store.exec(setBuilding({ bracing: { ...br, roof: { ...br.roof, bays: [...nBays].sort((p, q) => p - q), segOff: [...nOff], segCount: nCnt } } }));
  };
  const lineLab = (x: number) => d.section?.lines.find((l) => Math.abs(l.x - x) < 700)?.label ?? '';
  const W = 210, X0 = 30, X1 = 204, Y0 = 16, rowH = Math.max(10, Math.min(22, 120 / segs.length)), bw = (X1 - X0) / nb;
  const H = Y0 + rowH * segs.length + 14;
  return (
    <div className="schem" data-testid="br-roof-grid">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="קושרות גג — תוכנית">
        <text x={W / 2} y={9} className="sm-lbl-s" textAnchor="middle">תוכנית: לחיצה על תא — ללא / X / 2X / 3X לאורך השיפוע</text>
        {segs.map((q, r) => {
          const y = Y0 + r * rowH;
          return <g key={q.id}>
            <text x={X0 - 2} y={y + rowH / 2 + 2} className="sm-lbl-s" textAnchor="end" direction="ltr" style={{ unicodeBidi: 'plaintext' }}>{`${lineLab(q.x0)}–${lineLab(q.x1)}`.replace(/^–|–$/g, '') || q.id}</text>
            {Array.from({ length: nb }, (_, i) => {
              const a = X0 + i * bw, st = state(i, q.id);
              const xs = Array.from({ length: st }, (_, j) => [y + (rowH * j) / st, y + (rowH * (j + 1)) / st] as const);
              return <g key={i} className="bay-cell" data-testid={`br-grid-${i}-${q.id}`} onClick={() => click(i, q.id)}>
                <rect x={a} y={y} width={bw} height={rowH} className={st ? 'bay on' : 'bay'} />
                {xs.map(([u0, u1], j) => <g key={j}><line x1={a + 1} y1={u0 + 0.6} x2={a + bw - 1} y2={u1 - 0.6} className="sm-hi" strokeWidth={1.1} /><line x1={a + 1} y1={u1 - 0.6} x2={a + bw - 1} y2={u0 + 0.6} className="sm-hi" strokeWidth={1.1} /></g>)}
              </g>;
            })}
          </g>;
        })}
        {Array.from({ length: nb + 1 }, (_, i) => <g key={i}><line x1={X0 + i * bw} y1={Y0 - 2} x2={X0 + i * bw} y2={Y0 + rowH * segs.length + 2} className="sm-main" strokeWidth={1.2} />
          {(nb <= 24 || i % 2 === 0) && <text x={X0 + i * bw} y={H - 2} className="sm-lbl-s" textAnchor="middle">{i + 1}</text>}</g>)}
      </svg>
    </div>
  );
}

/** חלוקת פנלי X (שווים / על הפטות) וקושרות ברצועת הקונזולה */
function RoofXSplit() {
  const br = useStore((s) => s.project.building.bracing);
  const frames = useStore((s) => s.project.building.frames);
  const set = (roof: Partial<BuildingParams['bracing']['roof']>) => store.exec(setBuilding({ bracing: { ...br, roof: { ...br.roof, ...roof } } }));
  return <>
    {(br.roof.type ?? 'x') === 'x' && <div className="field"><label>חלוקת פנלים לאורך השיפוע</label>
      <select className="inp" data-testid="br-split" value={br.roof.split ?? 'equal'} onChange={(e) => set({ split: e.target.value as 'equal' | 'purlins' })}>
        <option value="equal">שווים</option><option value="purlins">צמתים על הפטות (פנלים לא שווים)</option>
      </select></div>}
    {(br.roof.type ?? 'x') === 'x' && (() => {
      const fr = frames, nb = fr.length - 1;
      const vals = Array.from({ length: nb }, (_, i) => br.roof.ySplit?.[String(i)]);
      const cur = vals.every((v) => v === vals[0]) ? (vals[0] === undefined ? 'auto' : String(vals[0])) : 'mixed';
      const long = fr.some((f, i) => i > 0 && Math.abs(f.y - fr[i - 1].y) > 9000);
      const setAll = (v: string) => set({ ySplit: v === 'auto' ? undefined : Object.fromEntries(Array.from({ length: nb }, (_, i) => [String(i), Number(v)])) });
      return <>
        <div className="field"><label>חלוקה לאורך המבנה (מפתח בין מסגרות)</label>
          <select className="inp" data-testid="br-ysplit" value={cur} onChange={(e) => setAll(e.target.value)}>
            <option value="auto">אוטומטי (מפתח מעל 9 מ' — תת־מפתחים עד 6 מ')</option>
            {cur === 'mixed' && <option value="mixed">משתנה בין מפתחים</option>}
            {[1, 2, 3, 4].map((n) => <option key={n} value={String(n)}>{n === 1 ? 'ללא חלוקה' : `${n} תת־מפתחים`}</option>)}
          </select></div>
        {(long || (cur !== 'auto' && cur !== '1')) && <div className="field prof"><label>תמוכה בגבול תת־מפתח</label><ProfilePicker testId="br-strut" value={br.roof.strut ?? 'RHS100x100x5'} families={['RHS', 'SHS']} onCommit={(v) => set({ strut: v })} /></div>}
        {long && <Help>מפתח ארוך: המפתח מחולק לאורך המבנה, ובכל גבול תמוכת RHS במקביל לקורות, תלויה מכל פטה בפח תלייה ו-2 ברגי M12. ה-X בכל תת־מפתח מתחבר לתמוכה בפחי חיבור — לאשר את הפרט מול המתכנן.</Help>}
      </>;
    })()}
    <label className="row"><input type="checkbox" data-testid="br-toeave" checked={!!br.roof.toEave} onChange={(e) => set({ toEave: e.target.checked })} />קושרות גם ברצועת הקונזולה (מהעמוד הקיצוני עד קצה הגג)</label>
  </>;
}

/** פרט קצה לקושרות X בגג (פח חיבור / מוט הברגה) ושדות המוט */
export function RoofEndFields() {
  const br = useStore((s) => s.project.building.bracing);
  const set = (patch: Partial<BuildingParams['bracing']>) => store.exec(setBuilding({ bracing: { ...br, ...patch } }));
  return <>
          <div className="field"><label>פרט קצה</label>
            <select className="inp" data-testid="br-roof-end" value={br.roof.endDetail ?? 'gusset'} onChange={(e) => set({ roof: { ...br.roof, endDetail: e.target.value as 'gusset' | 'rod', rod: br.roof.rod ?? defaultRodEnd(), ...(e.target.value === 'rod' && !br.roof.profile.startsWith('L') ? { profile: 'L50x50x4' } : {}) } })}>
              <option value="gusset">פח חיבור מרותך לווב + ברגים</option><option value="rod">מוט הברגה מרותך לזוויתן, דרך חור אובלי בקורה</option>
            </select></div>
          {br.roof.endDetail === 'rod' && (() => { const rp = br.roof.rod ?? defaultRodEnd(); const sr = (q: Partial<typeof rp>) => set({ roof: { ...br.roof, rod: { ...rp, ...q } } }); return <>
            <div className="field"><label>קוטר מוט</label><NumField testId="rod-d" value={rp.d} suffix="M" onCommit={(v) => sr({ d: Math.round(v) })} /></div>
            <div className="field"><label>אורך מוט</label><NumField testId="rod-l" value={rp.length} suffix='מ"מ' onCommit={(v) => sr({ length: v })} /></div>
            <div className="field"><label>חפיפת ריתוך</label><NumField testId="rod-ov" value={rp.overlap} suffix='מ"מ' onCommit={(v) => sr({ overlap: v })} /></div>
            <div className="field prof"><label>זוויתן דסקית</label><ProfilePicker value={rp.washer} families={['L']} onCommit={(v) => sr({ washer: v })} /></div>
            <div className="field"><label>אורך זוויתן דסקית</label><NumField value={rp.washerL} suffix='מ"מ' onCommit={(v) => sr({ washerL: v })} /></div>
            <div className="field"><label>תוספת לחור האובלי</label><NumField value={rp.slotExtra} suffix='מ"מ' onCommit={(v) => sr({ slotExtra: v })} /></div>
            <div className="field"><label>בורג הצטלבות</label><NumField value={rp.crossD} suffix="M" onCommit={(v) => sr({ crossD: Math.round(v) })} /></div>
            <Help>הזוויתן מקוצר כך שהמוט ({rp.length}) מרותך בחפיפה {rp.overlap} ועובר דרך חור אובלי בווב הקורה; בצד השני זוויתן קצר עם חור ואום. אורך החור האובלי מחושב לפי זווית האלכסון.</Help>
          </>; })()}
  </>;
}

/** חיבור קושרות X (פח חיבור מרותך + ברגים, בורג בהצטלבות) */
export function XConnFields() {
  const ed = useEdit();
  const br = useStore((s) => s.project.building.bracing);
  const set = (patch: Partial<BuildingParams['bracing']>) => store.exec(setBuilding({ bracing: { ...br, ...patch } }));
  return <>
    {ed.showTitle && <div className="panel-title">חיבור קושרות X</div>}
        <GussetSchematic />
        <div className="field"><label>קוטר בורג</label><BoltSelect testId="brc-d" d={br.conn.bolt.d} onChange={(d) => set({ conn: { ...br.conn, bolt: { ...br.conn.bolt, d } } })} /></div>
        <div className="field"><label>בורג בהצטלבות</label><label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="brc-cross" checked={br.conn.crossBolt} onChange={(e) => set({ conn: { ...br.conn, crossBolt: e.target.checked } })} />{br.conn.crossBolt ? 'כן' : 'לא'}</label></div>
  </>;
}

/** קושרות גג בחלון האלמנט: צורה (סוג, תוכנית, מרווחים) */
export function RoofXShape() {
  const br = useStore((s) => s.project.building.bracing);
  const set = (patch: Partial<BuildingParams['bracing']>) => store.exec(setBuilding({ bracing: { ...br, ...patch } }));
  return <>
    <div className="field"><label>סוג</label>
      <select className="inp" data-testid="br-roof-type" value={br.roof.type ?? 'x'} onChange={(e) => set({ roof: { ...br.roof, type: e.target.value as 'x' | 'rhs', rhs: br.roof.rhs ?? defaultRhsTruss() } })}>
        <option value="x">X מזוויתנים (מתיחה)</option><option value="rhs">סבכה אופקית RHS (מוטות + אלכסונים)</option>
      </select></div>
    <RoofXGrid />
    <RoofXSplit />
    <Adv id="roofgaps-e" label="מרווחים בקצוות הקושרות">
      <div className="field"><label>שני קצוות באותה נקודה, אותו מפתח</label><NumField value={br.roof.sameGap ?? 200} suffix='מ"מ' onCommit={(v) => set({ roof: { ...br.roof, sameGap: Math.max(0, v) } })} /></div>
      {br.roof.endDetail === 'rod' && <div className="field"><label>מפתחים סמוכים — מוטות זה מעל זה</label><NumField value={br.roof.adjGap ?? 40} suffix='מ"מ' onCommit={(v) => set({ roof: { ...br.roof, adjGap: Math.max(0, v) } })} /></div>}
      <div className="field"><label>מרחק מפני עמוד שממשיך מעל הגג</label><NumField value={br.roof.colClear ?? 150} suffix='מ"מ' onCommit={(v) => set({ roof: { ...br.roof, colClear: Math.max(0, v) } })} /></div>
    </Adv>
  </>;
}

/** קושרות גג בחלון האלמנט: חיבורים */
export function RoofXConn() {
  const br = useStore((s) => s.project.building.bracing);
  if ((br.roof.type ?? 'x') === 'rhs') return <RhsFields />;
  return <><RoofEndFields />{(br.roof.endDetail ?? 'gusset') === 'gusset' && <XConnFields />}</>;
}

/** קושרות X בקיר בחלון האלמנט: מפתחים לכל ציר */
export function WallXShape() {
  const nb = useStore((s) => s.project.building.frames.length - 1);
  return <WallLines nb={nb} />;
}

function BracingEditor({ part }: { part?: Exclude<BraceSection, 'knee'> } = {}) {
  const on = (k: Exclude<BraceSection, 'knee'>) => !part || part === k;
  const b = useStore((s) => s.project.building);
  const br = b.bracing;
  const nb = b.frames.length - 1;
  const set = (patch: Partial<BuildingParams['bracing']>) => store.exec(setBuilding({ bracing: { ...br, ...patch } }));
  return (
    <>
      {on('roof') && <>
      <div className="panel-title">קושרות X – גג
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="br-roof" checked={br.roof.enabled} onChange={(e) => set({ roof: { ...br.roof, enabled: e.target.checked } })} />פעיל</label>
      </div>
      {!br.roof.enabled && <OffCard pic="roofX" title="קושרות גג" desc="X מזוויתנים או סבכה אופקית RHS במישור הגג, במפתחים שבוחרים בתוכנית" onAdd={() => set({ roof: { ...br.roof, enabled: true } })} testId="off-roof" />}
      {br.roof.enabled && <>
        <div className="field"><label>סוג</label>
          <select className="inp" data-testid="br-roof-type" value={br.roof.type ?? 'x'} onChange={(e) => set({ roof: { ...br.roof, type: e.target.value as 'x' | 'rhs', rhs: br.roof.rhs ?? defaultRhsTruss() } })}>
            <option value="x">X מזוויתנים (מתיחה)</option><option value="rhs">סבכה אופקית RHS (מוטות + אלכסונים)</option>
          </select>
        </div>
        {(br.roof.type ?? 'x') === 'x'
          ? <div className="field prof"><label>חתך</label><ProfilePicker value={br.roof.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => set({ roof: { ...br.roof, profile: v } })} /></div>
          : <RhsFields />}
        <RoofXGrid />
        <RoofXSplit />
        {(br.roof.type ?? 'x') === 'x' && <>
          <RoofEndFields />
        </>}
        <Adv id="roofgaps" label="מתקדם — מרווחים בקצוות הקושרות">
          <div className="field"><label>שני קצוות באותה נקודה, אותו מפתח (זה ליד זה)</label><NumField testId="br-samegap" value={br.roof.sameGap ?? 200} suffix='מ"מ' onCommit={(v) => set({ roof: { ...br.roof, sameGap: Math.max(0, v) } })} /></div>
          {br.roof.endDetail === 'rod' && <div className="field"><label>מפתחים סמוכים — מוטות זה מעל זה</label><NumField testId="br-adjgap" value={br.roof.adjGap ?? 40} suffix='מ"מ' onCommit={(v) => set({ roof: { ...br.roof, adjGap: Math.max(0, v) } })} /></div>}
          <div className="field"><label>מרחק מפני עמוד שממשיך מעל הגג</label><NumField testId="br-colclear" value={br.roof.colClear ?? 150} suffix='מ"מ' onCommit={(v) => set({ roof: { ...br.roof, colClear: Math.max(0, v) } })} /></div>
        </Adv>
        <Help>כל שיפוע מחולק לקטעים בכל ציר עמודים פנימי. בתוכנית — בחירה איפה יש X ובכמה פנלים לאורך השיפוע (קטע ארוך מקבל לפחות את מה שנדרש לאורך חומר הגלם). שני קצוות שמגיעים לאותה נקודה באותו מפתח — זה ליד זה; ממפתחים סמוכים (מוט הברגה) — זה מעל זה.</Help>
      </>}
      </>}
      {on('walls') && <>
      <div className="panel-title">קשיחות לאורך – קירות
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="br-walls" checked={br.walls.enabled} onChange={(e) => set({ walls: { ...br.walls, enabled: e.target.checked } })} />פעיל</label>
      </div>
      {!br.walls.enabled && <OffCard pic="walls" title="קשיחות קירות" desc="אלכסוני X, אגד B או נעילה אופקית בקירות לאורך המבנה" onAdd={() => set({ walls: { ...br.walls, enabled: true } })} testId="off-walls" />}
      {br.walls.enabled && <>
        <div className="choice2" role="radiogroup" aria-label="סוג קשיחות הקיר">
          {([['x', 'אלכסוני X', 'קושרות X מזוויתנים — עובדות במתיחה', 'brace'], ['portal', 'אגד B', 'קורת RHS בין העמודים + שני אלכסונים קטנים', 'walls'], ['truss', 'נעילה אופקית', 'מסבך RHS במפתחים הנעולים + סיב רציף לכל האורך', 'walls']] as const).map(([k, t, dsc, pic]) => (
            <button key={k} role="radio" aria-checked={(br.walls.type ?? 'x') === k} className={`choice-tile${(br.walls.type ?? 'x') === k ? ' on' : ''}`} data-testid={`br-walls-${k}`}
              onClick={() => set({ walls: { ...br.walls, type: k, portal: br.walls.portal ?? defaultPortal(), truss: br.walls.truss ?? defaultLockTruss() } })}>
              <MenuPic name={pic} size={44} /><b>{t}</b><span>{dsc}</span>
            </button>
          ))}
        </div>
        {(br.walls.type ?? 'x') === 'x'
          ? <div className="field prof"><label>חתך</label><ProfilePicker value={br.walls.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => set({ walls: { ...br.walls, profile: v } })} /></div>
          : br.walls.type === 'truss' ? <LockTrussFields /> : <PortalFields />}
        <WallLines nb={nb} />
      </>}
      </>}
      {on('ties') && <>
      <div className="panel-title">שורת קשירה לפטות
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="br-ties" checked={br.purlinTies.enabled} onChange={(e) => set({ purlinTies: { ...br.purlinTies, enabled: e.target.checked } })} />פעיל</label>
      </div>
      {!br.purlinTies.enabled && <OffCard pic="ties" title="שורות קשירה לפטות" desc="זוויתן באמצע כל מפתח, צמוד לאגף התחתון של הפטות — מונע הפיתול שלהן" onAdd={() => set({ purlinTies: { ...br.purlinTies, enabled: true } })} testId="off-ties" />}
      {br.purlinTies.enabled && <div className="field prof"><label>חתך</label><ProfilePicker value={br.purlinTies.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => set({ purlinTies: { ...br.purlinTies, profile: v } })} /></div>}
      </>}
      {on('ridge') && <RidgeReinfEditor />}
      {(on('roof') || on('walls')) && (br.roof.enabled && (br.roof.type ?? 'x') === 'x' || br.walls.enabled && (br.walls.type ?? 'x') === 'x') && <>
        <XConnFields />
      </>}
      {(on('roof') || on('walls') || on('ties')) && <Help>קושרות X עובדות במתיחה בלבד. פח החיבור מרותך לווב הקורה/העמוד במסגריה, הזוויתן מוברג בשטח; בהצטלבות פח מילוי ובורג. שורת קשירה באמצע כל מפתח, צמודה לאגף התחתון של הפטות. בדיקת חוזק — אינה מבוצעת.</Help>}
    </>
  );
}
