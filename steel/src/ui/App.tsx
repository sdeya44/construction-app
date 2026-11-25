import { safeFileName } from '../persist/files';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assignDetail, deleteMembers, restoreDeleted, setBuilding, setPurlinSide, setSection } from '../commands/commands';
import { detailPresets } from '../geometry/detail';
import { fromMm } from '../core/units';
import { store, useStore, type ViewName } from '../store';
import { VIEW_LABEL, Viewport, largeModel } from '../view/viewport';
import { duplicateProject, exportProject, NewProjectDialog, OpenDialog, TransformDialog } from './Dialogs';
import { Icon } from './icons';
import { SizingPanel } from './SizingPanel';
import { backupDownload, fsSupported, linkedName, linkToFile, needsBackup } from '../persist/fileLink';
import { PropertiesPanel, ScopeIsolator } from './PropertiesPanel';
import { ProfileDatalist } from './StructurePanel';
import { DrawingsView } from './DrawingsView';
import { CatalogDialog } from './CatalogDialog';
import { ProductionView } from './ProductionView';
import { StepsRail } from './StepsRail';
import { CommandPalette, ConnCard, ContextBar, GutterPickHint, MarkingMenu, connectionsOf, type Cmd } from './Overlays';
import { KIND_LABEL } from './TreePanel';
import { moveLines, setPlaneSlope, shiftRoof, toCustomSection } from '../model/section';
import { NAV_INDEX, settingsOf } from './navIndex';
import { NavContent, NavCrumb, SideNav, NAV_INDEX_LABEL, navGroupOf, type NavKey } from './SideNav';
import { EaveCheckDialog } from './EaveCheckDialog';
import { ConnLibrary, ConnWizard } from './ConnWizard';
import { DetailStudio } from './DetailStudio';
import { ComponentWindow, type CompKind, compMeta, compOfConn, compOfMember, compOfNav, compPick } from './ComponentWindow';
import { stepMarks, stepOfNav } from './steps';
import { markStepDone } from './wizard/Wizard';
import { FamilyStudio } from './FamilyStudio';
import { ElementStudio } from './ElementStudio';
import { KneeStudio } from './KneeStudio';
import { WallsStudio } from './WallsStudio';
import { LayersMenu } from './LayersMenu';
import { DeletedPanel } from './DeletedPanel';

