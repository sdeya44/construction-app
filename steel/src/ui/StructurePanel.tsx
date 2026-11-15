import { useState } from 'react';
import { addFrame, removeFrame, respaceFrames, setBuilding, setFrameY, setMeta, setSettings } from '../commands/commands';
import type { BuildingParams, PortalBraceParams, RhsTrussParams, RidgeReinfParams } from '../model/types';
import { defaultPortal } from '../geometry/portal';
import { defaultRhsTruss } from '../geometry/hbrace';
import { defaultRidgeReinf } from '../model/defaults';
import { resolveBays, wallBays } from '../geometry/bracing';
import { catalogNames } from '../profiles/library';
import { MATERIALS } from '../profiles/materials';
import { store, useStore } from '../store';
import { LenField, NumField, ProfilePicker, TextField } from './fields';
import { Icon } from './icons';
import { SectionEditor } from './SectionEditor';

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
      </>}

      {show('geometry') && <>
      <SectionEditor />
      <div className="panel-title">גיאומטריית מבנה</div>
      {!b.section && <>
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
      <div className="field"><label>גובה ציר א (שמאל)</label><LenField testId="eaveLeft" mm={b.eaveLeft} unit={u} onCommit={(v) => set({ eaveLeft: v })} /></div>
      <div className="field"><label>גובה ציר ב (ימין)</label><LenField testId="eaveRight" mm={b.eaveRight} unit={u} onCommit={(v) => set({ eaveRight: v })} /></div>
      {b.roofType === 'gable' && <>
        <div className="field"><label>מיקום רכס מציר א</label><LenField testId="ridgeX" mm={b.ridgeX} unit={u} onCommit={(v) => set({ ridgeX: v })} /></div>
        <div className="field"><label>שיפוע שמאל</label><NumField testId="slopeLeft" value={b.slopeLeftPct} suffix="%" onCommit={(v) => set({ slopeLeftPct: v })} /></div>
      </>}
      <dl className="kv">
        {roof.ridgeZ !== undefined && <><dt>גובה רכס (נגזר)</dt><dd>{(roof.ridgeZ / (u === 'm' ? 1000 : 1)).toFixed(u === 'm' ? 3 : 0)}</dd></>}
        <dt>{b.roofType === 'gable' ? 'שיפוע ימין (נגזר)' : 'שיפוע (נגזר)'}</dt><dd>{(roof.slopeRight * 100).toFixed(2)}%</dd>
      </dl>
      </>}
      <div className="field"><label>ייחוס גבהים</label>
        <select className="inp" value={b.heightRef} onChange={(e) => set({ heightRef: e.target.value as BuildingParams['heightRef'] })}>
          <option value="TOS">פני עליון קורת גג (TOS)</option><option value="AXIS">ציר קורת הגג</option>
        </select>
      </div>
      {!b.section && <>
      <div className="field"><label>קונזולת קורה שמאל</label><LenField mm={b.rafterOverhangLeft} unit={u} onCommit={(v) => set({ rafterOverhangLeft: v })} /></div>
      <div className="field"><label>קונזולת קורה ימין</label><LenField mm={b.rafterOverhangRight} unit={u} onCommit={(v) => set({ rafterOverhangRight: v })} /></div>
      </>}
      <div className="field"><label>קונזולת פטות – התחלה (Y)</label><LenField mm={b.purlinOverhangStart} unit={u} onCommit={(v) => set({ purlinOverhangStart: v })} /></div>
      <div className="field"><label>קונזולת פטות – סוף (Y)</label><LenField mm={b.purlinOverhangEnd} unit={u} onCommit={(v) => set({ purlinOverhangEnd: v })} /></div>
      <div className="field"><label>מפלס בסיס</label><LenField mm={b.baseElevation} unit={u} onCommit={(v) => set({ baseElevation: v })} /></div>

      </>}
      {show('profiles') && <>
      <div className="panel-title">חתכים וחומר</div>
      <div className="field prof"><label>עמודים</label><ProfilePicker testId="columnProfile" value={b.columnProfile} families={['HEA', 'HEB', 'HEM', 'IPE', 'RHS', 'SHS', 'CHS']} onCommit={(v) => set({ columnProfile: v })} /></div>
      <div className="field prof"><label>קורות גג</label><ProfilePicker testId="rafterProfile" value={b.rafterProfile} families={['IPE', 'HEA', 'HEB', 'RHS', 'UPN']} onCommit={(v) => set({ rafterProfile: v })} /></div>
      <div className="field"><label>חומר</label>
        <select className="inp" value={b.material} onChange={(e) => set({ material: e.target.value })}>
          {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      </>}
      {show('bracing') && <BracingEditor />}
      {show('frames') && <>
      <div className="panel-title">מסגרות ({frames.length})
        <button className="btn small" data-testid="add-frame" onClick={() => {
          const last = frames[frames.length - 1];
          const prev = frames[frames.length - 2];
          store.exec(addFrame(last.y + (prev ? last.y - prev.y : 6000)));
        }}><Icon name="plus" />מסגרת</button>
      </div>
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
      </>}
    </div>
  );
}

