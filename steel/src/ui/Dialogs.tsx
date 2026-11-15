import { useEffect, useState, type ReactNode } from 'react';
import { copyMembers, mirrorMembers, moveMembers, rotateMembers } from '../commands/commands';
import { uniformFrames, defaultBuilding, newProject } from '../model/defaults';
import { fromFileJson, toFileJson } from '../model/migrate';
import type { BuildingParams } from '../model/types';
import { validateBuilding } from '../model/validate';
import { downloadText, pickFile, safeFileName } from '../persist/files';
import { deleteProject, listProjects, listSnapshots, loadProject, loadSnapshot, type ProjectSummary, type SnapshotInfo } from '../persist/idb';
import { store, useStore } from '../store';
import { cachedSolid } from '../view/scene';
import { LenField, NumField, ProfilePicker } from './fields';
import { SECTION_TEMPLATES } from '../model/section';
import { SectionPreview } from './SectionEditor';
import { defaultKneeBraces } from '../geometry/knee';
import { Icon } from './icons';

export function Dialog({ title, onClose, children, footer, wide, testId }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testId?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-label={title} data-testid={testId}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="סגירה"><Icon name="x" /></button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

const GableSvg = () => <svg viewBox="0 0 100 40"><path d="M10 38V18L50 4l40 14v20" fill="none" stroke="currentColor" strokeWidth="2.5" /></svg>;
const MonoSvg = () => <svg viewBox="0 0 100 40"><path d="M10 38V20L90 6v32" fill="none" stroke="currentColor" strokeWidth="2.5" /></svg>;

/** אשף מבנה חדש. ערכי ברירת מחדל = מבנה GEO-01. */
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('פרויקט חדש');
  const [number, setNumber] = useState('');
  const [client, setClient] = useState('');
  const [b, setB] = useState<BuildingParams>(defaultBuilding());
  const [length, setLength] = useState(30000);
  const [count, setCount] = useState(6);
  /** סוג המבנה: gable / mono (קלאסי) או מזהה תבנית מודולרית */
  const [kind, setKind] = useState<string>('gable');
  const [knee, setKnee] = useState(false);
  const u: 'm' = 'm';
  const set = (p: Partial<BuildingParams>) => setB({ ...b, ...p });
  const build = (): BuildingParams | null => {
    if (!(count >= 2 && count <= 200)) return null;
    return { ...b, frames: uniformFrames(Math.round(count), length) };
  };
  const cand = build();
  const issues = cand ? validateBuilding(cand) : [{ code: 'FRAMES', severity: 'error' as const, message: 'מספר מסגרות 2–200' }];
  const errors = issues.filter((i) => i.severity === 'error');
  const tpl = SECTION_TEMPLATES.find((t) => t.id === kind);
  const create = () => {
    if (!cand || errors.length) return;
    const bb: BuildingParams = tpl ? { ...cand, section: tpl.make(), kneeBraces: knee ? { ...defaultKneeBraces(), enabled: true } : undefined } : { ...cand, kneeBraces: knee ? { ...defaultKneeBraces(), enabled: true } : undefined };
    const p = newProject(name, bb);
    p.meta.number = number; p.meta.client = client;
    store.loadProject(p, true);
    void store.saveNow('יצירת פרויקט');
    onClose();
    setTimeout(() => (window as any).__ksp?.viewport?.fitAll(), 50);
  };
  return (
    <Dialog title="פרויקט חדש" onClose={onClose} wide testId="new-dialog"
      footer={<><button className="btn primary" disabled={!!errors.length} onClick={create} data-testid="create">יצירת מבנה</button><button className="btn" onClick={onClose}>ביטול</button></>}>
      <div className="grid2">
        <div>
          <div className="panel-title">פרויקט</div>
          <div className="field wide"><label>שם</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} data-testid="np-name" /></div>
          <div className="field wide"><label>מספר</label><input className="inp" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
          <div className="field wide"><label>לקוח</label><input className="inp" value={client} onChange={(e) => setClient(e.target.value)} /></div>
          <div className="panel-title">סוג מבנה</div>
          <div className="tpl-grid np-types">
            <button className={`tpl${kind === 'gable' ? ' on' : ''}`} onClick={() => { setKind('gable'); set({ roofType: 'gable', eaveRight: b.eaveLeft, ridgeX: b.width / 2, purlins: { ...b.purlins, left: { ...b.purlins.left, first: 300 } } }); }} data-testid="np-gable"><GableSvg /><span>דו־שיפועי (2 צירים)</span></button>
            <button className={`tpl${kind === 'mono' ? ' on' : ''}`} onClick={() => { setKind('mono'); set({ roofType: 'mono', eaveRight: b.eaveLeft + 1000, purlins: { ...b.purlins, left: { ...b.purlins.left, first: 0 } } }); }} data-testid="np-mono"><MonoSvg /><span>חד־שיפועי (2 צירים)</span></button>
            {SECTION_TEMPLATES.filter((t) => t.id !== 'gable-2' && t.id !== 'mono-2').map((t) => (
              <button key={t.id} className={`tpl${kind === t.id ? ' on' : ''}`} title={t.desc} data-testid={`np-${t.id}`} onClick={() => { setKind(t.id); setKnee(true); }}><SectionPreview section={t.make()} small /><span>{t.name}</span></button>
            ))}
          </div>
          <label className="row" style={{ marginTop: 6 }}><input type="checkbox" checked={knee} data-testid="np-knee" onChange={(e) => setKnee(e.target.checked)} />אלכסוני עמוד-קורה (RHS, 45°)</label>
        </div>
        <div>
          <div className="panel-title">ממדים</div>
          {tpl && <div className="sec-prev"><SectionPreview section={tpl.make()} /><div className="hint" style={{ margin: '2px 4px' }}>{tpl.desc}. צירים, גבהים, קונזולות ושיפועים — נערכים אחרי היצירה במבנה ← גיאומטריה (כולל גרירה בתצוגה).</div></div>}
          <div className="field"><label>אורך</label><LenField testId="np-length" mm={length} unit={u} onCommit={setLength} /></div>
          <div className="field"><label>מספר מסגרות</label><NumField testId="np-count" value={count} onCommit={(v) => setCount(Math.round(v))} /></div>
          {!tpl && <>
          <div className="field"><label>רוחב</label><LenField testId="np-width" mm={b.width} unit={u} onCommit={(v) => set(b.roofType === 'gable' ? { width: v, ridgeX: v / 2 } : { width: v })} /></div>
          <div className="field"><label>גובה ציר א (שמאל)</label><LenField testId="np-eaveL" mm={b.eaveLeft} unit={u} onCommit={(v) => set(b.roofType === 'gable' && b.eaveLeft === b.eaveRight ? { eaveLeft: v, eaveRight: v } : { eaveLeft: v })} /></div>
          <div className="field"><label>גובה ציר ב (ימין)</label><LenField testId="np-eaveR" mm={b.eaveRight} unit={u} onCommit={(v) => set({ eaveRight: v })} /></div>
          {b.roofType === 'gable' && <>
            <div className="field"><label>מיקום רכס</label><LenField mm={b.ridgeX} unit={u} onCommit={(v) => set({ ridgeX: v })} /></div>
            <div className="field"><label>שיפוע שמאל</label><NumField testId="np-slope" value={b.slopeLeftPct} suffix="%" onCommit={(v) => set({ slopeLeftPct: v })} /></div>
          </>}
          </>}
          <div className="field prof"><label>חתך עמוד</label><ProfilePicker value={b.columnProfile} families={['HEA', 'HEB', 'HEM', 'IPE', 'RHS', 'SHS']} onCommit={(v) => set({ columnProfile: v })} /></div>
          <div className="field prof"><label>חתך קורה</label><ProfilePicker value={b.rafterProfile} families={['IPE', 'HEA', 'HEB', 'RHS']} onCommit={(v) => set({ rafterProfile: v })} /></div>
        </div>
      </div>
      {issues.map((i, k) => <div key={k} className={`issue ${i.severity}`}><span className="ic">{i.severity === 'error' ? '✕' : '!'}</span>{i.message}</div>)}
      <div className="hint">כל הפרמטרים ניתנים לשינוי לאחר היצירה (לשונית "מבנה"). מרווחים לא אחידים — בטבלת המסגרות.</div>
    </Dialog>
  );
}

