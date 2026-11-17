import { IssueList } from './IssueList';
import { DetailLibrary } from './DetailLibrary';
import { useMemo, useState, type ReactNode } from 'react';
import type { Connection, MemberKind, Severity } from '../model/types';
import { cutLength } from '../geometry/solid';
import { massPerMeter, tryProfile } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import { store, useStore } from '../store';
import { CONN_TYPE } from './ConnectionEditor';
import { ConnectionsPanel } from './Overlays';
import { RoofPanel, type RoofSection } from './RoofPanel';
import { BracePanel, StructurePanel, type BraceSection, type StructSection } from './StructurePanel';
import { MenuPic } from './pics';
import { CladdingPanel, type CladSection } from './CladdingPanel';
import { RoofTrussPanel, TransferPanel } from './TransferPanel';
import { IssuesPanel, KIND_LABEL, TreePanel } from './TreePanel';

/**
 * עץ תפריטים (החלטת משתמש 15.11.2026): בוחרים צומת בעץ ומקבלים מתחתיו את הטופס/הטבלה הרלוונטיים.
 * צומת קבוצה (מבנה, גג ופטות, אלמנטים, חיבורים, בדיקות) מציג את כל הקבוצה; צומת משני — חלק אחד בלבד.
 */
export type NavKey =
  | 'structure' | `s:${StructSection}`
  | 'roof' | `r:${RoofSection}`
  | 'tree' | `k:${MemberKind}`
  | 'conns' | `c:${Connection['type']}`
  | 'issues' | `i:${Severity}`
  | 'brace' | `b:${BraceSection}`
  | 'clad' | `w:${CladSection}` | 'b:tb' | 'b:truss' | 'special' | 'c:library';

const ORDER_C: Connection['type'][] = ['custom', 'eave', 'ridge', 'base', 'rafter-side', 'knee', 'ridge-tie', 'purlin-cleat', 'purlin-splice', 'beam-splice', 'brace-end', 'brace-cross', 'brace', 'tb-support', 'tb-seat', 'truss', 'truss-splice', 'truss-end'];
const KINDS: MemberKind[] = ['column', 'rafter', 'purlin', 'girt', 'brace', 'cleat', 'plate', 'anchor', 'beam'];
const SEV_LABEL: Record<Severity, string> = { error: 'שגיאות', warning: 'אזהרות', info: 'מידע' };

/** קבוצת העץ של מפתח (לפתיחה אוטומטית ולפירורי לחם) */
export function navGroupOf(nav: NavKey): string {
  if (nav === 'b:tb' || nav === 'b:truss' || nav === 'special') return 'special';
  if (nav === 'c:library') return 'conns';
  return nav.includes(':') ? ({ s: 'structure', r: 'roof', b: 'brace', k: 'tree', c: 'conns', i: 'issues', w: 'clad' } as Record<string, string>)[nav[0]] : nav;
}