function BayPicker({ bays, count, onChange, testId }: { bays: number[]; count: number; onChange: (b: number[]) => void; testId: string }) {
  const sel = new Set(resolveBays(bays, count));
  return (
    <div className="row" data-testid={testId} style={{ gap: 3 }}>
      {Array.from({ length: count }, (_, i) => (
        <label key={i} className={`badge${sel.has(i) ? ' blue' : ''}`} style={{ cursor: 'pointer' }} title={`מפתח ${i + 1} (מסגרות ${i + 1}–${i + 2})`}>
          <input type="checkbox" checked={sel.has(i)} style={{ display: 'none' }}
            onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(i); else n.delete(i); onChange([...n].sort((a, b) => a - b)); }} />
          {i + 1}
        </label>
      ))}
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
  const cur = new Map(wallBays(br, ls.map((l) => l.id)));
  const setLine = (id: string, bays: number[]) => {
    const byLine: Record<string, number[]> = {};
    for (const l of ls) byLine[l.id] = l.id === id ? bays : cur.get(l.id) ?? [];
    store.exec(setBuilding({ bracing: { ...br, walls: { ...br.walls, byLine, left: byLine[ls[0]?.id] ?? [], right: byLine[ls[ls.length - 1]?.id] ?? [] } } }));
  };
  return (
    <>
      {ls.map((l, i) => (
        <div className="field" key={l.id}><label>ציר {l.label}{i === 0 ? ' (שמאל)' : i === ls.length - 1 ? ' (ימין)' : ' (פנימי)'}</label>
          <BayPicker testId={i === 0 ? 'br-wl' : i === ls.length - 1 ? 'br-wr' : `br-w-${l.id}`} bays={cur.get(l.id) ?? []} count={nb} onChange={(x) => setLine(l.id, x)} /></div>
      ))}
    </>
  );
}