export function OpenDialog({ onClose }: { onClose: () => void }) {
  const cur = useStore((s) => s.project.id);
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [snaps, setSnaps] = useState<{ id: string; items: SnapshotInfo[] } | null>(null);
  const refresh = () => listProjects().then(setList).catch((e) => store.toast('error', e.message));
  useEffect(() => { void refresh(); }, []);
  const open = async (id: string) => {
    try { store.loadProject(await loadProject(id)); onClose(); setTimeout(() => (window as any).__ksp?.viewport?.fitAll(), 50); }
    catch (e) {
      store.toast('error', `לא ניתן לפתוח: ${(e as Error).message}. ניתן לשחזר גרסה קודמת.`);
      setSnaps({ id, items: await listSnapshots(id) });
    }
  };
  return (
    <Dialog title="פתיחת פרויקט" onClose={onClose} wide testId="open-dialog"
      footer={<>
        <button className="btn" onClick={async () => {
          const f = await pickFile('.json,.ksp.json,application/json');
          if (!f) return;
          try { const p = fromFileJson(await f.text()); store.loadProject(p, true); await store.saveNow('ייבוא'); store.toast('ok', 'הפרויקט יובא'); onClose(); setTimeout(() => (window as any).__ksp?.viewport?.fitAll(), 50); }
          catch (e) { store.toast('error', (e as Error).message); }
        }}><Icon name="upload" />ייבוא קובץ JSON</button>
        <button className="btn" onClick={onClose}>סגירה</button>
      </>}>
      {!list ? <div className="hint">טוען…</div> : !list.length ? <div className="hint">אין פרויקטים שמורים במחשב זה.</div> : (
        <div className="list">
          {list.map((p) => (
            <div className="list-row" key={p.id}>
              <div style={{ flex: 1 }}>
                <div><b>{p.name}</b> {p.number && <span className="badge">{p.number}</span>} {p.id === cur && <span className="badge blue">פתוח</span>}</div>
                <div className="meta">עודכן {new Date(p.updatedAt).toLocaleString('he-IL')}</div>
              </div>
              <button className="btn small primary" onClick={() => open(p.id)}>פתיחה</button>
              <button className="btn small" onClick={async () => setSnaps({ id: p.id, items: await listSnapshots(p.id) })}><Icon name="history" />גרסאות</button>
              <button className="btn small danger" disabled={p.id === cur} onClick={async () => { if (confirm(`למחוק את "${p.name}" וכל הגרסאות שלו?`)) { await deleteProject(p.id); void refresh(); } }}>מחיקה</button>
            </div>
          ))}
        </div>
      )}
      {snaps && <>
        <div className="panel-title">גרסאות שמורות</div>
        <div className="list">
          {snaps.items.map((s) => (
            <div className="list-row" key={s.key}>
              <div style={{ flex: 1 }}><div>{new Date(s.savedAt).toLocaleString('he-IL')}</div><div className="meta">{s.reason}</div></div>
              <button className="btn small" onClick={async () => {
                try { const p = await loadSnapshot(s.key); store.loadProject(p, true); await store.saveNow('שחזור גרסה'); store.toast('ok', 'הגרסה שוחזרה'); onClose(); }
                catch (e) { store.toast('error', (e as Error).message); }
              }}>שחזור</button>
            </div>
          ))}
        </div>
      </>}
    </Dialog>
  );
}