export function SideNav({ nav, setNav, onOpenConn, treeOnly }: { nav: NavKey; setNav: (k: NavKey) => void; onOpenConn: (id: string) => void; treeOnly?: boolean }) {
  const d = useStore((s) => s.derived);
  const roofType = useStore((s) => (s.project.building.section ? 'modular' : s.project.building.roofType));
  const [open, setOpen] = useState<Record<string, boolean>>({ structure: true, roof: true, brace: true, special: true });
  const kindCount = useMemo(() => { const m = new Map<string, number>(); for (const x of d.members) m.set(x.kind, (m.get(x.kind) ?? 0) + 1); return m; }, [d]);
  const connCount = useMemo(() => { const m = new Map<string, number>(); for (const c of d.connections) m.set(c.type, (m.get(c.type) ?? 0) + 1); return m; }, [d]);
  const sevCount = useMemo(() => { const m = new Map<string, number>(); for (const i of d.issues) m.set(i.severity, (m.get(i.severity) ?? 0) + 1); return m; }, [d]);
  const errs = sevCount.get('error') ?? 0, warns = sevCount.get('warning') ?? 0;

  type Item = { key: NavKey; label: string; n?: number; cls?: string; pic: string };
  const labels = new Map<string, string>();
  const group = (key: NavKey, label: string, testId: string, pic: string, children: Item[], badge?: ReactNode) => {
    for (const c of children) labels.set(c.key, c.label);
    const isOpen = open[key] ?? false;
    const on = nav === key;
    return (
      <div className={`nav-group${isOpen ? ' open' : ''}`} key={key}>
        <div className={`nav-head${on ? ' on' : ''}`}>
          <button className="nav-chev" aria-label={isOpen ? 'כיווץ' : 'הרחבה'} onClick={() => setOpen({ ...open, [key]: !isOpen })}>{isOpen ? '▾' : '▸'}</button>
          <button className="nav-lbl" data-testid={testId} onClick={() => { setNav(key); setOpen({ ...open, [key]: true }); }}><MenuPic name={pic} size={26} /><span>{label}</span></button>
          {badge}
        </div>
        {isOpen && children.map((c) => (
          <button key={c.key} className={`nav-item${nav === c.key ? ' on' : ''}`} onClick={() => setNav(c.key)} data-testid={`nav-${c.key}`} title={c.label}>
            <MenuPic name={c.pic} /><span className="nav-t">{c.label}</span>{c.n !== undefined && <span className={`nav-n${c.cls ? ` ${c.cls}` : ''}`}>{c.n}</span>}
          </button>
        ))}
      </div>
    );
  };
  // כשנבחר פריט מקבוצה סגורה (חיפוש / קישור) — פותחים את הקבוצה שלו
  const grp = navGroupOf(nav);
  if (grp && !open[grp]) setTimeout(() => setOpen((o) => ({ ...o, [grp]: true })), 0);

  return (
    <div className={`sidenav${treeOnly ? ' tree-only' : ''}`}>
      <nav className="nav-tree" aria-label="עץ תפריטים">
        {/* סדר העבודה: 1 מבנה ← 2 גג ופטות ← 3 חיזוקים ← 4 קירות וחיפוי ← 5 מיוחדים; אחריהם — רשימות ובדיקות */}
        {group('structure', '1 · מבנה', 'tab-structure', 'geometry', [
          { key: 's:project', label: 'פרויקט והגדרות', pic: 'project' }, { key: 's:geometry', label: 'צירים, מסגרות וגבהים', pic: 'geometry' },
          { key: 's:profiles', label: 'חתכים וחומר', pic: 'profiles' },
        ])}
        {group('roof', '2 · גג ופטות', 'tab-roof', 'slope', [
          { key: 'r:system', label: 'מערכת פטות', pic: 'purlins' },
          ...(roofType === 'gable' ? [{ key: 'r:left' as NavKey, label: 'שיפוע שמאל — פטות ותושבות', pic: 'slopeL' }, { key: 'r:right' as NavKey, label: 'שיפוע ימין — פטות ותושבות', pic: 'slopeR' }] : [{ key: 'r:left' as NavKey, label: roofType === 'modular' ? 'שיפועי הגג — פטות ותושבות' : 'שיפוע הגג — פטות ותושבות', pic: 'slope' }]),
          { key: 'r:splices', label: 'חיבורי המשך פטות', n: d.splices.filter((x) => x.memberId.startsWith('PL.')).length, pic: 'splice' },
        ])}
        {group('brace', '3 · חיזוקים', 'tab-brace', 'brace0', [
          { key: 'b:knee', label: 'אלכסוני עמוד-קורה', n: connCount.get('knee') ? d.connections.filter((c) => c.id.startsWith('C.KB.')).length : undefined, pic: 'knee' },
          { key: 'b:roof', label: 'קושרות גג', pic: 'roofX' },
          { key: 'b:walls', label: 'קשיחות קירות / אגד B', pic: 'walls' },
          { key: 'b:ties', label: 'שורות קשירה לפטות', pic: 'ties' },
          { key: 'b:ridge', label: 'חיזוק רכס', pic: 'ridge' },
        ])}
        {group('clad', '4 · קירות וחיפוי', 'tab-clad', 'walls', [
          { key: 'w:roof', label: 'חיפוי גג ומזחלות', pic: 'slope' },
          { key: 'w:walls', label: 'חיפוי קירות ופטות קיר', pic: 'walls' },
          { key: 'w:openings', label: 'פתחים', n: d.members.length ? (store.state.project.building.cladding?.openings.length || undefined) : undefined, pic: 'frames' },
          { key: 'w:takeoff', label: 'כתב כמויות חיפוי', pic: 'project' },
        ])}
        {group('special', '5 · מיוחדים', 'tab-special', 'frames', [
          { key: 'b:tb', label: 'דילול עמודים — קורות נושאות', n: store.state.project.building.transfers?.length || undefined, pic: 'frames' },
          { key: 'b:truss', label: 'מסבכי גג', n: store.state.project.building.roofTruss?.enabled ? d.connections.filter((c) => c.type === 'truss' && c.id.startsWith('C.TR.')).length : undefined, pic: 'roofX' },
        ])}
        <div className="nav-sep">רשימות ובדיקה</div>
        {group('tree', 'אלמנטים', 'tab-tree', 'elements', KINDS.filter((k) => kindCount.get(k)).map((k) => ({ key: `k:${k}` as NavKey, label: KIND_LABEL[k], n: kindCount.get(k), pic: k })))}
        {group('conns', 'חיבורים', 'tab-conns', 'conns', [
          ...ORDER_C.filter((t) => connCount.get(t)).map((t) => ({ key: `c:${t}` as NavKey, label: CONN_TYPE[t], n: connCount.get(t), pic: t === 'ridge' ? 'ridge' : t === 'knee' ? 'knee' : t === 'brace' ? 'brace' : t })),
          { key: 'c:library' as NavKey, label: 'ספריית פרטים', n: store.state.project.customDetails?.length || undefined, pic: 'project' },
        ])}
        {group('issues', 'בדיקות', 'tab-issues', 'issues', (['error', 'warning', 'info'] as Severity[]).filter((s) => sevCount.get(s)).map((s) => ({ key: `i:${s}` as NavKey, label: SEV_LABEL[s], n: sevCount.get(s), cls: s === 'error' ? 'err' : s === 'warning' ? 'warn' : '', pic: s })),
          (errs + warns) > 0 ? <span className={`count ${errs ? 'err' : 'warn'}`}>{errs + warns}</span> : null)}
      </nav>
      {!treeOnly && <div className="nav-content">
        <NavCrumb nav={nav} item={labels.get(nav)} />
        <NavContent nav={nav} onOpenConn={onOpenConn} />
      </div>}
    </div>
  );
}

