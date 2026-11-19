import { applyStandard } from '../persist/shopStandard';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { copyMembers, mirrorMembers, moveMembers, rotateMembers } from '../commands/commands';
import { uniformFrames, defaultBuilding, newProject } from '../model/defaults';
import { fromFileJson } from '../model/migrate';
import type { BuildingParams, WingDef } from '../model/types';
import { validateBuilding } from '../model/validate';
import { pickFile } from '../persist/files';
import { deleteProject, listProjects, listSnapshots, loadProject, loadSnapshot, type ProjectSummary, type SnapshotInfo } from '../persist/idb';
import { store, useStore } from '../store';
import { cachedSolid } from '../view/scene';
import { LenField, NumField, ProfilePicker } from './fields';
import { SECTION_TEMPLATES, toCustomSection } from '../model/section';
import { generate } from '../geometry/generate';
import { massPerMeter, tryProfile } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import { SectionPreview } from './SectionEditor';
import { ClassicRoofDims } from './TriDims';
import { defaultKneeBraces } from '../geometry/knee';
import { applySizingSuggestion } from '../commands/commands';
import { backupDownload } from '../persist/fileLink';
import { defaultCladding } from '../geometry/cladding';
import { defaultWing } from '../geometry/wing';
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
export const LSvg = ({ gable }: { gable?: boolean }) => <svg viewBox="0 0 100 40"><path d={gable ? 'M8 38V20L30 10l22 10v18M52 26l20-6 20 6v12H52z' : 'M8 38V18L52 12v26M52 24l40 4v10H52z'} fill="none" stroke="currentColor" strokeWidth="2.5" /></svg>;
const MonoSvg = () => <svg viewBox="0 0 100 40"><path d="M10 38V20L90 6v32" fill="none" stroke="currentColor" strokeWidth="2.5" /></svg>;

/** אשף מבנה חדש. ערכי ברירת מחדל = מבנה GEO-01. */
const WZ_STEPS = ['סוג מבנה', 'מידות', 'חתכים', 'גג ופטות', 'חיזוקים', 'חיפוי וסיכום'];
const CLEATS: [NonNullable<CleatStyle>, string, string][] = [['run', 'זוויתן שוכב', 'L לאורך הפטה'], ['stand', 'זוויתן עומד', 'L40×40 · 2 חורים'], ['plate', 'פלטה + משולש', 'גם בתפר — 4 חורים']];
type CleatStyle = 'run' | 'stand' | 'plate' | undefined;