function PortalFields() {
  const br = useStore((s) => s.project.building.bracing);
  const p = br.walls.portal ?? defaultPortal();
  const set = (patch: Partial<PortalBraceParams>) => store.exec(setBuilding({ bracing: { ...br, walls: { ...br.walls, portal: { ...p, ...patch } } } }));
  return (
    <>
      <div className="field prof"><label>קורת אגד</label><ProfilePicker testId="pb-beam" value={p.beam} families={['RHS', 'SHS']} onCommit={(v) => set({ beam: v })} /></div>
      <div className="field prof"><label>אלכסונים</label><ProfilePicker testId="pb-brace" value={p.brace} families={['RHS', 'SHS', 'CHS']} onCommit={(v) => set({ brace: v })} /></div>
      <div className="field"><label>מרווח מתחת לקורה הראשית</label><NumField testId="pb-gap" value={p.gap} suffix='מ"מ' onCommit={(v) => set({ gap: Math.max(0, v) })} /></div>
      <div className="field"><label>ירידה על העמוד</label><NumField testId="pb-drop" value={p.drop} suffix='מ"מ' onCommit={(v) => set({ drop: Math.max(200, v) })} /></div>
      <div className="field"><label>זווית אלכסון</label><NumField testId="pb-angle" value={p.angle} suffix="°" onCommit={(v) => set({ angle: Math.max(20, Math.min(70, v)) })} /></div>
      <div className="field"><label>עובי פלטות</label><NumField value={p.plateT} suffix='מ"מ' onCommit={(v) => set({ plateT: v })} /></div>
      <div className="field"><label>ברגים בקצה אלכסון</label>
        <select className="inp" data-testid="pb-bolts" value={p.boltsPerEnd ?? 2} onChange={(e) => set({ boltsPerEnd: Number(e.target.value) })}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}×M{p.bolt.d} — {n / 2} {n === 2 ? 'שורה' : 'שורות'} של 2 לרוחב</option>)}</select></div>
      <div className="field"><label>ברגים בקצה קורת האגד</label>
        <select className="inp" data-testid="pb-beam-bolts" value={p.beamBolts ?? 2} onChange={(e) => set({ beamBolts: Number(e.target.value) })}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}×M{p.bolt.d} — {n / 2} {n === 2 ? 'שורה' : 'שורות'} של 2 לרוחב</option>)}</select></div>
      <div className="field"><label>קורת אגד בשאר המפתחים</label><label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="pb-cont" checked={p.continuous ?? true} onChange={(e) => set({ continuous: e.target.checked })} />{(p.continuous ?? true) ? 'כן — ללא אלכסונים' : 'לא'}</label></div>
      <div className="field"><label>קוטר בורג</label><NumField value={p.bolt.d} suffix="M" onCommit={(v) => set({ bolt: { ...p.bolt, d: Math.round(v) } })} /></div>
      <div className="hint">פרט חיבור (לכל הקצוות, פרט הלקוח): פח מרותך לעמוד/לקורה במסגריה; בקצה ה-RHS חריץ ברוחב עובי הפח ולשונית מרותכת בתוכו; בשטח הלשונית צמודה לפח ומוברגת. קורת האגד מוסטת בעובי פח מציר העמודים; האלכסונים על ציר העמודים. בשאר המפתחים של הציר — קורת אגד בלבד, להעברת הכוחות האופקיים לאגד.</div>
    </>
  );
}

function RidgeReinfEditor() {
  const rr = useStore((s) => s.project.building.ridgeReinf) ?? defaultRidgeReinf();
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
      {rr.type === 'plate' && <>
        <div className="field"><label>עומק הגבהה מתחת לקורה</label><NumField testId="rr-depth" value={rr.depth} suffix='מ"מ' onCommit={(v) => set({ depth: v })} /></div>
        <div className="field"><label>אורך החיזוק מהרכס</label><NumField value={rr.length} suffix='מ"מ' onCommit={(v) => set({ length: v })} /></div>
        <div className="field"><label>עובי פלטת חיזוק</label><NumField value={rr.stiffT} suffix='מ"מ' onCommit={(v) => set({ stiffT: v })} /></div>
      </>}
      {rr.type === 'tie' && <>
        <div className="field prof"><label>חתך הפרופיל</label><ProfilePicker testId="rr-tie" value={rr.tieProfile} families={['IPE', 'UPN', 'HEA', 'RHS']} onCommit={(v) => set({ tieProfile: v })} /></div>
        <div className="field"><label>מרווח מתחת לקורות ברכס</label><NumField testId="rr-gap" value={rr.tieGap} suffix='מ"מ' onCommit={(v) => set({ tieGap: v })} /></div>
      </>}
      {!hasRidge && rr.type !== 'none' && <div className="hint">אין רכס במודל (גג חד־שיפועי או רכס מעל עמוד) — החיזוק לא נבנה.</div>}
      <div className="hint">פלטה: פלטות הקצה ברכס מוגבהות ונוספת שורת ברגים; פלטה משולשת מרותכת מתחת לכל קורה. פרופיל: קורה אופקית בין שתי קורות הגג, מוברגת לפחים מרותכים לתחתית הקורות. אין בדיקת חוזק.</div>
    </>
  );
}