export function exportProject() {
  const p = store.state.project;
  downloadText(`${safeFileName(p.meta.name)}.ksp.json`, toFileJson(p));
}

export function duplicateProject() {
  const p = structuredClone(store.state.project);
  const np = newProject(`${p.meta.name} (העתק)`, p.building);
  const dup = { ...p, id: np.id, meta: { ...p.meta, name: np.meta.name, createdAt: np.meta.createdAt, updatedAt: np.meta.updatedAt } };
  store.loadProject(dup, true);
  void store.saveNow('שכפול');
  store.toast('ok', 'נוצר עותק של הפרויקט');
}

type XMode = 'move' | 'copy' | 'rotate' | 'mirror';
const XTITLE: Record<XMode, string> = { move: 'הזזה', copy: 'העתקה', rotate: 'סיבוב סביב Z', mirror: 'שיקוף' };

export function selectionCenter() {
  const s = store.state;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const id of s.selection) {
    const m = s.derived.byId.get(id);
    if (!m) continue;
    for (const q of [...cachedSolid(m).startRing, ...cachedSolid(m).endRing]) {
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z);
    }
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 };
}

/** פקודות עריכה מדויקות עם ערכים מספריים — משנות את המודל, לא רק את התצוגה. */
export function TransformDialog({ mode, onClose }: { mode: XMode; onClose: () => void }) {
  const sel = useStore((s) => s.selection);
  const u = useStore((s) => s.project.displayUnit);
  const W = useStore((s) => s.project.building.width);
  const c = selectionCenter();
  const [dx, setDx] = useState(0); const [dy, setDy] = useState(mode === 'copy' ? 6000 : 0); const [dz, setDz] = useState(0);
  const [count, setCount] = useState(1);
  const [ang, setAng] = useState(90);
  const [cx, setCx] = useState(Math.round(c.x)); const [cy, setCy] = useState(Math.round(c.y));
  const [axis, setAxis] = useState<'X' | 'Y'>('X');
  const [pos, setPos] = useState(W / 2);
  const run = () => {
    const ok = mode === 'move' ? store.exec(moveMembers(sel, { x: dx, y: dy, z: dz }))
      : mode === 'copy' ? store.exec(copyMembers(sel, { x: dx, y: dy, z: dz }, count))
        : mode === 'rotate' ? store.exec(rotateMembers(sel, ang, { x: cx, y: cy, z: 0 }))
          : store.exec(mirrorMembers(sel, axis, pos));
    if (ok) { store.toast('ok', `${XTITLE[mode]}: ${sel.length} אלמנטים`); onClose(); }
  };
  return (
    <Dialog title={`${XTITLE[mode]} (${sel.length} אלמנטים)`} onClose={onClose} testId="xform-dialog"
      footer={<><button className="btn primary" onClick={run} disabled={!sel.length} data-testid="xform-ok">ביצוע</button><button className="btn" onClick={onClose}>ביטול</button></>}>
      {(mode === 'move' || mode === 'copy') && <>
        <div className="field"><label>ΔX</label><LenField testId="dx" mm={dx} unit={u} onCommit={setDx} /></div>
        <div className="field"><label>ΔY</label><LenField testId="dy" mm={dy} unit={u} onCommit={setDy} /></div>
        <div className="field"><label>ΔZ</label><LenField testId="dz" mm={dz} unit={u} onCommit={setDz} /></div>
        {mode === 'copy' && <div className="field"><label>מספר העתקים</label><NumField value={count} onCommit={(v) => setCount(Math.round(v))} /></div>}
      </>}
      {mode === 'rotate' && <>
        <div className="field"><label>זווית</label><NumField value={ang} suffix="°" onCommit={setAng} /></div>
        <div className="field"><label>מרכז X</label><LenField mm={cx} unit={u} onCommit={setCx} /></div>
        <div className="field"><label>מרכז Y</label><LenField mm={cy} unit={u} onCommit={setCy} /></div>
      </>}
      {mode === 'mirror' && <>
        <div className="field"><label>מישור שיקוף</label>
          <select className="inp" value={axis} onChange={(e) => { const a = e.target.value as 'X' | 'Y'; setAxis(a); setPos(a === 'X' ? W / 2 : Math.round(c.y)); }}>
            <option value="X">X = קבוע (שמאל ↔ ימין)</option><option value="Y">Y = קבוע (קדימה ↔ אחורה)</option>
          </select>
        </div>
        <div className="field"><label>מיקום המישור</label><LenField mm={pos} unit={u} onCommit={setPos} /></div>
      </>}
      <div className="hint">אלמנט פרמטרי שמוזז מקבל מיקום ידני ומסומן; שינוי פרמטרי מאוחר יותר יסמן את ההתאמה כלא תקפה. העתקה יוצרת אלמנטים ידניים חדשים.</div>
    </Dialog>
  );
}
