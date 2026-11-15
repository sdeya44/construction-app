import { useEffect, useRef, useState } from 'react';
import { deleteMembers, restoreDeleted } from '../commands/commands';
import { fromMm } from '../core/units';
import { store, useStore, type ViewName } from '../store';
import { VIEW_LABEL, Viewport } from '../view/viewport';
import { duplicateProject, exportProject, NewProjectDialog, OpenDialog, TransformDialog } from './Dialogs';
import { Icon } from './icons';
import { PropertiesPanel } from './PropertiesPanel';
import { RoofPanel } from './RoofPanel';
import { ProfileDatalist, StructurePanel } from './StructurePanel';
import { IssuesPanel, TreePanel } from './TreePanel';
import { DrawingsView } from './DrawingsView';
import { CatalogDialog } from './CatalogDialog';
import { ProductionView } from './ProductionView';

type DialogKind = null | 'new' | 'open' | 'move' | 'copy' | 'rotate' | 'mirror' | 'catalog';
type SideTab = 'structure' | 'roof' | 'tree' | 'issues';
type MobileTab = null | 'side' | 'props';

function TB({ icon, label, on, onClick, disabled, testId, title, desk }: { icon: string; label?: string; on?: boolean; onClick: () => void; disabled?: boolean; testId?: string; title?: string; desk?: boolean }) {
  return (
    <button className={`tbtn${on ? ' on' : ''}${desk ? ' desk-only' : ''}`} onClick={onClick} disabled={disabled} data-testid={testId} title={title ?? label} aria-pressed={on}>
      <Icon name={icon} />{label && <span>{label}</span>}
    </button>
  );
}

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [tab, setTab] = useState<SideTab>('structure');
  const [mtab, setMtab] = useState<MobileTab>(null);
  const [mode, setMode] = useState<'model' | 'drawings' | 'production'>('model');
  const s = useStore((x) => x);
  const sel = s.selection;
  const v = s.view;
  const errs = s.derived.issues.filter((i) => i.severity === 'error').length;
  const warns = s.derived.issues.filter((i) => i.severity === 'warning').length;

  useEffect(() => {
    if (!host.current) return;
    const viewport = new Viewport(host.current);
    vp.current = viewport;
    window.__ksp = { store, viewport };
    return () => viewport.dispose();
  }, []);

  // קיצורי מקשים
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (dialog) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
      else if (mod && k === 's') { e.preventDefault(); void store.saveNow('שמירה ידנית').then((ok) => ok && store.toast('ok', 'נשמר')); }
      else if (mod && k === 'a') { e.preventDefault(); store.select(store.state.derived.members.map((m) => m.id)); }
      else if (k === 'delete') { if (store.state.selection.length) store.exec(deleteMembers(store.state.selection)); }
      else if (k === 'escape') { store.select([]); store.set({ tool: 'select', measure: {} }); }
      else if (k === 'f') vp.current?.fitAll();
      else if (k === 'z' && !mod) vp.current?.fitSelection();
      else if (k === 'm') store.set({ tool: store.state.tool === 'measure' ? 'select' : 'measure', measure: {} });
      else if (k === 'h') hide();
      else if (k === 'i') isolate();
      else if (k === 'u') showAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  const setView = (name: ViewName) => vp.current?.fitAll(name);
  const hide = () => { if (store.state.selection.length) store.set({ hidden: [...new Set([...store.state.hidden, ...store.state.selection])], selection: [] }); };
  const isolate = () => { if (store.state.selection.length) store.set({ isolated: [...store.state.selection] }); };
  const showAll = () => store.set({ hidden: [], isolated: null });
  const u = s.project.displayUnit;
  const m = s.measure;
  const mdist = m.a && m.b ? { d: Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y, m.b.z - m.a.z), dx: m.b.x - m.a.x, dy: m.b.y - m.a.y, dz: m.b.z - m.a.z } : null;
  const fmt = (mm: number) => (u === 'm' ? `${fromMm(mm, 'm').toFixed(3)} מ'` : `${mm.toFixed(1)} מ"מ`);
  const saveText = { saved: 'נשמר במחשב', dirty: 'שינויים לא שמורים', saving: 'שומר…', error: 'שגיאת שמירה' }[s.saveState];
  const sideOpen = mtab === 'side', propsOpen = mtab === 'props';

  return (
    <div className="app" style={mode !== 'model' ? { gridTemplateRows: 'auto 1fr auto auto' } : undefined}>
      <ProfileDatalist />
      <header className="topbar">
        <div className="brand"><img src="./icon.svg" alt="" /><span className="desk-only">KAYAN STEEL PRO</span> <small className="desk-only">1.1</small></div>
        <div className="proj-name" data-testid="proj-name">{s.project.meta.name}</div>
        <div className="modes" role="tablist">
          <button className={mode === 'model' ? 'on' : ''} onClick={() => setMode('model')} data-testid="mode-model">מודל</button>
          <button className={mode === 'drawings' ? 'on' : ''} onClick={() => setMode('drawings')} data-testid="mode-drawings">שרטוטים</button>
          <button className={mode === 'production' ? 'on' : ''} onClick={() => setMode('production')} data-testid="mode-production">ייצור</button>
        </div>
        {s.project.revision.locked && <span className="badge warn" data-testid="locked-badge">מהדורה {s.project.revision.current} נעולה</span>}
        <div className="spacer" />
        <button className="tb-btn desk-only" onClick={() => setDialog('new')} data-testid="btn-new"><Icon name="file" />חדש</button>
        <button className="tb-btn" onClick={() => setDialog('open')} data-testid="btn-open"><Icon name="folder" /><span className="desk-only">פתיחה</span></button>
        <button className="tb-btn desk-only" onClick={() => void store.saveNow('שמירה ידנית').then((ok) => ok && store.toast('ok', 'נשמר'))} data-testid="btn-save"><Icon name="save" />שמירה</button>
        <button className="tb-btn desk-only" onClick={duplicateProject}><Icon name="copy" />שמירה בשם</button>
        <button className="tb-btn desk-only" onClick={exportProject} data-testid="btn-export"><Icon name="download" />ייצוא</button>
        <button className="tb-btn desk-only" onClick={() => setDialog('catalog')} data-testid="btn-catalog"><Icon name="tree" />חתכים</button>
        <button className="tb-btn" onClick={() => store.undo()} disabled={!s.canUndo} title={s.undoLabel ? `ביטול: ${s.undoLabel}` : 'ביטול'} data-testid="btn-undo"><Icon name="undo" /></button>
        <button className="tb-btn" onClick={() => store.redo()} disabled={!s.canRedo} title={s.redoLabel ? `חזרה: ${s.redoLabel}` : 'חזרה'} data-testid="btn-redo"><Icon name="redo" /></button>
        <span className={`save-state ${s.saveState} desk-only`} data-testid="save-state">{saveText}</span>
      </header>

      <div className="toolbar" role="toolbar" style={mode !== 'model' ? { display: 'none' } : undefined}>
        <div className="tgroup">
          <span className="tgroup-label desk-only">כלים</span>
          <TB icon="select" label="בחירה" on={s.tool === 'select'} onClick={() => store.set({ tool: 'select', measure: {} })} testId="tool-select" />
          <TB icon="measure" label="מדידה" on={s.tool === 'measure'} onClick={() => store.set({ tool: s.tool === 'measure' ? 'select' : 'measure', measure: {} })} testId="tool-measure" />
        </div>
        <div className="tgroup desk-only">
          <span className="tgroup-label">עריכה</span>
          <TB icon="move" label="הזזה" disabled={!sel.length} onClick={() => setDialog('move')} testId="tool-move" />
          <TB icon="copy" label="העתקה" disabled={!sel.length} onClick={() => setDialog('copy')} testId="tool-copy" />
          <TB icon="rotate" title="סיבוב" disabled={!sel.length} onClick={() => setDialog('rotate')} testId="tool-rotate" />
          <TB icon="mirror" title="שיקוף" disabled={!sel.length} onClick={() => setDialog('mirror')} testId="tool-mirror" />
          <TB icon="trash" title="מחיקה (Delete)" disabled={!sel.length} onClick={() => store.exec(deleteMembers(sel))} testId="tool-delete" />
          {s.project.deleted.length > 0 && <TB icon="history" label={`שחזור (${s.project.deleted.length})`} onClick={() => store.exec(restoreDeleted())} />}
        </div>
        <div className="tgroup">
          <span className="tgroup-label desk-only">מבט</span>
          <div className="seg">
            {(['iso', 'front', 'right', 'top', 'left', 'back'] as ViewName[]).map((n) => (
              <button key={n} className={`tbtn${n === 'left' || n === 'back' ? ' desk-only' : ''}`} onClick={() => setView(n)} data-testid={`view-${n}`}>{VIEW_LABEL[n]}</button>
            ))}
          </div>
          <TB icon="fit" title="התאמה למסך (F)" onClick={() => vp.current?.fitAll()} testId="fit" />
          <TB icon="zoomSel" title="התמקדות בבחירה (Z)" disabled={!sel.length} onClick={() => vp.current?.fitSelection()} />
        </div>
        <div className="tgroup">
          <span className="tgroup-label desk-only">תצוגה</span>
          <div className="seg">
            <button className={`tbtn${v.projection === 'persp' ? ' on' : ''}`} onClick={() => store.setView({ projection: 'persp' })} data-testid="proj-persp">פרספקטיבה</button>
            <button className={`tbtn${v.projection === 'ortho' ? ' on' : ''}`} onClick={() => store.setView({ projection: 'ortho' })} data-testid="proj-ortho">אורתו</button>
          </div>
          <TB icon={v.render === 'solid' ? 'solid' : 'wire'} title={v.render === 'solid' ? 'מוצק (מעבר לקווי מתאר)' : 'קווי מתאר (מעבר למוצק)'} on={v.render === 'wire'} onClick={() => store.setView({ render: v.render === 'solid' ? 'wire' : 'solid' })} testId="render-mode" />
          <TB icon="grid" title="רשת צירים" on={v.grid} onClick={() => store.setView({ grid: !v.grid })} />
          <TB icon="dims" title="מידות" on={v.dims} onClick={() => store.setView({ dims: !v.dims })} testId="toggle-dims" />
          <TB icon="tag" title="תוויות בחירה" on={v.labels} onClick={() => store.setView({ labels: !v.labels })} desk />
          <TB icon="clip" title="חתך מישורי" on={v.clip.enabled} onClick={() => store.setView({ clip: { ...v.clip, enabled: !v.clip.enabled } })} testId="toggle-clip" />
          <TB icon="split" title="ארבעה מבטים" on={v.split} onClick={() => store.setView({ split: !v.split })} testId="toggle-split" desk />
        </div>
        <div className="tgroup">
          <span className="tgroup-label desk-only">הסתרה</span>
          <TB icon="eyeOff" title="הסתר בחירה (H)" disabled={!sel.length} onClick={hide} testId="hide" />
          <TB icon="isolate" title="בודד בחירה (I)" disabled={!sel.length} onClick={isolate} testId="isolate" />
          <TB icon="showAll" title="הצג הכל (U)" disabled={!s.hidden.length && !s.isolated} onClick={showAll} testId="show-all" />
        </div>
      </div>

      {mode === 'drawings' && <main className="mode-area"><DrawingsView /></main>}
      {mode === 'production' && <main className="mode-area"><ProductionView /></main>}
      <main className="workspace" style={mode !== 'model' ? { display: 'none' } : undefined}>
        <aside className={`side side-start${sideOpen ? ' open' : ''}`}>
          <div className="tabs">
            <button className={`tab${tab === 'structure' ? ' on' : ''}`} onClick={() => setTab('structure')} data-testid="tab-structure">מבנה</button>
            <button className={`tab${tab === 'roof' ? ' on' : ''}`} onClick={() => setTab('roof')} data-testid="tab-roof">גג ופטות</button>
            <button className={`tab${tab === 'tree' ? ' on' : ''}`} onClick={() => setTab('tree')} data-testid="tab-tree">אלמנטים</button>
            <button className={`tab${tab === 'issues' ? ' on' : ''}`} onClick={() => setTab('issues')} data-testid="tab-issues">
              בעיות {(errs + warns) > 0 && <span className={`count ${errs ? 'err' : 'warn'}`}>{errs + warns}</span>}
            </button>
          </div>
          {tab === 'structure' ? <StructurePanel /> : tab === 'roof' ? <RoofPanel /> : tab === 'tree' ? <TreePanel /> : <IssuesPanel />}
        </aside>
        <section className="viewport-host" dir="ltr" ref={host} data-testid="viewport">
          {!s.derived.members.length && <div className="empty-vp">אין גיאומטריה להצגה. {errs ? 'תקן את השגיאות בלשונית "בעיות".' : ''}</div>}
          {s.tool === 'measure' && (
            <div className="measure-box" data-testid="measure-box">
              <b>מדידה</b>
              {!m.a && <div className="hint">לחץ על נקודה ראשונה (הצמדה לפינות ולקצוות).</div>}
              {m.a && !m.b && <div className="hint">לחץ על נקודה שנייה.</div>}
              {mdist && <dl className="kv">
                <dt>מרחק</dt><dd data-testid="measure-d">{fmt(mdist.d)}</dd>
                <dt>ΔX</dt><dd>{fmt(mdist.dx)}</dd><dt>ΔY</dt><dd>{fmt(mdist.dy)}</dd><dt>ΔZ</dt><dd>{fmt(mdist.dz)}</dd>
              </dl>}
            </div>
          )}
          {v.clip.enabled && (
            <div className="clip-box" data-testid="clip-box">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>חתך מישורי</b>
                <div className="seg">{(['X', 'Y', 'Z'] as const).map((a) => (
                  <button key={a} className={`tbtn${v.clip.axis === a ? ' on' : ''}`} onClick={() => store.setView({ clip: { ...v.clip, axis: a, pos: clipDefault(a) } })}>{a}</button>
                ))}</div>
                <button className="btn small" onClick={() => store.setView({ clip: { ...v.clip, flip: !v.clip.flip } })}>היפוך</button>
              </div>
              <input type="range" style={{ width: '100%' }} min={clipRange(v.clip.axis)[0]} max={clipRange(v.clip.axis)[1]} step={50} value={v.clip.pos}
                onChange={(e) => store.setView({ clip: { ...v.clip, pos: Number(e.target.value) } })} />
              <div className="hint" style={{ margin: 0 }}>{v.clip.axis} = {fmt(v.clip.pos)}</div>
            </div>
          )}
        </section>
        <aside className={`side side-end${propsOpen ? ' open' : ''}`} data-testid="props">
          <PropertiesPanel />
        </aside>
      </main>

      <footer className="statusbar" data-testid="statusbar">
        <span>נבחרו: <b data-testid="status-sel">{sel.length}</b></span>
        <span>אלמנטים: <b>{s.derived.members.length}</b></span>
        {s.hidden.length > 0 && <span>מוסתרים: <b>{s.hidden.length}</b></span>}
        {s.isolated && <span className="badge warn">מצב בידוד</span>}
        <span>שגיאות: <b style={{ color: errs ? 'var(--err)' : undefined }}>{errs}</b> · אזהרות: <b>{warns}</b></span>
        <span className="sp" />
        <span>יחידות: <b>{u === 'm' ? 'מטר' : 'מ"מ'}</b> · מודל פנימי מ"מ</span>
        <span>X רוחב · Y אורך · Z גובה</span>
        <span className="badge warn" title="חתכים וחומרים אינם מאומתים; אין בדיקת חוזק">אינו תכן מאושר</span>
      </footer>

      <nav className="mnav">
        <button className={mtab === 'side' ? 'on' : ''} onClick={() => setMtab(sideOpen ? null : 'side')} data-testid="m-side"><Icon name="building" />מבנה</button>
        <button className={!mtab ? 'on' : ''} onClick={() => setMtab(null)} data-testid="m-model"><Icon name="cube" />מודל</button>
        <button className={mtab === 'props' ? 'on' : ''} onClick={() => setMtab(propsOpen ? null : 'props')} data-testid="m-props"><Icon name="props" />מאפיינים{sel.length ? ` (${sel.length})` : ''}</button>
      </nav>

      <div className="toasts" data-testid="toasts">{s.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>

      {dialog === 'new' && <NewProjectDialog onClose={() => setDialog(null)} />}
      {dialog === 'open' && <OpenDialog onClose={() => setDialog(null)} />}
      {dialog === 'catalog' && <CatalogDialog onClose={() => setDialog(null)} />}
      {(dialog === 'move' || dialog === 'copy' || dialog === 'rotate' || dialog === 'mirror') && <TransformDialog mode={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function clipRange(a: 'X' | 'Y' | 'Z'): [number, number] {
  const b = store.state.project.building;
  const ys = b.frames.map((f) => f.y);
  if (a === 'X') return [-b.rafterOverhangLeft - 500, b.width + b.rafterOverhangRight + 500];
  if (a === 'Y') return [Math.min(...ys) - 500, Math.max(...ys) + 500];
  return [b.baseElevation, (store.state.derived.roof.ridgeZ ?? Math.max(b.eaveLeft, b.eaveRight)) + 500];
}
function clipDefault(a: 'X' | 'Y' | 'Z') { const [lo, hi] = clipRange(a); return Math.round((lo + hi) / 2 / 50) * 50; }
