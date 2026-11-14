import { useState } from 'react';
import { addFrame, removeFrame, respaceFrames, setBuilding, setFrameY, setMeta, setSettings } from '../commands/commands';
import type { BuildingParams } from '../model/types';
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

export function StructurePanel() {
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

      <div className="panel-title">חתכים וחומר</div>
      <div className="field"><label>עמודים</label><TextField ltr list="profiles" testId="columnProfile" value={b.columnProfile} onCommit={(v) => set({ columnProfile: v.toUpperCase().replace(/\s/g, '') })} /></div>
      <div className="field"><label>קורות גג</label><TextField ltr list="profiles" testId="rafterProfile" value={b.rafterProfile} onCommit={(v) => set({ rafterProfile: v.toUpperCase().replace(/\s/g, '') })} /></div>
      <div className="field"><label>חומר</label>
        <select className="inp" value={b.material} onChange={(e) => set({ material: e.target.value })}>
          {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

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
    </div>
  );
}