const GROUP_LABEL: Record<string, [string, string]> = {
  structure: ['מבנה', 'geometry'], roof: ['גג ופטות', 'slope'], brace: ['חיזוקים', 'brace0'], clad: ['קירות וחיפוי', 'walls'], special: ['מיוחדים', 'frames'], tree: ['אלמנטים', 'elements'], conns: ['חיבורים', 'conns'], issues: ['בדיקות', 'issues'],
};
/** פירורי לחם מעל התוכן: איפה אני (קבוצה › פריט) עם התמונה */
/** שם קצר לסעיף בעץ (לכותרת הפאנל). item=true — רק שם הסעיף בלי הקבוצה */
const ITEM_LABEL: Record<string, string> = {
  's:project': 'פרויקט והגדרות', 's:geometry': 'צירים, מסגרות וגבהים', 's:profiles': 'חתכים וחומר', 'r:system': 'מערכת פטות', 'r:left': 'פטות ותושבות', 'r:right': 'שיפוע ימין', 'r:splices': 'חיבורי המשך פטות',
  'b:knee': 'אלכסוני עמוד-קורה', 'b:roof': 'קושרות גג', 'b:walls': 'קשיחות קירות', 'b:ties': 'שורות קשירה', 'b:ridge': 'חיזוק רכס', 'b:tb': 'דילול עמודים', 'b:truss': 'מסבכי גג',
  'w:roof': 'חיפוי גג', 'w:walls': 'חיפוי קירות', 'w:openings': 'פתחים', 'w:takeoff': 'כמויות חיפוי', 'c:library': 'ספריית פרטים',
};
export function NAV_INDEX_LABEL(nav: NavKey, item = false): string {
  const g = GROUP_LABEL[navGroupOf(nav)]?.[0] ?? '';
  let it = ITEM_LABEL[nav];
  if (!it && nav.includes(':')) {
    const [p, k] = nav.split(':') as [string, string];
    it = p === 'k' ? KIND_LABEL[k as keyof typeof KIND_LABEL] : p === 'c' ? CONN_TYPE[k as Connection['type']] : p === 'i' ? SEV_LABEL[k as Severity] : k;
  }
  if (item) return it ?? '';
  return it ? (nav.startsWith('k:') || nav.startsWith('c:') || nav.startsWith('i:') ? `${g} · ${it}` : it) : g;
}