function BracingEditor() {
  const b = useStore((s) => s.project.building);
  const br = b.bracing;
  const nb = b.frames.length - 1;
  const set = (patch: Partial<BuildingParams['bracing']>) => store.exec(setBuilding({ bracing: { ...br, ...patch } }));
  return (
    <>
      <div className="panel-title">קושרות X – גג
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="br-roof" checked={br.roof.enabled} onChange={(e) => set({ roof: { ...br.roof, enabled: e.target.checked } })} />פעיל</label>
      </div>
      {br.roof.enabled && <>
        <div className="field"><label>סוג</label>
          <select className="inp" data-testid="br-roof-type" value={br.roof.type ?? 'x'} onChange={(e) => set({ roof: { ...br.roof, type: e.target.value as 'x' | 'rhs', rhs: br.roof.rhs ?? defaultRhsTruss() } })}>
            <option value="x">X מזוויתנים (מתיחה)</option><option value="rhs">סבכה אופקית RHS (מוטות + אלכסונים)</option>
          </select>
        </div>
        {(br.roof.type ?? 'x') === 'x'
          ? <div className="field prof"><label>חתך</label><ProfilePicker value={br.roof.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => set({ roof: { ...br.roof, profile: v } })} /></div>
          : <RhsFields />}
        <div className="field"><label>מפתחים</label><BayPicker testId="br-roof-bays" bays={br.roof.bays} count={nb} onChange={(x) => set({ roof: { ...br.roof, bays: x } })} /></div>
      </>}
      <div className="panel-title">קשיחות לאורך – קירות
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="br-walls" checked={br.walls.enabled} onChange={(e) => set({ walls: { ...br.walls, enabled: e.target.checked } })} />פעיל</label>
      </div>
      {br.walls.enabled && <>
        <div className="field"><label>סוג</label>
          <select className="inp" data-testid="br-walls-type" value={br.walls.type ?? 'x'} onChange={(e) => set({ walls: { ...br.walls, type: e.target.value as 'x' | 'portal', portal: br.walls.portal ?? defaultPortal() } })}>
            <option value="x">X מזוויתנים (מתיחה)</option><option value="portal">אגד B — קורת RHS + שני אלכסונים</option>
          </select>
        </div>
        {(br.walls.type ?? 'x') === 'x'
          ? <div className="field prof"><label>חתך</label><ProfilePicker value={br.walls.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => set({ walls: { ...br.walls, profile: v } })} /></div>
          : <PortalFields />}
        <WallLines nb={nb} />
      </>}
      <div className="panel-title">שורת קשירה לפטות
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="br-ties" checked={br.purlinTies.enabled} onChange={(e) => set({ purlinTies: { ...br.purlinTies, enabled: e.target.checked } })} />פעיל</label>
      </div>
      {br.purlinTies.enabled && <div className="field prof"><label>חתך</label><ProfilePicker value={br.purlinTies.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => set({ purlinTies: { ...br.purlinTies, profile: v } })} /></div>}
      <RidgeReinfEditor />
      {(br.roof.enabled || br.walls.enabled) && <>
        <div className="panel-title">חיבור קושרות X</div>
        <div className="field"><label>קוטר בורג</label><NumField testId="brc-d" value={br.conn.bolt.d} suffix="M" onCommit={(v) => set({ conn: { ...br.conn, bolt: { ...br.conn.bolt, d: Math.round(v) } } })} /></div>
        <div className="field"><label>ברגים בכל קצה</label><NumField testId="brc-n" value={br.conn.boltsPerEnd} onCommit={(v) => set({ conn: { ...br.conn, boltsPerEnd: Math.max(1, Math.round(v)) } })} /></div>
        <div className="field"><label>מרווח ברגים</label><NumField value={br.conn.pitch} suffix='מ"מ' onCommit={(v) => set({ conn: { ...br.conn, pitch: v } })} /></div>
        <div className="field"><label>מרחק קצה</label><NumField value={br.conn.endDist} suffix='מ"מ' onCommit={(v) => set({ conn: { ...br.conn, endDist: v } })} /></div>
        <div className="field"><label>עובי פח חיבור</label><NumField value={br.conn.gussetT} suffix='מ"מ' onCommit={(v) => set({ conn: { ...br.conn, gussetT: v } })} /></div>
        <div className="field"><label>בורג בהצטלבות</label><label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="brc-cross" checked={br.conn.crossBolt} onChange={(e) => set({ conn: { ...br.conn, crossBolt: e.target.checked } })} />{br.conn.crossBolt ? 'כן' : 'לא'}</label></div>
      </>}
      <div className="hint">קושרות X עובדות במתיחה בלבד. פח החיבור מרותך לווב הקורה/העמוד במסגריה, הזוויתן מוברג בשטח; בהצטלבות פח מילוי ובורג. שורת קשירה באמצע כל מפתח, צמודה לאגף התחתון של הפטות. בדיקת חוזק — אינה מבוצעת.</div>
    </>
  );
}
