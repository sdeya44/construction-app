import { setBuilding } from '../commands/commands';
import { defaultWing } from '../geometry/wing';
import type { WingDef } from '../model/types';
import { store, useStore } from '../store';
import { Help, LenField, NumField, ProfilePicker } from './fields';
import { LSvg } from './Dialogs';

/** כנף (סככת L): סככה נמוכה שמחוברת לקיר הצד של הסככה הראשית */
export function WingPanel() {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const b = p.building;
  const w = b.wing;
  const u = p.displayUnit;
  const set = (patch: Partial<WingDef>) => store.exec(setBuilding({ wing: { ...(w ?? defaultWing(b, 'gable')), ...patch } }));
  const fr = [...b.frames].sort((a, c) => a.y - c.y);
  const errs = d.issues.filter((i) => i.code.startsWith('WING') && i.severity === 'error');
  return (
    <div className="panel-body" data-testid="wing-panel">
      <div className="panel-title">כנף — סככת L</div>
      <Help>
        כנף נמוכה שמחוברת לקיר הצד של הסככה. <b>דו-שיפועית:</b> הרכס ניצב לסככה הראשית; המסגרת הראשונה של הכנף יושבת על עמודי הסככה הראשית (כיסא מרותך + 2×M16).
        <b> חד-שיפועית:</b> הקורות מקבילות למסגרות הראשיות, נשענות על העמודים הראשיים ויורדות החוצה. בצד החיבור מוסרים חיפוי הקיר והקושרות במפתחי הכנף.
      </Help>
      {!w?.enabled ? (
        <div className="tpl-grid wing-pick">
          <button className="tpl" onClick={() => store.exec(setBuilding({ wing: defaultWing(b, 'gable') }))} data-testid="wing-add-gable" title="הרכס ניצב לסככה הראשית"><LSvg gable /><span>＋ כנף דו-שיפועית</span><small>רכס ניצב לסככה</small></button>
          <button className="tpl" onClick={() => store.exec(setBuilding({ wing: defaultWing(b, 'mono') }))} data-testid="wing-add-mono" title="יורדת החוצה מהקיר"><LSvg /><span>＋ כנף חד-שיפועית</span><small>יורדת החוצה מהקיר</small></button>
        </div>
      ) : <>
        <label className="row"><input type="checkbox" checked={w.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="wing-on" />כנף פעילה</label>
        <div className="field"><label>סוג גג</label>
          <select className="inp" value={w.roofType} data-testid="wing-type" onChange={(e) => store.exec(setBuilding({ wing: { ...defaultWing(b, e.target.value as 'gable' | 'mono'), side: w.side, fromFrame: w.fromFrame, bays: w.bays } }))}>
            <option value="gable">דו-שיפועי — רכס ניצב לסככה</option><option value="mono">חד-שיפועי — יורד החוצה</option>
          </select></div>
        <div className="field"><label>צד החיבור</label>
          <select className="inp" value={w.side} data-testid="wing-side" onChange={(e) => set({ side: e.target.value as 'L' | 'R' })}>
            <option value="R">ציר אחרון (ימין)</option><option value="L">ציר ראשון (שמאל)</option>
          </select></div>
        <div className="field"><label>מתחילה במסגרת</label>
          <select className="inp" value={w.fromFrame} data-testid="wing-from" onChange={(e) => set({ fromFrame: e.target.value })}>
            {fr.slice(0, -1).map((f, i) => <option key={f.id} value={f.id}>{i + 1}</option>)}
          </select></div>
        <div className="field"><label>רוחב (מפתחים ראשיים)</label><NumField testId="wing-bays" value={w.bays} onCommit={(v) => set({ bays: Math.max(1, Math.round(v)) })} /></div>
        <div className="field"><label>אורך החוצה</label><LenField testId="wing-length" mm={w.length} unit={u} onCommit={(v) => set({ length: v })} /></div>
        {w.roofType === 'gable' && <div className="field"><label>מסגרות בכנף</label><NumField testId="wing-frames" value={w.frames} onCommit={(v) => set({ frames: Math.max(2, Math.round(v)) })} /></div>}
        <div className="field"><label>{w.roofType === 'mono' ? 'גובה מרזב (קצה חיצוני)' : 'גובה מרזב'}</label><LenField testId="wing-eave" mm={w.eave} unit={u} onCommit={(v) => set({ eave: v })} /></div>
        <div className="field"><label>שיפוע</label><NumField testId="wing-slope" value={w.slopePct} suffix="%" onCommit={(v) => set({ slopePct: v })} /></div>
        <div className="field prof"><label>חתך עמודים</label><ProfilePicker value={w.columnProfile ?? b.columnProfile} families={['HEA', 'HEB', 'IPE', 'RHS', 'SHS']} onCommit={(v) => set({ columnProfile: v })} /></div>
        <div className="field prof"><label>חתך קורות</label><ProfilePicker value={w.rafterProfile ?? b.rafterProfile} families={['IPE', 'HEA', 'HEB', 'RHS']} onCommit={(v) => set({ rafterProfile: v })} /></div>
        {errs.map((e, i) => <div key={i} className="issue error"><span className="ic">✕</span>{e.message}</div>)}
        <div className="hint">אלמנטי הכנף מסומנים W. (למשל W.F2.RAF.L); שינוי חתך לאלמנט בודד עובד כרגיל. חתכי מסגרת לכנף — בשרטוטי המכלולים; תוכנית הגג מציגה את הכנף.</div>
        <button className="btn small" onClick={() => store.exec(setBuilding({ wing: undefined }))} data-testid="wing-remove">הסרת הכנף</button>
      </>}
    </div>
  );
}