export function NavCrumb({ nav, item }: { nav: NavKey; item?: string }) {
  const g = navGroupOf(nav);
  const [gl, gp] = GROUP_LABEL[g] ?? ['', 'elements'];
  return <div className="nav-crumb" data-testid="nav-crumb"><MenuPic name={gp} size={22} /><span>{gl}</span>{item && <><span className="sep">›</span><b>{item}</b></>}</div>;
}

export function NavContent({ nav, onOpenConn }: { nav: NavKey; onOpenConn: (id: string) => void }) {
  if (nav === 'structure') return <StructurePanel />;
  if (nav === 'roof') return <RoofPanel />;
  if (nav === 'tree') return <TreePanel />;
  if (nav === 'conns') return <ConnectionsPanel onOpen={onOpenConn} />;
  if (nav === 'issues') return <IssuesPanel />;
  if (nav === 'brace') return <BracePanel />;
  if (nav === 'clad') return <CladdingPanel />;
  if (nav === 'special') return <><TransferPanel /><RoofTrussPanel /></>;
  if (nav === 'c:library') return <DetailLibrary />;
  const [g, k] = nav.split(':') as [string, string];
  if (g === 's') return <StructurePanel section={k as StructSection} />;
  if (g === 'r') return <RoofPanel section={k as RoofSection} />;
  if (nav === 'b:tb') return <TransferPanel />;
  if (nav === 'b:truss') return <RoofTrussPanel />;
  if (g === 'b') return <BracePanel part={k as BraceSection} />;
  if (g === 'w') return <CladdingPanel section={k as CladSection} />;
  if (g === 'k') return <ElementsTable kind={k as MemberKind} />;
  if (g === 'c') return <ConnTable type={k as Connection['type']} onOpen={onOpenConn} />;
  return <IssuesTable sev={k as Severity} />;
}

const f1 = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