/** תוכנית מבט-על: צירים לרוחב, מסגרות לאורך */
function PlanPreview({ width, frames, wing }: { width: number; frames: { y: number; id?: string }[]; wing?: WingDef }) {
  const L = frames.length ? frames[frames.length - 1]!.y : 1;
  const wl = wing ? wing.length : 0;
  const k = Math.min(260 / Math.max(L, 1), 120 / Math.max(width + wl, 1));
  const w = width * k, h = L * k;
  const fi = wing ? frames.findIndex((f) => f.id === wing.fromFrame) : -1;
  const wy0 = fi >= 0 ? frames[fi]!.y * k : 0, wy1 = fi >= 0 ? frames[Math.min(frames.length - 1, fi + wing!.bays)]!.y * k : 0;
  return (
    <svg viewBox={`-10 -10 ${h + 20} ${w + wl * k + 20}`} className="wz-plan" role="img" aria-label="תוכנית מסגרות">
      {wing && fi >= 0 && <rect x={wy0} y={w} width={wy1 - wy0} height={wl * k} fill="currentColor" opacity={0.15} stroke="currentColor" />}
      <rect x={0} y={0} width={h} height={w} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.5} />
      {frames.map((f, i) => <g key={i}><line x1={f.y * k} y1={0} x2={f.y * k} y2={w} stroke="currentColor" strokeWidth={1.6} /><rect x={f.y * k - 2.5} y={-2.5} width={5} height={5} /><rect x={f.y * k - 2.5} y={w - 2.5} width={5} height={5} /></g>)}
    </svg>
  );
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('פרויקט חדש');
  const [number, setNumber] = useState('');
  const [client, setClient] = useState('');
  const [b, setB] = useState<BuildingParams>(defaultBuilding());
  const [length, setLength] = useState(30000);
  const [count, setCount] = useState(6);
  /** סוג המבנה: gable / mono (קלאסי) או מזהה תבנית מודולרית */
  const [kind, setKind] = useState<string>('gable');
  /** סככת L: כנף דו/חד-שיפועית */
  const [lWing, setLWing] = useState<null | 'gable' | 'mono'>(null);
  const [knee, setKnee] = useState(false);
  const [autoSize, setAutoSize] = useState(true);
  const [clad, setClad] = useState(true);
  const [cladWalls, setCladWalls] = useState(true);
  const u: 'm' = 'm';
  const set = (p: Partial<BuildingParams>) => setB({ ...b, ...p });
  const setPurl = (f: (s: BuildingParams['purlins']['left']) => void) => {
    const pu = structuredClone(b.purlins); f(pu.left); f(pu.right); set({ purlins: pu });
  };
  const build = (): BuildingParams | null => {
    if (!(count >= 2 && count <= 200)) return null;
    return { ...b, frames: uniformFrames(Math.round(count), length) };
  };
  const cand = build();
  const issues = cand ? validateBuilding(cand) : [{ code: 'FRAMES', severity: 'error' as const, message: 'מספר מסגרות 2–200' }];
  const errors = issues.filter((i) => i.severity === 'error');
  const tpl = SECTION_TEMPLATES.find((t) => t.id === kind);
  const make = (): BuildingParams | null => {
    if (!cand || errors.length) return null;
    const bb: BuildingParams = { ...cand, ...(tpl ? { section: tpl.make() } : {}), kneeBraces: knee ? { ...defaultKneeBraces(), enabled: true } : undefined };
    if (lWing && !tpl) bb.wing = defaultWing(bb, lWing);
    if (clad) { bb.cladding = defaultCladding(); if (!cladWalls) { bb.cladding.walls.enabled = false; bb.cladding.girts.enabled = false; bb.cladding.posts.enabled = false; } }
    return bb;
  };
  // תצוגה חיה: יצירת המודל מהבחירות הנוכחיות (בלי התאמת חתכים — זו רצה ביצירה)
  const key = JSON.stringify([b, length, count, kind, knee, clad, cladWalls, lWing]);
  const live = useMemo(() => {
    const bb = make();
    if (!bb) return null;
    try {
      const d = generate(newProject(name, bb));
      let kg = 0;
      for (const x of d.parts) { const pr = tryProfile(x.profile); if (pr) kg += (massPerMeter(pr, getMaterial(x.material).density) * x.length) / 1000; }
      return { members: d.members.length, conns: d.connections.length, err: d.issues.filter((i) => i.severity === 'error').length, warn: d.issues.filter((i) => i.severity === 'warning').length, kg, sec: bb.section ?? toCustomSection(bb, d.roof) };
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const create = () => {
    const bb = make();
    if (!bb) return;
    let p = applyStandard(newProject(name, bb)); // סטנדרט מסגריה שמור (אם קיים)
    p.meta.number = number; p.meta.client = client;
    if (autoSize) { try { p = applySizingSuggestion().run(p); } catch { /* נשאר עם החתכים שנבחרו */ } }
    store.loadProject(p, true);
    void store.saveNow('יצירת פרויקט');
    onClose();
    setTimeout(() => (window as any).__ksp?.viewport?.fitAll(), 50);
  };
  const bay = count > 1 ? length / (count - 1) : 0;
  const card = (on: boolean, onClick: () => void, title: string, sub: string, testId?: string, pic?: ReactNode) => (
    <button className={`tpl wz-card${on ? ' on' : ''}`} onClick={onClick} data-testid={testId} aria-pressed={on}>{pic}<span><b>{title}</b><small>{sub}</small></span></button>
  );
  const style = b.purlins.left.cleat.style ?? 'run';
  return (
    <Dialog title="פרויקט חדש" onClose={onClose} wide testId="new-dialog"
      footer={<>
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="wz-prev">→ הקודם</button>
        {step < WZ_STEPS.length - 1 && <button className="btn" onClick={() => setStep(step + 1)} data-testid="wz-next">הבא ←</button>}
        <button className="btn primary" disabled={!!errors.length} onClick={create} data-testid="create" title="אפשר ליצור מכל שלב — השאר נשאר בברירת המחדל">יצירת מבנה</button>
        <button className="btn" onClick={onClose}>ביטול</button>
      </>}>
      <div className="wz">
        <nav className="wz-steps" aria-label="שלבי האשף">
          {WZ_STEPS.map((t, i) => (
            <button key={t} className={`${i === step ? 'on' : ''}${i < step ? ' done' : ''}`} onClick={() => setStep(i)} data-testid={`wz-step-${i}`}>
              <span className="k">{i < step ? '✓' : i + 1}</span>{t}
            </button>
          ))}
          <div className="hint" style={{ marginTop: 'auto' }}>אפשר לקפוץ בין השלבים וליצור מכל שלב. הכל ניתן לשינוי אחר כך.</div>
        </nav>
        <section className="wz-form">
          {step === 0 && <>
            <div className="panel-title">פרויקט</div>
            <div className="field wide"><label>שם</label><input className="inp" value={name} onChange={(e) => setName(e.target.value)} data-testid="np-name" /></div>
            <div className="field wide"><label>מספר</label><input className="inp" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
            <div className="field wide"><label>לקוח</label><input className="inp" value={client} onChange={(e) => setClient(e.target.value)} /></div>
            <div className="panel-title">סוג מבנה</div>
            <div className="tpl-grid np-types">
              <button className={`tpl${kind === 'gable' && !lWing ? ' on' : ''}`} onClick={() => { setLWing(null); setKind('gable'); set({ roofType: 'gable', eaveRight: b.eaveLeft, ridgeX: b.width / 2, purlins: { ...b.purlins, left: { ...b.purlins.left, first: 300 } } }); }} data-testid="np-gable"><GableSvg /><span>דו־שיפועי (2 צירים)</span></button>
              <button className={`tpl${kind === 'mono' && !lWing ? ' on' : ''}`} onClick={() => { setLWing(null); setKind('mono'); set({ roofType: 'mono', eaveRight: b.eaveLeft + 1000, purlins: { ...b.purlins, left: { ...b.purlins.left, first: 0 } } }); }} data-testid="np-mono"><MonoSvg /><span>חד־שיפועי (2 צירים)</span></button>
              <button className={`tpl${lWing === 'gable' ? ' on' : ''}`} title="סככה דו-שיפועית + כנף דו-שיפועית ניצבת (רכס ניצב)" data-testid="np-L-gable" onClick={() => { setLWing('gable'); setKind('gable'); set({ roofType: 'gable', eaveRight: b.eaveLeft, ridgeX: b.width / 2, purlins: { ...b.purlins, left: { ...b.purlins.left, first: 300 } } }); }}><LSvg gable /><span>צורת L — דו-שיפועי</span></button>
              <button className={`tpl${lWing === 'mono' ? ' on' : ''}`} title="סככה חד-שיפועית + כנף חד-שיפועית נשענת על הצד הגבוה" data-testid="np-L-mono" onClick={() => { setLWing('mono'); setKind('mono'); set({ roofType: 'mono', eaveRight: b.eaveLeft + 1000, purlins: { ...b.purlins, left: { ...b.purlins.left, first: 0 } } }); }}><LSvg /><span>צורת L — חד-שיפועי</span></button>
              {SECTION_TEMPLATES.filter((t) => t.id !== 'gable-2' && t.id !== 'mono-2').map((t) => (
                <button key={t.id} className={`tpl${kind === t.id ? ' on' : ''}`} title={t.desc} data-testid={`np-${t.id}`} onClick={() => { setLWing(null); setKind(t.id); setKnee(true); }}><SectionPreview section={t.make()} small /><span>{t.name}</span></button>
              ))}
            </div>
          </>}
          {step === 1 && <>
            <div className="panel-title">מידות</div>
            <div className="field"><label>אורך</label><LenField testId="np-length" mm={length} unit={u} onCommit={setLength} /></div>
            <div className="field"><label>מספר מסגרות</label><NumField testId="np-count" value={count} onCommit={(v) => setCount(Math.round(v))} /></div>
            <div className="field"><label>מרווח מסגרות</label><LenField testId="np-bay" mm={bay} unit={u} onCommit={(v) => { if (v > 0) setCount(Math.max(2, Math.round(length / v) + 1)); }} /></div>
            {tpl ? <div className="hint">{tpl.desc}. צירים, גבהים, קונזולות ושיפועים של תבנית — נערכים אחרי היצירה במבנה ← צירים, מסגרות וגבהים (כולל גרירה בתצוגה), או בגיליון הפרמטרים.</div> : <>
              <div className="field"><label>רוחב</label><LenField testId="np-width" mm={b.width} unit={u} onCommit={(v) => set(b.roofType === 'gable' ? { width: v, ridgeX: v / 2 } : { width: v })} /></div>
              {b.roofType === 'gable' && <div className="field"><label>מיקום רכס מציר א</label><LenField testId="np-ridgeX" mm={b.ridgeX} unit={u} onCommit={(v) => set({ ridgeX: v })} /></div>}
              <ClassicRoofDims b={b} unit={u} set={set} testId="np-tri" ids={{ col: 'np-eaveL', top: b.roofType === 'gable' ? 'np-ridge' : 'np-eaveR', slope: 'np-slope', right: 'np-eaveR' }} />
            </>}
            <div className="hint">מרווחים לא אחידים ומפלס תחתית שונה לכל ציר — אחרי היצירה, בטבלת הצירים והמסגרות.</div>
          </>}
          {step === 2 && <>
            <div className="panel-title">חתכים</div>
            <div className="field prof"><label>חתך עמוד</label><ProfilePicker value={b.columnProfile} families={['HEA', 'HEB', 'HEM', 'IPE', 'RHS', 'SHS']} onCommit={(v) => set({ columnProfile: v })} /></div>
            <div className="field prof"><label>חתך קורה</label><ProfilePicker value={b.rafterProfile} families={['IPE', 'HEA', 'HEB', 'RHS']} onCommit={(v) => set({ rafterProfile: v })} /></div>
            <label className="row" style={{ marginTop: 8 }} title="הקטן ביותר שמסומן 'סביר' בבדיקת הגדלים, באותה משפחת פרופיל; כולל התאמת פלטות ראש עמוד ובסיס. הערכה בלבד — לא תכן."><input type="checkbox" checked={autoSize} data-testid="np-autosize" onChange={(e) => setAutoSize(e.target.checked)} />התאמת חתכים לפי כללי אצבע (עמודים, קורות, פטות, קושרות)</label>
            <div className="hint">עם ההתאמה מסומנת — החתכים שכאן הם נקודת התחלה בלבד; ההתאמה רצה ביצירה. הערכה בלבד, לא תכן מאושר.</div>
          </>}
          {step === 3 && <>
            <div className="panel-title">פטות</div>
            <div className="field prof"><label>חתך פטה</label><ProfilePicker value={b.purlins.left.profile} families={['C', 'Z', 'RHS']} onCommit={(v) => setPurl((s) => { s.profile = v; })} testId="np-purlin" /></div>
            <div className="field"><label>מרווח פטות</label><LenField testId="np-pspacing" mm={b.purlins.left.spacing} unit={u} onCommit={(v) => setPurl((s) => { s.spacing = v; })} /></div>
            <div className="field"><label>חלוקה</label><select className="inp" value={b.purlins.left.layout ?? 'fixed'} onChange={(e) => setPurl((s) => { s.layout = e.target.value as 'fixed' | 'even'; })}><option value="fixed">מרווח קבוע — שארית במפתח האחרון</option><option value="even">חלוקה שווה — המרווח הוא מרבי</option></select></div>
            <div className="panel-title">תושבת פטה</div>
            <div className="wz-cards">
              {CLEATS.map(([k, t, sub]) => card(style === k, () => setPurl((s) => { s.cleat.style = k; }), t, sub, `np-cleat-${k}`))}
            </div>
          </>}
          {step === 4 && <>
            <div className="panel-title">חיזוקים</div>
            <div className="wz-cards">
              {card(knee, () => setKnee(!knee), 'אלכסוני עמוד-קורה', knee ? 'פעיל · RHS · 45°' : 'כבוי', 'np-knee-card')}
              {card(b.bracing.roof.enabled, () => set({ bracing: { ...b.bracing, roof: { ...b.bracing.roof, enabled: !b.bracing.roof.enabled } } }), 'קושרות גג', b.bracing.roof.enabled ? 'X במפתחי הקצה' : 'כבוי', 'np-roofx')}
              {card(b.bracing.walls.enabled, () => set({ bracing: { ...b.bracing, walls: { ...b.bracing.walls, enabled: !b.bracing.walls.enabled } } }), 'קשיחות קירות', b.bracing.walls.enabled ? 'X במפתחי הקצה' : 'כבוי', 'np-wallx')}
            </div>
            <label className="row" style={{ marginTop: 6 }}><input type="checkbox" checked={knee} data-testid="np-knee" onChange={(e) => setKnee(e.target.checked)} />אלכסוני עמוד-קורה (RHS, 45°)</label>
            <div className="hint">לחיצה מפעילה/מכבה. מפתחים, חתכים ופרטים — במסך העבודה (3 · חיזוקים).</div>
          </>}
          {step === 5 && <>
            <div className="panel-title">חיפוי</div>
            <div className="wz-cards">
              {card(!clad, () => setClad(false), 'ללא חיפוי', 'סככה פתוחה', 'np-clad-none')}
              {card(clad && !cladWalls, () => { setClad(true); setCladWalls(false); }, 'גג בלבד', 'פח + מזחלות', 'np-clad-roof')}
              {card(clad && cladWalls, () => { setClad(true); setCladWalls(true); }, 'גג וקירות', 'פטות קיר + עמודי רוח', 'np-clad-walls')}
            </div>
            <label className="row" style={{ marginTop: 4 }}><input type="checkbox" checked={clad} data-testid="np-clad" onChange={(e) => setClad(e.target.checked)} />חיפוי (גג{cladWalls ? ' וקירות' : ''})</label>
            <div className="panel-title">סיכום</div>
            <div className="wz-sum" data-testid="wz-summary">
              <span>{tpl ? tpl.name : kind === 'mono' ? 'חד־שיפועי' : 'דו־שיפועי'}{lWing ? ` + כנף ${lWing === 'gable' ? 'דו-שיפועית' : 'חד-שיפועית'} (צורת L)` : ''}</span>
              {!tpl && <span>{(b.width / 1000).toFixed(2)} × {(length / 1000).toFixed(2)} מ'</span>}
              <span>{count} מסגרות · מרווח {(bay / 1000).toFixed(2)} מ'</span>
              {!tpl && <span>גובה {(b.eaveLeft / 1000).toFixed(2)}{b.eaveRight !== b.eaveLeft ? `/${(b.eaveRight / 1000).toFixed(2)}` : ''} מ'{b.roofType === 'gable' ? ` · ${b.slopeLeftPct}%` : ''}</span>}
              <span>{b.columnProfile} / {b.rafterProfile}{autoSize ? ' (יותאמו)' : ''}</span>
              <span>פטות {b.purlins.left.profile}{autoSize ? ' (יותאם)' : ''} @ {(b.purlins.left.spacing / 1000).toFixed(2)} · {CLEATS.find(([k]) => k === style)?.[1]}</span>
              <span>{[knee && 'אלכסונים', b.bracing.roof.enabled && 'קושרות גג', b.bracing.walls.enabled && 'קשיחות קירות'].filter(Boolean).join(' · ') || 'ללא חיזוקים'}</span>
              <span>{!clad ? 'ללא חיפוי' : cladWalls ? 'חיפוי גג וקירות' : 'חיפוי גג'}</span>
            </div>
          </>}
          {issues.map((i, k) => <div key={k} className={`issue ${i.severity}`}><span className="ic">{i.severity === 'error' ? '✕' : '!'}</span>{i.message}</div>)}
        </section>
        <section className="wz-view" data-testid="wz-view">
          {live?.sec && <SectionPreview section={live.sec} />}
          <PlanPreview wing={lWing && !tpl && cand ? defaultWing({ ...b, frames: cand.frames }, lWing) : undefined} width={tpl ? (live?.sec ? Math.max(...live.sec.lines.map((l) => l.x)) - Math.min(...live.sec.lines.map((l) => l.x)) : b.width) : b.width} frames={cand?.frames ?? []} />
          {live ? (
            <div className="wz-stat">
              <span>{live.members} אלמנטים</span><span>{live.conns} חיבורים</span>
              <span>~{Math.round(live.kg / 100) * 100} ק"ג{autoSize ? ' (לפני התאמה)' : ''}</span>
              <span className={`badge ${live.err ? 'err' : live.warn ? 'warn' : 'ok'}`} data-testid="wz-check">{live.err ? `${live.err} שגיאות` : live.warn ? `${live.warn} אזהרות` : '✓ ללא שגיאות'}</span>
            </div>
          ) : <div className="hint">יש לתקן את השגיאות כדי לראות תצוגה.</div>}
        </section>
      </div>
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
  backupDownload(store.state.project);
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
