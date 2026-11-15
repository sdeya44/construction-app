import { useState } from 'react';
import { addFrame, removeFrame, respaceFrames, setBuilding, setFrameY, setMeta, setSettings } from '../commands/commands';
import type { BuildingParams } from '../model/types';
import { resolveBays } from '../geometry/bracing';
import { catalogNames } from '../profiles/library';
import { MATERIALS } from '../profiles/materials';
import { store, useStore } from '../store';
import { LenField, NumField, TextField } from './fields';
import { Icon } from './icons';

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
      <div className="panel-title">גיאומטריית מבנה</div>
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
      <div className="field"><label>ייחוס גבהים</label>
        <select className="inp" value={b.heightRef} onChange={(e) => set({ heightRef: e.target.value as BuildingParams['heightRef'] })}>
          <option value="TOS">פני עליון קורת גג (TOS)</option><option value="AXIS">ציר קורת הגג</option>
        </select>
      </div>
      <div className="field"><label>קונזולת קורה שמאל</label><LenField mm={b.rafterOverhangLeft} unit={u} onCommit={(v) => set({ rafterOverhangLeft: v })} /></div>
      <div className="field"><label>קונזולת קורה ימין</label><LenField mm={b.rafterOverhangRight} unit={u} onCommit={(v) => set({ rafterOverhangRight: v })} /></div>
      <div className="field"><label>קונזולת פטות – התחלה (Y)</label><LenField mm={b.purlinOverhangStart} unit={u} onCommit={(v) => set({ purlinOverhangStart: v })} /></div>
      <div className="field"><label>קונזולת פטות – סוף (Y)</label><LenField mm={b.purlinOverhangEnd} unit={u} onCommit={(v) => set({ purlinOverhangEnd: v })} /></div>
      <div className="field"><label>מפלס בסיס</label><LenField mm={b.baseElevation} unit={u} onCommit={(v) => set({ baseElevation: v })} /></div>

      </>}
      {show('profiles') && <>
      <div className="panel-title">חתכים וחומר</div>
      <div className="field"><label>עמודים</label><TextField ltr list="profiles" testId="columnProfile" value={b.columnProfile} onCommit={(v) => set({ columnProfile: v.toUpperCase().replace(/\s/g, '') })} /></div>
      <div className="field"><label>קורות גג</label><TextField ltr list="profiles" testId="rafterProfile" value={b.rafterProfile} onCommit={(v) => set({ rafterProfile: v.toUpperCase().replace(/\s/g, '') })} /></div>
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
        <div className="field"><label>חתך</label><TextField ltr list="profiles" value={br.roof.profile} onCommit={(v) => set({ roof: { ...br.roof, profile: v.toUpperCase().replace(/\s/g, '') } })} /></div>
        <div className="field"><label>מפתחים</label><BayPicker testId="br-roof-bays" bays={br.roof.bays} count={nb} onChange={(x) => set({ roof: { ...br.roof, bays: x } })} /></div>
      </>}
      <div className="panel-title">קושרות X – קירות
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="br-walls" checked={br.walls.enabled} onChange={(e) => set({ walls: { ...br.walls, enabled: e.target.checked } })} />פעיל</label>
      </div>
      {br.walls.enabled && <>
        <div className="field"><label>חתך</label><TextField ltr list="profiles" value={br.walls.profile} onCommit={(v) => set({ walls: { ...br.walls, profile: v.toUpperCase().replace(/\s/g, '') } })} /></div>
        <div className="field"><label>ציר א (שמאל)</label><BayPicker testId="br-wl" bays={br.walls.left} count={nb} onChange={(x) => set({ walls: { ...br.walls, left: x } })} /></div>
        <div className="field"><label>ציר ב (ימין)</label><BayPicker testId="br-wr" bays={br.walls.right} count={nb} onChange={(x) => set({ walls: { ...br.walls, right: x } })} /></div>
      </>}
      <div className="panel-title">שורת קשירה לפטות
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="br-ties" checked={br.purlinTies.enabled} onChange={(e) => set({ purlinTies: { ...br.purlinTies, enabled: e.target.checked } })} />פעיל</label>
      </div>
      {br.purlinTies.enabled && <div className="field"><label>חתך</label><TextField ltr list="profiles" value={br.purlinTies.profile} onCommit={(v) => set({ purlinTies: { ...br.purlinTies, profile: v.toUpperCase().replace(/\s/g, '') } })} /></div>}
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