/** טבלת אלמנטים מסוג אחד: לחיצה בוחרת ומתמקדת; מיון לפי עמודה. */
function ElementsTable({ kind }: { kind: MemberKind }) {
  const d = useStore((s) => s.derived);
  const sel = useStore((s) => s.selection);
  const [sort, setSort] = useState<{ k: 'id' | 'profile' | 'len' | 'kg'; dir: 1 | -1 }>({ k: 'id', dir: 1 });
  const rows = useMemo(() => d.members.filter((m) => m.kind === kind).map((m) => {
    const pr = tryProfile(m.profile);
    const len = cutLength(m).max;
    return { m, len, kg: pr ? (massPerMeter(pr, getMaterial(m.material).density) * len) / 1000 : 0 };
  }), [d, kind]);
  const sorted = [...rows].sort((a, b) => {
    const v = sort.k === 'id' ? a.m.id.localeCompare(b.m.id, 'en', { numeric: true }) : sort.k === 'profile' ? a.m.profile.localeCompare(b.m.profile) : sort.k === 'len' ? a.len - b.len : a.kg - b.kg;
    return v * sort.dir;
  });
  const selSet = new Set(sel);
  const th = (k: typeof sort.k, label: string) => <th className="sortable" onClick={() => setSort({ k, dir: sort.k === k ? (-sort.dir as 1 | -1) : 1 })}>{label}{sort.k === k ? (sort.dir > 0 ? ' ▴' : ' ▾') : ''}</th>;
  const total = rows.reduce((s, r) => s + r.kg, 0);
  return (
    <div className="panel-body" data-testid={`table-${kind}`}>
      <div className="panel-title">{KIND_LABEL[kind]} <span className="badge">{rows.length} · {f1(total, 0)} ק"ג</span></div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn small" onClick={() => store.select(rows.map((r) => r.m.id))}>בחר הכל</button>
        <button className="btn small" onClick={() => store.set({ isolated: rows.map((r) => r.m.id) })}>בודד</button>
      </div>
      <table className="tbl nav-tbl">
        <thead><tr>{th('id', 'מזהה')}{th('profile', 'חתך')}{th('len', 'אורך')}{th('kg', 'ק"ג')}</tr></thead>
        <tbody>
          {sorted.slice(0, 400).map((r) => (
            <tr key={r.m.id} className={selSet.has(r.m.id) ? 'sel' : ''} title={r.m.label}
              onClick={(e) => { store.select([r.m.id], e.ctrlKey || e.metaKey ? 'toggle' : 'replace'); setTimeout(() => window.__ksp?.viewport?.fitSelection(), 0); }}>
              <td className="n">{r.m.id}</td><td className="n">{r.m.profile}</td><td className="n">{Math.round(r.len)}</td><td className="n">{f1(r.kg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 400 && <div className="hint">מוצגים 400 ראשונים מתוך {rows.length}.</div>}
      <div className="hint">לחיצה בוחרת ומתמקדת · Ctrl מוסיף · אורך = אורך חיתוך מרבי (מ"מ)</div>
    </div>
  );
}

const STATUS: Record<string, string> = { approved: 'מאושר', 'for-review': 'לבדיקה', 'not-verified': 'לא מאומת' };

function ConnTable({ type, onOpen }: { type: Connection['type']; onOpen: (id: string) => void }) {
  const d = useStore((s) => s.derived);
  const cs = d.connections.filter((c) => c.type === type);
  const desc = (c: Connection) => d.byId.get(c.parts.find((x) => ['plate', 'cleat'].includes(d.byId.get(x)?.kind ?? '')) ?? '')?.partDesc ?? '—';
  const bolts = (c: Connection) => {
    const m = new Map<string, number>();
    for (const b of c.bolts) { const k = `M${b.d}×${b.length}`; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].map(([k, n]) => `${n}×${k}`).join(', ') || '—';
  };
  return (
    <div className="panel-body" data-testid={`ctable-${type}`}>
      <div className="panel-title">{CONN_TYPE[type]} <span className="badge">{cs.length}</span></div>
      <table className="tbl nav-tbl">
        <thead><tr><th>מזהה</th><th>חלק עיקרי</th><th>ברגים</th><th>סטטוס</th></tr></thead>
        <tbody>
          {cs.slice(0, 400).map((c) => (
            <tr key={c.id} onClick={() => onOpen(c.id)} title={c.label}>
              <td className="n">{c.id.replace(/^C\./, '')}</td><td>{desc(c)}</td><td className="n">{bolts(c)}</td>
              <td><span className={`st ${c.status === 'approved' ? 'ok' : c.status === 'for-review' ? 'warn' : 'muted'}`}>{STATUS[c.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">לחיצה פותחת בעורך החיבורים ומסמנת במודל.</div>
    </div>
  );
}

function IssuesTable({ sev }: { sev: Severity }) {
  const issues = useStore((s) => s.derived.issues).filter((i) => i.severity === sev);
  return (
    <div className="panel-body" data-testid={`itable-${sev}`}>
      <div className="panel-title">{SEV_LABEL[sev]} <span className="badge">{issues.length}</span></div>
      <IssueList issues={issues} />
    </div>
  );
}