type DialogKind = null | 'new' | 'open' | 'move' | 'copy' | 'rotate' | 'mirror' | 'catalog';
type SideTab = 'structure' | 'roof' | 'brace' | 'tree' | 'conns' | 'issues';
const navGroup = (k: NavKey): SideTab => { const g = navGroupOf(k); return (g === 'clad' || g === 'special' ? 'structure' : g) as SideTab; };
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
  const [showDeleted, setShowDeleted] = useState(false);
  const [nav, setNavRaw] = useState<NavKey>('structure');
  void navGroup;
  // מסך רחב: העץ מימין משמש לניווט בלבד; פאנל אחד משמאל מציג או את הגדרות העץ או את מאפייני הבחירה
  const [wide, setWide] = useState(() => !window.matchMedia('(max-width: 860px)').matches);
  useEffect(() => { const mq = window.matchMedia('(max-width: 860px)'); const on = () => setWide(!mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }, []);
  const [lp, setLp] = useState<'nav' | 'sel'>('nav');
  // 1.54: פאנל העריכה סגור במצב רגיל (המודל ברוב המסך); נפתח מכלי בריבון / בחירה במודל, נסגר ב-✕
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem('ksp-panel') === '1'; } catch { return false; } });
  const setNav = (k: NavKey) => { setNavRaw(k); setLp('nav'); setPanelOpen(true); setLpFull(k === 's:sheet' && !window.matchMedia('(max-width: 860px)').matches); setTimeout(() => window.dispatchEvent(new Event('resize')), 30); };
  const [treeHidden, setTreeHiddenS] = useState(() => { try { return localStorage.getItem('ksp-tree-hidden') === '1'; } catch { return false; } });
  const setTreeHidden = (v: boolean) => { setTreeHiddenS(v); try { localStorage.setItem('ksp-tree-hidden', v ? '1' : '0'); } catch { /* */ } setTimeout(() => window.dispatchEvent(new Event('resize')), 30); };
  const [lpFull, setLpFull] = useState(false);
  const selNow = useStore((x) => x.selection), connNow = useStore((x) => x.activeConn), gutNow = useStore((x) => x.activeGutter);
  // בחירה חדשה / חיבור פתוח ← הפאנל עובר למאפיינים; ניקוי הבחירה ← חזרה להגדרות
  const selSig = `${selNow.join(',')}|${connNow ?? ''}`;
  // 1.64: אלמנט בודד שנסגר בלחיצה על שטח ריק — החלון נסגר (לא קופץ אשף של כל הרכיב)
  const wasElement = useRef(false);
  useEffect(() => {
    setLp(selNow.length || connNow || gutNow ? 'sel' : 'nav');
    if (selNow.length || connNow || gutNow) { setPanelOpen(true); setTimeout(() => window.dispatchEvent(new Event('resize')), 30); }
    else if (wasElement.current && lp === 'sel') { setPanelOpen(false); setTimeout(() => window.dispatchEvent(new Event('resize')), 30); }
    { const d0 = store.state.derived, m0 = selNow.length === 1 ? d0.byId.get(selNow[0]) : undefined; wasElement.current = !connNow && !gutNow && !!m0 && !compOfMember(m0, d0); }
    // 1.44: הרכיב של הבחירה מסומן בעץ — ובחזרה להגדרות נפתח אותו כרטיס (סיכום + לשוניות) של הרכיב
    const id = connNow ?? selNow[0];
    if (id) { const k = settingsOf(id, store.state.derived.byId.get(id)?.kind ?? ''); if (k) setNavRaw(k[0] as NavKey); }
  }, [selSig, gutNow]);
  // 1.51: עריכת חיבור / אשף חיבור — המבט מתקרב לצומת (כפתור "חזרה למודל המלא" מחזיר)
  const wizNow = useStore((x) => x.connWizard ?? null);
  useEffect(() => {
    const cid = connNow ?? wizNow;
    if (!cid) return;
    const d = store.state.derived, c = d.connById.get(cid);
    if (!c) return;
    const small = [...c.parts, ...c.bolts.map((b) => `${b.id}.H`)].filter((x) => d.byId.has(x));
    setTimeout(() => vp.current?.focusIds(small.length ? small : c.members, small.length ? 700 : 300), 60);
  }, [connNow, wizNow]);
  const navShown = !wide || lp === 'nav';
  useEffect(() => { const k = navShown ? nav : undefined; if (store.state.navKey !== k) store.set({ navKey: k }); }, [nav, navShown]);
  const setTab = (t: SideTab) => setNav(t);
  const [mtab, setMtab] = useState<MobileTab>(null);
  const [mode, setMode] = useState<'model' | 'drawings' | 'production'>('model');
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [vpObj, setVpObj] = useState<Viewport | null>(null);
  const [dimEdit, setDimEdit] = useState<{ key: string; value: number; x: number; y: number } | null>(null);
  // חלונית הגדרות צפה על המודל (בחירת אלמנט ← "מידות והגדרות")
  const [quick, setQuick] = useState<{ key: NavKey; label: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setQuick((e as CustomEvent).detail);
    window.addEventListener('ksp-quick', on);
    return () => window.removeEventListener('ksp-quick', on);
  }, []);
  /** עריכת מידה מהתצוגה: מרווח צירים / מרווח מסגרות / רוחב — מזיז את כל מה שאחרי */
  const commitDim = (key: string, v: number, old = 0) => {
    const bb = store.state.project.building;
    const [k0, si] = key.split(':');
    // רוחב בחתך מודולרי עם שני צירים = מרווח הצירים
    const k = k0 === 'w' && bb.section ? 'x' : k0;
    const i = k0 === 'w' ? 0 : Number(si);
    if (!(v > 0)) return;
    if (k === 'y') {
      const fr = [...bb.frames].sort((a, c) => a.y - c.y);
      const delta = v - (fr[i + 1].y - fr[i].y);
      store.exec(setBuilding({ frames: fr.map((f, j) => (j > i ? { ...f, y: f.y + delta } : f)) }));
    } else if (k === 'x' && bb.section) {
      const ls = [...bb.section.lines].sort((a, c) => a.x - c.x);
      const delta = v - (ls[i + 1].x - ls[i].x);
      store.exec(setSection(moveLines(bb.section, new Map(ls.filter((_, j) => j > i).map((l) => [l.id, l.x + delta]))), 'שינוי מרווח צירים'));
    } else if (k === 'sl' || k === 'hz') {
      // שיפוע (הערך ‰ ⇐ %) או גובה עמודים — על החתך (2 צירים הופך לחתך שנשמר)
      const sec = bb.section ?? toCustomSection(bb, store.state.derived.roof);
      if (k === 'sl') store.exec(setSection(setPlaneSlope(sec, si, v / 1000), 'שינוי שיפוע'));
      else store.exec(setSection(shiftRoof(sec, v - old), 'שינוי גובה עמודים'));
    } else if (k === 'ps') {
      store.exec(setPurlinSide(si, { spacing: v }));
    } else if (k === 'w') {
      store.exec(setBuilding(bb.roofType === 'gable' && Math.abs(bb.ridgeX - bb.width / 2) < 1 ? { width: v, ridgeX: v / 2 } : { width: v }));
    }
  };
  const s = useStore((x) => x);
  const sel = s.selection;
  const v = s.view;
  const errs = s.derived.issues.filter((i) => i.severity === 'error').length;
  const bigModel = useMemo(() => largeModel(s.derived), [s.derived]);
  const warns = s.derived.issues.filter((i) => i.severity === 'warning').length;

  useEffect(() => {
    if (!host.current) return;
    const viewport = new Viewport(host.current);
    vp.current = viewport;
    setVpObj(viewport);
    viewport.onContext = (x, y) => setMenu({ x, y });
    viewport.onDimEdit = (key, value, x, y) => setDimEdit({ key, value, x, y });
    window.__ksp = { store, viewport, assignDetail, detailPresets };
    const onNav = (e: Event) => { setMode('model'); setNav((e as CustomEvent).detail as NavKey); };
    const onMode = (e: Event) => setMode((e as CustomEvent).detail as typeof mode);
    window.addEventListener('ksp-mode', onMode);
    window.addEventListener('ksp-nav', onNav);
    return () => { viewport.dispose(); window.removeEventListener('ksp-nav', onNav); window.removeEventListener('ksp-mode', onMode); };
  }, []);

  // מנגנון בדיקה: שינוי פרופיל שגורם להתנגשות בפלטת ראש העמוד — חלון קופץ עם הצעה
  const eaveErr = s.derived.issues.filter((i) => i.code === 'EAVE_FIT' && i.severity === 'error');
  const prevEave = useRef(eaveErr.length);
  useEffect(() => {
    if (eaveErr.length > prevEave.current && eaveErr[0]?.elementId) store.set({ eaveCheck: eaveErr[0].elementId });
    prevEave.current = eaveErr.length;
  }, [eaveErr.length]);

  // קיצורי מקשים
  const treeHiddenRef = useRef(treeHidden); treeHiddenRef.current = treeHidden;
  const lpFullRef = useRef(lpFull); lpFullRef.current = lpFull;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // לפי מיקום המקש (עובד גם בפריסת מקלדת עברית)
      const k = e.code?.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'k') { e.preventDefault(); setPalette((x) => !x); return; }
      const t = e.target as HTMLElement;
      // שדות הקלדה בלבד — תיבת סימון/כפתור רדיו לא חוסמים קיצורים (Delete, Ctrl+Z)
      const typing = t && ((t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes((t as HTMLInputElement).type)) || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      // סטודיו הפרטים פתוח — המקשים שייכים לו (Delete שם מוחק פעולה, לא אלמנט מהמודל)
      if (dialog || palette || menu || store.state.detailStudio) return;
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
      else if (mod && k === 's') { e.preventDefault(); void store.saveNow('שמירה ידנית').then((ok) => ok && store.toast('ok', 'נשמר')); }
      else if (mod && k === 'a') { e.preventDefault(); store.select(store.state.derived.members.map((m) => m.id)); }
      else if (k === 'delete') {
        const sel0 = store.state.selection, n = sel0.length, by = store.state.derived.byId;
        const cols = sel0.filter((x) => by.get(x)?.kind === 'column').length, rafs = sel0.filter((x) => by.get(x)?.kind === 'rafter').length;
        const main = cols || rafs ? ` (כולל ${[cols ? `${cols} עמודים` : '', rafs ? `${rafs} קורות גג` : ''].filter(Boolean).join(' ו-')})` : '';
        if (n && store.exec(deleteMembers(sel0))) store.toast(main ? 'error' : 'info', `נמחקו ${n} אלמנטים${main} — לשחזור: Ctrl+Z, או "שחזור" בסרגל הכלים`);
      }
      else if (k === 'escape') { if (lpFullRef.current) { setLpFull(false); return; } store.select([]); store.set({ tool: 'select', measure: {}, activeConn: null }); }
      else if (k === 'f') vp.current?.fitAll();
      else if (k === 'z' && !mod) vp.current?.fitSelection();
      else if (k === 'm') store.set({ tool: store.state.tool === 'measure' ? 'select' : 'measure', measure: {} });
      else if (k === 'h') hide();
      else if (k === 'i') isolate();
      else if (k === 'u') showAll();
      else if (k === 'p' && !mod) { setMode('model'); setTab('roof'); }
      else if (k === 'n' && !mod) setTreeHidden(!treeHiddenRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, palette, menu]);

  const setView = (name: ViewName) => vp.current?.fitAll(name);
  const clientImage = () => {
    const url = vp.current?.presentationShot(2400, 1500, true);
    if (!url) { store.toast('error', 'אין מודל להצגה'); return; }
    const bin = atob(url.split(',')[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8], { type: 'image/png' })); a.download = `${safeFileName(store.state.project.meta.name)}_הדמיה.png`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    store.toast('ok', 'נשמרה תמונה ללקוח');
  };
  const hide = () => { if (store.state.selection.length) store.set({ hidden: [...new Set([...store.state.hidden, ...store.state.selection])], selection: [] }); };
  const isolate = () => { if (store.state.selection.length) store.set({ isolated: [...store.state.selection] }); };
  const showAll = () => store.set({ hidden: [], isolated: null, filter: { column: true, rafter: true, beam: true, brace: true, purlin: true, girt: true, cleat: true, plate: true, bolt: true, anchor: true } });
  const u = s.project.displayUnit;
  const m = s.measure;
  const mdist = m.a && m.b ? { d: Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y, m.b.z - m.a.z), dx: m.b.x - m.a.x, dy: m.b.y - m.a.y, dz: m.b.z - m.a.z } : null;
  const fmt = (mm: number) => (u === 'm' ? `${fromMm(mm, 'm').toFixed(3)} מ'` : `${mm.toFixed(1)} מ"מ`);
  const saveText = { saved: 'נשמר במחשב', dirty: 'שינויים לא שמורים', saving: 'שומר…', error: 'שגיאת שמירה' }[s.saveState];
  const sideOpen = mtab === 'side', propsOpen = mtab === 'props';
  const [linked, setLinked] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { setLinked(linkedName(s.project.id)); }, [s.project.id]);
  // ברירת מחדל: פאנל המאפיינים קבוע (המבט לא קופץ בבחירה); המשתמש יכול לכווץ אותו ידנית — ואז הוא נפתח כשכבה בבחירה
  const [propsPinned, setPropsPinnedS] = useState(() => { try { return localStorage.getItem('ksp-props-pinned') !== '0'; } catch { return true; } });
  const setPropsPinned = (v: boolean) => { setPropsPinnedS(v); try { localStorage.setItem('ksp-props-pinned', v ? '1' : '0'); } catch { /* */ } setTimeout(() => window.dispatchEvent(new Event('resize')), 30); };

  // פתיחת חיבור: עורך בלוח המאפיינים + סימון חלקיו
  const openConn = (id: string) => {
    const c = store.state.derived.connById.get(id);
    setMode('model');
    store.set({ activeConn: id, ...(c ? { selection: c.parts.filter((x) => store.state.derived.byId.has(x)).concat(c.members).slice(0, 80) } : {}) });
    if (window.matchMedia('(max-width: 860px)').matches) setMtab('props');
  };
  const goTab = (t: SideTab) => { setMode('model'); setTab(t); if (window.matchMedia('(max-width: 860px)').matches) setMtab('side'); };
  const focusProfile = () => { setMode('model'); store.set({ activeConn: null }); setTimeout(() => (document.querySelector('[data-testid="prop-profile"]') as HTMLInputElement | null)?.focus(), 30); };
  const saveNow = () => void store.saveNow('שמירה ידנית').then((ok) => ok && store.toast('ok', 'נשמר'));

  const cmds: Cmd[] = [
    { id: 'mode-model', group: 'מצבי עבודה', label: 'מודל', run: () => setMode('model') },
    { id: 'mode-conns', group: 'מצבי עבודה', label: 'חיבורים — רשימה ועורך', run: () => goTab('conns') },
    { id: 'mode-drawings', group: 'מצבי עבודה', label: 'שרטוטים', run: () => setMode('drawings') },
    { id: 'mode-production', group: 'מצבי עבודה', label: 'ייצור וכמויות', run: () => setMode('production') },
    { id: 'issues', group: 'מצבי עבודה', label: `בדיקות ובעיות (${errs + warns})`, run: () => goTab('issues') },
    { id: 'structure', group: 'מבנה', label: 'מבנה — מידות, מסגרות, קושרות', run: () => goTab('structure') },
    { id: 'roof', group: 'מבנה', label: 'גג ופטות — פריסה, תומכים, חיבורי המשך', keys: 'P', run: () => goTab('roof') },
    { id: 'tree', group: 'מבנה', label: 'עץ אלמנטים', run: () => goTab('tree') },
    ...NAV_INDEX.map((n) => ({ id: `nav-${n.key}`, group: 'מעבר להגדרות', label: n.label, search: n.words, run: () => { setMode('model'); setNav(n.key); } })),
    { id: 'select', group: 'כלים', label: 'בחירה', keys: 'Esc', run: () => store.set({ tool: 'select', measure: {} }) },
    { id: 'measure', group: 'כלים', label: 'מדידה', keys: 'M', run: () => store.set({ tool: 'measure', measure: {} }) },
    { id: 'move', group: 'עריכה', label: 'הזזה', disabled: !sel.length, run: () => setDialog('move') },
    { id: 'copy', group: 'עריכה', label: 'העתקה', disabled: !sel.length, run: () => setDialog('copy') },
    { id: 'rotate', group: 'עריכה', label: 'סיבוב', disabled: !sel.length, run: () => setDialog('rotate') },
    { id: 'mirror', group: 'עריכה', label: 'שיקוף', disabled: !sel.length, run: () => setDialog('mirror') },
    { id: 'delete', group: 'עריכה', label: 'מחיקה', keys: 'Del', disabled: !sel.length, danger: true, run: () => store.exec(deleteMembers(store.state.selection)) },
    { id: 'restore', group: 'עריכה', label: 'שחזור אלמנטים שנמחקו', disabled: !s.project.deleted.length, run: () => store.exec(restoreDeleted()) },
    { id: 'undo', group: 'עריכה', label: 'ביטול', keys: 'Ctrl Z', disabled: !s.canUndo, run: () => store.undo() },
    { id: 'redo', group: 'עריכה', label: 'חזרה', keys: 'Ctrl Y', disabled: !s.canRedo, run: () => store.redo() },
    { id: 'selall', group: 'בחירה', label: 'בחר הכל', keys: 'Ctrl A', run: () => store.select(store.state.derived.members.map((m) => m.id)) },
    { id: 'hide', group: 'בחירה', label: 'הסתר בחירה', keys: 'H', disabled: !sel.length, run: () => hide() },
    { id: 'isolate', group: 'בחירה', label: 'בודד בחירה', keys: 'I', disabled: !sel.length, run: () => isolate() },
    { id: 'showall', group: 'בחירה', label: 'הצג הכל', keys: 'U', run: () => showAll() },
    { id: 'fit', group: 'מבט', label: 'התאמה למסך', keys: 'F', run: () => vp.current?.fitAll() },
    { id: 'zoomsel', group: 'מבט', label: 'התמקדות בבחירה', keys: 'Z', disabled: !sel.length, run: () => vp.current?.fitSelection() },
    ...(['iso', 'front', 'right', 'top', 'left', 'back'] as ViewName[]).map((n) => ({ id: `view-${n}`, group: 'מבט', label: `מבט ${VIEW_LABEL[n]}`, run: () => { setMode('model'); setView(n); } })),
    { id: 'ortho', group: 'מבט', label: v.projection === 'ortho' ? 'פרספקטיבה' : 'הטלה אורתוגרפית', run: () => store.setView({ projection: v.projection === 'ortho' ? 'persp' : 'ortho' }) },
    { id: 'wire', group: 'מבט', label: v.render === 'solid' ? 'קווי מתאר' : 'מוצק', run: () => store.setView({ render: v.render === 'solid' ? 'wire' : 'solid' }) },
    { id: 'clip', group: 'מבט', label: 'חתך מישורי', run: () => store.setView({ clip: { ...v.clip, enabled: !v.clip.enabled } }) },
    { id: 'split', group: 'מבט', label: 'ארבעה מבטים', run: () => store.setView({ split: !v.split }) },
    { id: 'client-image', group: 'מבט', label: 'תמונה ריאליסטית ללקוח (PNG)', run: () => { setMode('model'); setTimeout(clientImage, 60); } },
    { id: 'dims', group: 'מבט', label: v.dims ? 'הסתר מידות' : 'הצג מידות', run: () => store.setView({ dims: !v.dims }) },
    { id: 'new', group: 'קובץ', label: 'פרויקט חדש', run: () => setDialog('new') },
    { id: 'open', group: 'קובץ', label: 'פתיחת פרויקט', run: () => setDialog('open') },
    { id: 'save', group: 'קובץ', label: 'שמירה', keys: 'Ctrl S', run: saveNow },
    { id: 'saveas', group: 'קובץ', label: 'שמירה בשם (שכפול)', run: duplicateProject },
    { id: 'export', group: 'קובץ', label: 'ייצוא קובץ פרויקט', run: exportProject },
    { id: 'catalog', group: 'קובץ', label: 'קטלוג חתכים — ייבוא מאקסל', run: () => setDialog('catalog') },
  ];

  const ms = sel.map((id) => s.derived.byId.get(id)).filter(Boolean);
  // 1.59: סרגל השלבים — עם שמות (ברירת מחדל) או מכווץ לנקודות
  const [railWide, setRailWide] = useState(() => { try { return localStorage.getItem('ksp-rail-wide') !== '0'; } catch { return true; } });
  // 1.55: חלון רכיב (קשיחות קירות / אלכסוני עמוד-קורה) — מהריבון, מהשלבים או מלחיצה על אלמנט שלו
  // 1.64: אלמנט בודד שאינו שייך לאשף משפחה — חלון "אלמנט" באותו מבנה (במקום הכרטיס הנפרד)
  const comp: CompKind | null = !wide ? null : lp === 'nav' || (!ms.length && !s.activeConn && !s.activeGutter) ? compOfNav(nav) : s.activeConn ? compOfConn(s.activeConn) : !s.activeGutter && ms.length === 1 ? (compOfMember(ms[0]!, s.derived) ?? 'element') : null;
  // 1.55.2: חלון/פאנל צף מעל המודל — מרכז התמונה עובר לחלק הגלוי של המודל
  useEffect(() => {
    const t = setInterval(() => {
      // גובה סרגל התצוגה — החלונות הצפים מתחילים מתחתיו
      const vb = document.querySelector('.workspace > .center .viewbar')?.getBoundingClientRect(), ce = document.querySelector('.workspace > .center')?.getBoundingClientRect(), ws = document.querySelector<HTMLElement>('.workspace');
      if (vb && ce && ws) { const h = `${Math.round(vb.bottom - ce.top)}px`; if (ws.style.getPropertyValue('--vbh') !== h) ws.style.setProperty('--vbh', h); }
      const v = vp.current; const pane = v?.panes[0]?.el.getBoundingClientRect();
      const fl = document.querySelector<HTMLElement>('.workspace:not(.panel-closed) > .side-end > .cwin:not(.min), .workspace:not(.panel-closed) > .side-end > .fpanel');
      if (!v || !pane) return;
      const r = fl && fl.offsetParent ? fl.getBoundingClientRect() : null;
      if (!r || r.width < 10 || r.width > pane.width * 0.8) { v.setSafe(0, 0); ws?.style.setProperty('--safe-r', '0px'); ws?.style.setProperty('--safe-l', '0px'); return; }
      const mid = (r.left + r.right) / 2;
      if (mid > pane.left + pane.width / 2) v.setSafe(0, pane.right - r.left + 8); else v.setSafe(r.right - pane.left + 8, 0);
      // שכבות על המודל (בדיקת גדלים וכו') זזות הצידה כדי לא להיכנס מתחת לחלון הצף
      if (ws) { ws.style.setProperty('--safe-r', `${v.safe.r}px`); ws.style.setProperty('--safe-l', `${v.safe.l}px`); }
    }, 200);
    return () => clearInterval(t);
  }, []);
  // חלון רכיב פתוח — לחיצה במודל מעדיפה את אלמנטי הרכיב
  useEffect(() => { const pf = compPick(comp); if ((store.state.pickPrefer ?? null) !== pf) store.set({ pickPrefer: pf }); }, [comp]);
  // 1.64: סגירת חלון אלמנט מנקה את הבחירה — לחיצה חוזרת על אותו אלמנט פותחת אותו שוב
  const closePanel = () => { if (comp === 'element') store.select([]); setPanelOpen(false); setLpFull(false); setTimeout(() => window.dispatchEvent(new Event('resize')), 30); };
  const menuItems = (): Cmd[] => {
    const one = ms.length === 1 ? ms[0]! : null;
    const conns = one ? connectionsOf(one, s.derived.connections, s.derived.connById) : [];
    return [
      // 1.57: פקודת עריכה מתפריט ההקשר — אותו אשף כמו לחיצה על האלמנט
      { id: 'edit', group: '', label: 'עריכה', run: () => { setLp('sel'); setPanelOpen(true); setTimeout(() => window.dispatchEvent(new Event('resize')), 30); } },
      { id: 'conns', group: '', label: 'חיבורים', disabled: !conns.length, run: () => conns.length && openConn(conns[0].id) },
      { id: 'profile', group: '', label: 'חתך', run: focusProfile },
      { id: 'isolate', group: '', label: 'בודד', run: isolate },
      { id: 'drawings', group: '', label: 'שרטוטים', run: () => setMode('drawings') },
      { id: 'move', group: '', label: 'הזזה', run: () => setDialog('move') },
      { id: 'copy', group: '', label: 'העתקה', run: () => setDialog('copy') },
      { id: 'hide', group: '', label: 'הסתר', run: hide },
      { id: 'delete', group: '', label: 'מחק', danger: true, run: () => store.exec(deleteMembers(store.state.selection)) },
    ];
  };
  const pickElement = (id: string) => { setMode('model'); store.select([id]); setTimeout(() => vp.current?.fitSelection(), 0); };
  const crumb = ms.length === 1 ? ms[0]!.label : ms.length > 1 ? `${ms.length} אלמנטים` : '';
  const railBtn = (key: string, icon: string, label: string, on: boolean, onClick: () => void, testId?: string, badge?: number) => (
    <button key={key} className={`rail-btn${on ? ' on' : ''}`} onClick={onClick} data-testid={testId} aria-pressed={on}>
      <Icon name={icon} /><span>{label}</span>{badge ? <i className="rail-badge">{badge}</i> : null}
    </button>
  );

  return (
    <div className={`app mode-${mode}`}>
      <ProfileDatalist />
      <nav className="rail" aria-label="מצבי עבודה">
        <div className="rail-logo" aria-hidden="true">K</div>
        {railBtn('model', 'cube', 'מודל', mode === 'model', () => setMode('model'), 'mode-model', errs + warns)}
        {railBtn('dwg', 'sheet', 'שרטוטים', mode === 'drawings', () => setMode('drawings'), 'mode-drawings')}
        {railBtn('prod', 'factory', 'ייצור', mode === 'production', () => setMode('production'), 'mode-production')}
        <div className="rail-sp" />
        {railBtn('cat', 'tree', 'קטלוג', false, () => setDialog('catalog'), 'btn-catalog')}
      </nav>

      <header className="topbar">
        <div className="brand"><span className="brand-name">KAYAN <em>STEEL PRO</em></span><small className="desk-only">1.71.0</small></div>
        <span className="tb-div desk-only" />
        <div className="proj-name" data-testid="proj-name" title={s.project.meta.name}>{s.project.meta.name}</div>
        {crumb && <span className="crumb desk-only" data-testid="crumb">‹ {crumb}</span>}
        {s.project.revision.locked && <span className="badge warn" data-testid="locked-badge">מהדורה {s.project.revision.current} נעולה</span>}
        <div className="spacer" />
        <button className="search-pill" onClick={() => setPalette(true)} data-testid="cmdk-open" title="לוח פקודות (Ctrl K)">
          <Icon name="search" /><span className="desk-only">חיפוש אלמנט או פקודה…</span><kbd className="desk-only">Ctrl K</kbd>
        </button>
        <button className="tb-btn desk-only" onClick={() => setDialog('new')} data-testid="btn-new" title="פרויקט חדש"><Icon name="file" /></button>
        <button className="tb-btn" onClick={() => setDialog('open')} data-testid="btn-open" title="פתיחה"><Icon name="folder" /></button>
        <button className="tb-btn desk-only" onClick={saveNow} data-testid="btn-save" title="שמירה (Ctrl S)"><Icon name="save" /></button>
        <button className="tb-btn desk-only" onClick={exportProject} data-testid="btn-export" title="ייצוא קובץ פרויקט"><Icon name="download" /></button>
        <button className={`tb-btn desk-only${linked ? ' on' : ''}`} data-testid="btn-link-file" title={linked ? `נשמר אוטומטית גם לקובץ: ${linked}` : fsSupported() ? 'שמירה אוטומטית לקובץ בתיקייה שתבחר (גיבוי מחוץ לדפדפן)' : 'גיבוי לקובץ (הורדה)'} onClick={async () => {
          try { const n = await linkToFile(s.project); if (n) { setLinked(n); store.toast('ok', `כל שמירה תיכתב גם לקובץ ${n}`); } else store.toast('ok', 'הופק קובץ גיבוי'); } catch { /* בוטל */ }
        }}><Icon name="save" />{linked ? <span className="tb-mini">קובץ</span> : null}</button>
        {!linked && needsBackup(s.project) && <button className="chip-st warn" data-testid="backup-reminder" title="הפרויקט שמור רק בדפדפן. ניקוי נתוני הדפדפן ימחק אותו." onClick={() => { backupDownload(s.project); store.toast('ok', 'הופק קובץ גיבוי'); setTick(tick + 1); }}>⚠ לא גובה לקובץ — גבה עכשיו</button>}
        <span className="tb-div desk-only" />
        <button className="tb-btn" onClick={() => store.undo()} disabled={!s.canUndo} title={s.undoLabel ? `ביטול: ${s.undoLabel}` : 'ביטול'} data-testid="btn-undo"><Icon name="undo" /></button>
        <button className="tb-btn" onClick={() => store.redo()} disabled={!s.canRedo} title={s.redoLabel ? `חזרה: ${s.redoLabel}` : 'חזרה'} data-testid="btn-redo"><Icon name="redo" /></button>
        <span className={`save-state ${s.saveState} desk-only`}>{s.saveState === 'saved' ? '✓ ' : ''}<span data-testid="save-state">{saveText}</span> · מהדורה {s.project.revision.current}</span>
      </header>

      {mode === 'drawings' && <main className="mode-area"><DrawingsView /></main>}
      {mode === 'production' && <main className="mode-area"><ProductionView /></main>}
      <main className={`workspace${wide && !panelOpen ? ' panel-closed' : ''}${!propsPinned ? ' props-collapsed' : ''}${!propsPinned && (sel.length || s.activeConn || lp === 'nav') ? ' props-float' : ''}${treeHidden ? ' tree-hidden' : ''}${lpFull ? ' lp-full' : ''}${comp ? ' comp-open' : ''}${wide && railWide ? ' rail-wide' : ''}`} style={mode !== 'model' ? { display: 'none' } : undefined}>
        {/* 1.61: הריבון הוסר במסך רחב — הכניסה לכל רכיב מסרגל השלבים (ומחיפוש, מהמודל ומגיליון הפרמטרים) */}
        <aside className={`side side-start${sideOpen ? ' open' : ''}`} data-testid="nav-tree-pane">
          {wide ? <StepsRail nav={nav} setNav={setNav} setMode={setMode} onExport={exportProject} wide={railWide} setWide={(v) => { setRailWide(v); try { localStorage.setItem('ksp-rail-wide', v ? '1' : '0'); } catch { /* */ } setTimeout(() => window.dispatchEvent(new Event('resize')), 30); }} /> : <SideNav nav={nav} setNav={setNav} onOpenConn={openConn} treeOnly={wide} />}
        </aside>
        <div className="center">
          <section className="viewport-host" dir="ltr" ref={host} data-testid="viewport">
            {!s.derived.members.length && <div className="empty-vp">אין גיאומטריה להצגה. {errs ? 'תקן את השגיאות בלשונית "בעיות".' : ''}</div>}
          </section>

          <div className="chips">
            {errs > 0 && <button className="chip-st err" onClick={() => goTab('issues')} data-testid="chip-errors">{errs} שגיאות</button>}
            {warns > 0 && <button className="chip-st warn" onClick={() => goTab('issues')} data-testid="chip-warnings">{warns} אזהרות</button>}
            {s.isolated && <button className="chip-st" onClick={showAll}>מצב בידוד · הצג הכל</button>}

          </div>

          <div className="viewbar" role="toolbar" aria-label="מבט ותצוגה">
            <div className="seg">
              {(['iso', 'front', 'right', 'top', 'left', 'back'] as ViewName[]).map((n) => (
                <button key={n} className={`tbtn${n === 'left' || n === 'back' ? ' desk-only' : ''}`} onClick={() => setView(n)} data-testid={`view-${n}`}>{VIEW_LABEL[n]}</button>
              ))}
            </div>
            <button className={`tbtn desk-only${treeHidden ? '' : ' on'}`} onClick={() => setTreeHidden(!treeHidden)} title={treeHidden ? 'הצגת עץ התפריטים (N)' : 'הסתרת עץ התפריטים — יותר מקום למודל (N)'} data-testid="tree-toggle" aria-pressed={!treeHidden}>☰</button>
            <TB icon="fit" title="התאמה למסך (F)" onClick={() => vp.current?.fitAll()} testId="fit" />
            <TB icon="zoomSel" title="התמקדות בבחירה (Z)" disabled={!sel.length} onClick={() => vp.current?.fitSelection()} desk />
            <span className="vb-sep desk-only" />
            <div className="seg">
              <button className={`tbtn${v.projection === 'persp' ? ' on' : ''}`} onClick={() => store.setView({ projection: 'persp' })} data-testid="proj-persp">פרספקטיבה</button>
              <button className={`tbtn${v.projection === 'ortho' ? ' on' : ''}`} onClick={() => store.setView({ projection: 'ortho' })} data-testid="proj-ortho">אורתו</button>
            </div>
            <TB icon={v.render === 'solid' ? 'solid' : 'wire'} title={v.render === 'solid' ? 'מוצק (מעבר לקווי מתאר)' : 'קווי מתאר (מעבר למוצק)'} on={v.render === 'wire'} onClick={() => store.setView({ render: v.render === 'solid' ? 'wire' : 'solid' })} testId="render-mode" />
            <TB icon="grid" title="רשת צירים" on={v.grid} onClick={() => store.setView({ grid: !v.grid })} desk />
            <TB icon="dims" title="מידות" on={v.dims} onClick={() => store.setView({ dims: !v.dims })} testId="toggle-dims" />
            <TB icon="tag" title="תוויות בחירה" on={v.labels} onClick={() => store.setView({ labels: !v.labels })} desk />
            <TB icon="split" title="ארבעה מבטים" on={v.split} onClick={() => store.setView({ split: !v.split })} testId="toggle-split" desk />
            <TB icon="camera" title="תמונה ריאליסטית ללקוח (PNG) — מהמבט הנוכחי, עם חיפוי, קרקע וצללים" onClick={() => clientImage()} testId="client-image" />
            <span className="vb-sep" />
            <LayersMenu />
            <TB icon="eyeOff" title="הסתר בחירה (H)" disabled={!sel.length} onClick={hide} testId="hide" />
            <TB icon="isolate" title="בודד בחירה (I)" disabled={!sel.length} onClick={isolate} testId="isolate" />
            <TB icon="showAll" title="הצג הכל (U)" disabled={!s.hidden.length && !s.isolated} onClick={showAll} testId="show-all" />
          </div>

          {s.viewFocused && <button className="view-restore" data-testid="view-restore" title="המבט התקרב לצומת שבעריכה — חזרה למבט הקודם" onClick={() => vp.current?.restoreView()}>↩ חזרה למודל המלא</button>}
          <ContextBar vp={vpObj} onOpenConn={openConn} onMore={(x, y) => setMenu({ x, y })} />
          <GutterPickHint />
          <ConnCard onOpen={openConn} />
          {quick && (
            <div className="quick-panel" data-testid="quick-panel" role="dialog" aria-label={quick.label}>
              <div className="quick-h">
                <b>{quick.label}</b>
                <button className="btn small" data-testid="quick-to-tree" onClick={() => { setNav(quick.key); setQuick(null); }}>פתח בעץ</button>
                <button className="icon-btn" aria-label="סגירה" data-testid="quick-close" onClick={() => setQuick(null)}><Icon name="x" /></button>
              </div>
              <div className="quick-b"><NavContent nav={quick.key} onOpenConn={openConn} /></div>
            </div>
          )}

          <div className="dock" role="toolbar" aria-label="כלי עבודה">
            <TB icon="select" label="בחירה" on={s.tool === 'select'} onClick={() => store.set({ tool: 'select', measure: {} })} testId="tool-select" />
            <TB icon="measure" label="מדידה" on={s.tool === 'measure'} onClick={() => store.set({ tool: s.tool === 'measure' ? 'select' : 'measure', measure: {} })} testId="tool-measure" />
            <TB icon="sizing" label="גדלים" on={s.colorMode === 'sizing'} title="בדיקת גדלים — צביעה לפי כללי אצבע (כתום/ירוק/סגול)" onClick={() => store.set({ colorMode: s.colorMode === 'sizing' ? 'kind' : 'sizing' })} testId="tool-sizing" />
            <TB icon="clip" label="חתך" on={v.clip.enabled} onClick={() => store.setView({ clip: { ...v.clip, enabled: !v.clip.enabled } })} testId="toggle-clip" />
            <span className="dock-sep desk-only" />
            <TB icon="move" label="הזזה" disabled={!sel.length} onClick={() => setDialog('move')} testId="tool-move" desk />
            <TB icon="copy" label="העתקה" disabled={!sel.length} onClick={() => setDialog('copy')} testId="tool-copy" desk />
            <TB icon="rotate" title="סיבוב" disabled={!sel.length} onClick={() => setDialog('rotate')} testId="tool-rotate" desk />
            <TB icon="mirror" title="שיקוף" disabled={!sel.length} onClick={() => setDialog('mirror')} testId="tool-mirror" desk />
            <TB icon="trash" title="מחיקה (Delete)" disabled={!sel.length} onClick={() => store.exec(deleteMembers(sel))} testId="tool-delete" desk />
            {s.project.deleted.length > 0 && <TB icon="history" label={`שחזור (${s.project.deleted.length})`} title="רשימת האלמנטים שנמחקו — החזרה אחד-אחד או הכל" on={showDeleted} onClick={() => setShowDeleted(!showDeleted)} testId="tool-restore" />}
          </div>
          {showDeleted && s.project.deleted.length > 0 && <DeletedPanel onClose={() => setShowDeleted(false)} />}

          {s.colorMode === 'sizing' && s.tool !== 'measure' && <SizingPanel />}
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
        </div>
        <aside className={`side side-end${propsOpen ? ' open' : ''}`} data-testid="props">
          <button className="props-pin desk-only" data-testid="props-pin" title={propsPinned ? 'כיווץ הפאנל — יותר מקום לתלת־ממד; בבחירה הפאנל נפתח כשכבה' : 'קיבוע הפאנל'} onClick={() => setPropsPinned(!propsPinned)}>{propsPinned ? '▸ כיווץ פאנל' : '◂ הגדרות ומאפיינים'}</button>
          {comp ? (!panelOpen ? null :
            <ComponentWindow key={comp === 'element' ? `el|${sel[0]}` : comp} kind={comp} title={comp === 'element' ? ms[0]?.label : undefined} sub={comp === 'element' && ms[0] ? KIND_LABEL[ms[0].kind] : undefined} memberId={lp === 'sel' ? (s.activeConn ?? sel[0]) : undefined} onClose={closePanel} step={stepOfNav(compOfNav(nav) === comp ? nav : compMeta(comp).nav)}
              studio={comp === 'knee' ? <KneeStudio memberId={lp === 'sel' ? (s.activeConn ?? sel[0]) : undefined} /> : comp === 'walls' ? <WallsStudio memberId={lp === 'sel' ? (s.activeConn ?? sel[0]) : undefined} /> : comp === 'element' ? <ElementStudio memberId={sel[0]} /> : <FamilyStudio fam={comp} nav={nav} memberId={lp === 'sel' ? (s.activeConn ?? sel[0]) : undefined} />}>
              {lp === 'nav' ? <div className="nav-content" data-testid="lp-nav-content"><NavCrumb nav={nav} item={NAV_INDEX_LABEL(nav, true)} /><NavContent nav={nav} onOpenConn={openConn} /></div> : <PropertiesPanel />}
            </ComponentWindow>
          ) : <section className="fpanel" data-testid="fpanel">
          {wide && (
              // 1.50: בלי לשוניות — תצוגה אחת: מה שנבחר אחרון. מחלון האלמנט — שביל לרכיב כולו; מהרכיב — "נבחר: … ←" חזרה לאלמנט
              <div className="lp-head" data-testid="lp-head">
                {lp === 'sel'
                  ? <span className="lp-path"><button className="lp-crumb" data-testid="lp-crumb" title="הגדרות הרכיב כולו (כמו בעץ)" onClick={() => setLp('nav')}>→ {NAV_INDEX_LABEL(nav)}</button><span className="lp-sep">·</span><b className="lp-here" data-testid="lp-here">{s.activeConn ? 'חיבור' : s.activeGutter ? 'מזחלה' : ms.length === 1 ? ms[0]!.label : `${sel.length} אלמנטים`}</b></span>
                  : <span className="lp-path muted">הגדרות הרכיב</span>}
                {lp === 'nav' && (() => { const k = stepOfNav(nav); if (!k || k === 'issues') return null; const done = stepMarks(s.project, s.derived)[k] === 'done' && !!s.project.meta.steps; return done ? <span className="step-done-b" data-testid="step-done-ok">✓ השלב הושלם</span> : <button className="btn small step-done-b" data-testid="step-done" title="סימון השלב כהושלם בסרגל השלבים" onClick={() => markStepDone(k)}>✓ סיום השלב</button>; })()}
                <button className="lp-close" data-testid="lp-close" title="סגירת הפאנל — המודל במסך מלא" aria-label="סגירת הפאנל" onClick={() => { setPanelOpen(false); setLpFull(false); setTimeout(() => window.dispatchEvent(new Event('resize')), 30); }}>✕</button>
                <button className="lp-full-btn" onClick={() => { setLpFull(!lpFull); setTimeout(() => window.dispatchEvent(new Event('resize')), 30); }} title={lpFull ? 'חזרה לגודל רגיל (Esc)' : 'פאנל במסך מלא — לעריכה של טבלאות ופרטים גדולים'} data-testid="lp-full">{lpFull ? '⤡' : '⤢'}</button>
              </div>
            )}
            {wide && lp === 'nav'
              ? <div className="nav-content" data-testid="lp-nav-content">
                  {(sel.length > 0 || s.activeConn) && <div className="sel-strip" data-testid="sel-strip"><span>נבחר: <b>{s.activeConn ?? (ms.length === 1 ? ms[0]!.label : `${sel.length} אלמנטים`)}</b> — כאן: הגדרות הרכיב כולו</span><button className="btn small" data-testid="sel-strip-props" onClick={() => setLp('sel')}>{s.activeConn ? 'חזרה לעורך החיבור' : 'חזרה לאלמנט'} ←</button></div>}
                  <NavCrumb nav={nav} item={NAV_INDEX_LABEL(nav, true)} /><NavContent nav={nav} onOpenConn={openConn} /></div>
              : <PropertiesPanel />}
    </section>}
        </aside>
      </main>

      <footer className="statusbar" data-testid="statusbar">
        <span>נבחרו: <b data-testid="status-sel">{sel.length}</b>{ms.length === 1 && <> · <b>{ms[0]!.label}</b></>}</span>
        <span>אלמנטים: <b>{s.derived.members.length}</b></span>
        {s.hidden.length > 0 && <span>מוסתרים: <b>{s.hidden.length}</b></span>}
        {!s.isolated && bigModel && <span title="במודל גדול הברגים מוצגים רק בבידוד ובאלמנט הנבחר — כדי שהתצוגה תישאר מהירה" data-testid="status-bolts-hidden">ברגים מוסתרים בסקירה (מודל גדול)</span>}
        <span>שגיאות: <b style={{ color: errs ? 'var(--err)' : undefined }}>{errs}</b> · אזהרות: <b>{warns}</b></span>
        <span className="sp" />
        <span>יחידות: <b>{u === 'm' ? 'מטר' : 'מ"מ'}</b> · מודל פנימי מ"מ</span>
        <span>X רוחב · Y אורך · Z גובה</span>
        <span className="badge warn" title="חתכים וחומרים אינם מאומתים; אין בדיקת חוזק">אינו תכן מאושר</span>
      </footer>

      <nav className="mnav">
        <button className={mtab === 'side' ? 'on' : ''} onClick={() => { setMode('model'); setMtab(sideOpen ? null : 'side'); }} data-testid="m-side"><Icon name="building" />מבנה</button>
        <button className={mode === 'model' && !mtab ? 'on' : ''} onClick={() => { setMode('model'); setMtab(null); }} data-testid="m-model"><Icon name="cube" />מודל</button>
        <button className={mtab === 'props' ? 'on' : ''} onClick={() => { setMode('model'); setMtab(propsOpen ? null : 'props'); }} data-testid="m-props"><Icon name="props" />מאפיינים{sel.length ? ` (${sel.length})` : ''}</button>
        <button className={mode === 'drawings' ? 'on' : ''} onClick={() => { setMtab(null); setMode('drawings'); }} data-testid="m-drawings"><Icon name="sheet" />שרטוטים</button>
        <button className={mode === 'production' ? 'on' : ''} onClick={() => { setMtab(null); setMode('production'); }} data-testid="m-production"><Icon name="factory" />ייצור</button>
      </nav>

      <div className="toasts" data-testid="toasts">{s.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>

      {menu && ms.length > 0 && <MarkingMenu x={menu.x} y={menu.y} title={ms.length === 1 ? (ms[0]!.id.length > 12 ? KIND_LABEL[ms[0]!.kind] : ms[0]!.id) : String(ms.length)} items={menuItems()} onClose={() => setMenu(null)} />}
      <EaveCheckDialog />
      <ConnWizard />
      <ScopeIsolator />
      <ConnLibrary />
      <DetailStudio />
      {dimEdit && (
        <input className="inp num dim-edit" autoFocus data-testid="dim-edit" defaultValue={(dimEdit.value / 1000).toFixed(3)} style={{ left: dimEdit.x, top: dimEdit.y }}
          onKeyDown={(e) => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value.replace(',', '.')); const d0 = dimEdit; setDimEdit(null); if (Number.isFinite(v)) commitDim(d0.key, v * 1000, d0.value); } if (e.key === 'Escape') setDimEdit(null); }}
          onBlur={() => setDimEdit(null)} />
      )}
      {palette && <CommandPalette cmds={cmds} onClose={() => setPalette(false)} onPickElement={pickElement} />}
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
  if (a === 'X') { const xs = store.state.derived.members.filter((m) => m.kind === 'rafter').flatMap((m) => [m.start.x, m.end.x]); return xs.length ? [Math.min(...xs) - 500, Math.max(...xs) + 500] : [-500, b.width + 500]; }
  if (a === 'Y') return [Math.min(...ys) - 500, Math.max(...ys) + 500];
  const zs = store.state.derived.members.filter((m) => m.kind === 'rafter').flatMap((m) => [m.start.z, m.end.z]);
  return [b.baseElevation, (zs.length ? Math.max(...zs) : Math.max(b.eaveLeft, b.eaveRight)) + 500];
}
function clipDefault(a: 'X' | 'Y' | 'Z') { const [lo, hi] = clipRange(a); return Math.round((lo + hi) / 2 / 50) * 50; }
