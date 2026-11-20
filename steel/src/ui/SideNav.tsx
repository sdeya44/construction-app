import { IssueList } from './IssueList';
import { DetailLibrary } from './DetailLibrary';
import { ParamSheet } from './ParamSheet';
import { WingPanel } from './WingPanel';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Connection, Member, MemberKind, Severity } from '../model/types';
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
import { Adv } from './fields';
import { connPlace } from './connPlace';
import { ADD_LABEL, navStatus } from './navStatus';

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
  | 'clad' | `w:${CladSection}` | 'b:tb' | 'b:truss' | 'special' | 'c:library' | 's:sheet' | 'b:wing';

const ORDER_C: Connection['type'][] = ['custom', 'eave', 'ridge', 'base', 'rafter-side', 'knee', 'ridge-tie', 'purlin-cleat', 'purlin-splice', 'beam-splice', 'brace-end', 'brace-cross', 'brace', 'tb-support', 'tb-seat', 'truss', 'truss-splice', 'truss-end'];
const KINDS: MemberKind[] = ['column', 'rafter', 'purlin', 'girt', 'brace', 'cleat', 'plate', 'anchor', 'beam'];
const SEV_LABEL: Record<Severity, string> = { error: 'שגיאות', warning: 'אזהרות', info: 'מידע' };

/** קבוצת העץ של מפתח (לפתיחה אוטומטית ולפירורי לחם) */
export function navGroupOf(nav: NavKey): string {
  if (nav === 'b:tb' || nav === 'b:truss' || nav === 'b:wing' || nav === 'special') return 'special';
  if (nav === 'c:library') return 'conns';
  return nav.includes(':') ? ({ s: 'structure', r: 'roof', b: 'brace', k: 'tree', c: 'conns', i: 'issues', w: 'clad' } as Record<string, string>)[nav[0]] : nav;
}

export function SideNav({ nav, setNav, onOpenConn, treeOnly, ribbon }: { nav: NavKey; setNav: (k: NavKey) => void; onOpenConn: (id: string) => void; treeOnly?: boolean; /** 1.54: תצוגת ריבון (מסך רחב) */ ribbon?: boolean }) {
  const d = useStore((s) => s.derived);
  const roofType = useStore((s) => (s.project.building.section ? 'modular' : s.project.building.roofType));
  const [open, setOpen] = useState<Record<string, boolean>>({ structure: true, roof: true, brace: true, special: true });
  const kindCount = useMemo(() => { const m = new Map<string, number>(); for (const x of d.members) m.set(x.kind, (m.get(x.kind) ?? 0) + 1); return m; }, [d]);
  const connCount = useMemo(() => { const m = new Map<string, number>(); for (const c of d.connections) m.set(c.type, (m.get(c.type) ?? 0) + 1); return m; }, [d]);
  const sevCount = useMemo(() => { const m = new Map<string, number>(); for (const i of d.issues) m.set(i.severity, (m.get(i.severity) ?? 0) + 1); return m; }, [d]);
  const errs = sevCount.get('error') ?? 0, warns = sevCount.get('warning') ?? 0;

  type Item = { key: NavKey; label: string; n?: number; cls?: string; pic: string };
  const labels = new Map<string, string>();
  const proj = useStore((s) => s.project);
  const stat = useMemo(() => navStatus(proj, d), [proj, d]);
  /** רכיבים שלא קיימים בפרויקט — לשורת "+ הוסף רכיב" (הפריט הפתוח כרגע נשאר בעץ) */
  const hiddenKey = (k: string) => !!stat[k]?.off && nav !== k;
  const addKeys: string[] = [];
  const group = (key: NavKey, label: string, testId: string, pic: string, children: Item[], badge?: ReactNode) => {
    for (const c of children) labels.set(c.key, c.label);
    const isOpen = open[key] ?? false;
    const on = nav === key;
    if (children.length && children.every((c) => hiddenKey(c.key)) && nav !== key) { addKeys.push(...children.map((c) => c.key)); return null; }
    return (
      <div className={`nav-group${isOpen ? ' open' : ''}`} key={key}>
        <div className={`nav-head${on ? ' on' : ''}`}>
          <button className="nav-chev" aria-label={isOpen ? 'כיווץ' : 'הרחבה'} onClick={() => setOpen({ ...open, [key]: !isOpen })}>{isOpen ? '▾' : '▸'}</button>
          <button className="nav-lbl" data-testid={testId} onClick={() => { setNav(key); setOpen({ ...open, [key]: true }); }}><MenuPic name={pic} size={26} /><span>{label}</span></button>
          {badge}
        </div>
        {isOpen && children.map((c) => {
          if (hiddenKey(c.key)) { addKeys.push(c.key); return null; }
          const st = stat[c.key];
          const n = c.n ?? st?.n;
          return (
          <button key={c.key} className={`nav-item${nav === c.key ? ' on' : ''}${st?.v ? ' two' : ''}`} onClick={() => setNav(c.key)} data-testid={`nav-${c.key}`} title={st?.v ? `${c.label} — ${st.v}` : c.label}>
            <MenuPic name={c.pic} /><span className="nav-t">{c.label}{st?.v && <small className="nav-v" data-testid={`nav-v-${c.key}`}>{st.v}</small>}</span>
            {st?.err ? <span className="nav-n err">⚠ {st.err}</span> : st?.warn ? <span className="nav-n warn">⚠ {st.warn}</span> : n !== undefined ? <span className={`nav-n${c.cls ? ` ${c.cls}` : ''}`}>{n}</span> : null}
          </button>
        ); })}
      </div>
    );
  };
  // כשנבחר פריט מקבוצה סגורה (חיפוש / קישור) — פותחים את הקבוצה שלו
  const grp = navGroupOf(nav);
  if (grp && !open[grp]) setTimeout(() => setOpen((o) => ({ ...o, [grp]: true })), 0);

  // קבוצות העץ / לשוניות הריבון — מקור אחד (1.54)
  type G = { key: NavKey; label: string; tab: string; testId: string; pic: string; items: Item[]; badge?: ReactNode; list?: boolean };
  const G: G[] = [
    { key: 'structure', label: '1 · מבנה', tab: 'מבנה', testId: 'tab-structure', pic: 'geometry', items: [
      { key: 's:sheet', label: 'גיליון פרמטרים — הכל בטבלה', pic: 'project' },
      { key: 's:project', label: 'פרויקט והגדרות', pic: 'project' }, { key: 's:geometry', label: 'צירים, מסגרות וגבהים', pic: 'geometry' },
      { key: 's:profiles', label: 'חתכים וחומר', pic: 'profiles' },
    ] },
    { key: 'roof', label: '2 · גג ופטות', tab: 'גג ופטות', testId: 'tab-roof', pic: 'slope', items: [
      ...(roofType === 'gable' ? [{ key: 'r:left' as NavKey, label: 'שיפוע שמאל — פטות ותושבות', pic: 'slopeL' }, { key: 'r:right' as NavKey, label: 'שיפוע ימין — פטות ותושבות', pic: 'slopeR' }] : [{ key: 'r:left' as NavKey, label: roofType === 'modular' ? 'שיפועי הגג — פטות ותושבות' : 'שיפוע הגג — פטות ותושבות', pic: 'slope' }]),
      { key: 'r:splices', label: 'חיבורי המשך פטות', n: d.splices.filter((x) => x.memberId.startsWith('PL.')).length, pic: 'splice' },
    ] },
    { key: 'brace', label: '3 · חיזוקים', tab: 'חיזוקים', testId: 'tab-brace', pic: 'brace0', items: [
      { key: 'b:knee', label: 'אלכסוני עמוד-קורה', n: connCount.get('knee') ? d.connections.filter((c) => c.id.startsWith('C.KB.')).length : undefined, pic: 'knee' },
      { key: 'b:roof', label: 'קושרות גג', pic: 'roofX' },
      { key: 'b:walls', label: 'קשיחות קירות', pic: 'walls' },
      { key: 'b:ties', label: 'פטות: קשירה, מוטות, תמיכה', pic: 'ties' },
      { key: 'b:ridge', label: 'חיזוק רכס', pic: 'ridge' },
    ] },
    { key: 'clad', label: '4 · קירות וחיפוי', tab: 'קירות וחיפוי', testId: 'tab-clad', pic: 'walls', items: [
      { key: 'w:roof', label: 'חיפוי גג ומזחלות', pic: 'slope' },
      { key: 'w:walls', label: 'חיפוי קירות ופטות קיר', pic: 'walls' },
      { key: 'w:openings', label: 'פתחים', n: d.members.length ? (store.state.project.building.cladding?.openings.length || undefined) : undefined, pic: 'frames' },
      { key: 'w:takeoff', label: 'כתב כמויות חיפוי', pic: 'project' },
    ] },
    { key: 'special', label: '5 · מיוחדים', tab: 'רכיבים מיוחדים', testId: 'tab-special', pic: 'frames', items: [
      { key: 'b:tb', label: 'דילול עמודים — קורות נושאות', n: store.state.project.building.transfers?.length || undefined, pic: 'frames' },
      { key: 'b:wing', label: 'כנף — סככת L', n: store.state.project.building.wing?.enabled ? 1 : undefined, pic: 'geometry' },
      { key: 'b:truss', label: 'מסבכי גג', n: store.state.project.building.roofTruss?.enabled ? d.connections.filter((c) => c.type === 'truss' && c.id.startsWith('C.TR.')).length : undefined, pic: 'roofX' },
    ] },
    { key: 'tree', label: 'אלמנטים', tab: 'אלמנטים', testId: 'tab-tree', pic: 'elements', list: true, items: KINDS.filter((k) => kindCount.get(k)).map((k) => ({ key: `k:${k}` as NavKey, label: KIND_LABEL[k], n: kindCount.get(k), pic: k })) },
    { key: 'conns', label: 'חיבורים', tab: 'חיבורים', testId: 'tab-conns', pic: 'conns', list: true, items: [
      ...ORDER_C.filter((t) => connCount.get(t)).map((t) => ({ key: `c:${t}` as NavKey, label: CONN_TYPE[t], n: connCount.get(t), pic: t === 'ridge' ? 'ridge' : t === 'knee' ? 'knee' : t === 'brace' ? 'brace' : t })),
      { key: 'c:library' as NavKey, label: 'ספריית פרטים', n: store.state.project.customDetails?.length || undefined, pic: 'project' },
    ] },
    { key: 'issues', label: 'בדיקות', tab: 'בדיקות', testId: 'tab-issues', pic: 'issues', list: true, items: (['error', 'warning', 'info'] as Severity[]).filter((s) => sevCount.get(s)).map((s) => ({ key: `i:${s}` as NavKey, label: SEV_LABEL[s], n: sevCount.get(s), cls: s === 'error' ? 'err' : s === 'warning' ? 'warn' : '', pic: s })),
      badge: (errs + warns) > 0 ? <span className={`count ${errs ? 'err' : 'warn'}`}>{errs + warns}</span> : null },
  ];
  if (ribbon) return <Ribbon groups={G} nav={nav} setNav={setNav} stat={stat} />;

  return (
    <div className={`sidenav${treeOnly ? ' tree-only' : ''}`}>
      <nav className="nav-tree" aria-label="עץ תפריטים">
        {/* סדר העבודה: 1 מבנה ← 2 גג ופטות ← 3 חיזוקים ← 4 קירות וחיפוי ← 5 מיוחדים; אחריהם — רשימות ובדיקות */}
        {G.filter((g) => !g.list).map((g) => group(g.key, g.label, g.testId, g.pic, g.items, g.badge))}
        {(() => { const keys = [...new Set(addKeys)].filter((k) => k !== 'w:walls' && k !== 'w:openings' && k !== 'w:takeoff'); return keys.length > 0 && (
          <div className="nav-add" data-testid="nav-add"><span className="nav-add-t">+ הוסף רכיב</span>
            {keys.map((k) => <button key={k} className="nav-add-b" data-testid={`nav-${k}`} onClick={() => { setNav(k as NavKey); const g = navGroupOf(k as NavKey); setOpen((o) => ({ ...o, [g]: true })); }}>{ADD_LABEL[k] ?? k}</button>)}
          </div>); })()}
        <div className="nav-sep">רשימות ובדיקה</div>
        {G.filter((g) => g.list).map((g) => group(g.key, g.label, g.testId, g.pic, g.items, g.badge))}
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
  's:sheet': 'גיליון פרמטרים', 's:project': 'פרויקט והגדרות', 's:geometry': 'צירים, מסגרות וגבהים', 's:profiles': 'חתכים וחומר', 'r:system': 'מערכת פטות', 'r:left': 'פטות ותושבות', 'r:right': 'שיפוע ימין', 'r:splices': 'חיבורי המשך פטות',
  'b:knee': 'אלכסוני עמוד-קורה', 'b:roof': 'קושרות גג', 'b:walls': 'קשיחות קירות', 'b:ties': 'שורות קשירה', 'b:ridge': 'חיזוק רכס', 'b:tb': 'דילול עמודים', 'b:truss': 'מסבכי גג', 'b:wing': 'כנף (L)',
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
  if (nav === 'special') return <><TransferPanel /><RoofTrussPanel /><WingPanel /></>;
  if (nav === 'c:library') return <DetailLibrary />;
  if (nav === 's:sheet') return <ParamSheet />;
  const [g, k] = nav.split(':') as [string, string];
  if (g === 's') return <StructurePanel section={k as StructSection} />;
  if (g === 'r') return <RoofPanel section={k as RoofSection} />;
  if (nav === 'b:tb') return <TransferPanel />;
  if (nav === 'b:truss') return <RoofTrussPanel />;
  if (nav === 'b:wing') return <WingPanel />;
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
  const frames = [...store.state.project.building.frames].sort((a, b) => a.y - b.y);
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
        <thead><tr>{th('id', 'מיקום')}{th('profile', 'חתך')}{th('len', 'אורך')}{th('kg', 'ק"ג')}</tr></thead>
        <tbody>
          {sorted.slice(0, 400).map((r) => (
            <tr key={r.m.id} className={selSet.has(r.m.id) ? 'sel' : ''} title={r.m.label}
              onClick={(e) => { store.select([r.m.id], e.ctrlKey || e.metaKey ? 'toggle' : 'replace'); setTimeout(() => window.__ksp?.viewport?.fitSelection(), 0); }}>
              <td><div>{memberPlace(r.m, d.section?.lines, frames)}</div><div className="n muted">{r.m.id}</div></td><td className="n">{r.m.profile}</td><td className="n">{Math.round(r.len)}</td><td className="n">{f1(r.kg)}</td>
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

/** מיקום קריא של אלמנט: "מסגרת 3 · ציר א" */
function memberPlace(m: Member, lines: { id: string; label: string }[] | undefined, fr: { id: string; y: number }[]): string {
  const out: string[] = [];
  if (m.frameId) { const i = fr.findIndex((f) => f.id === m.frameId); if (i >= 0) out.push(`מסגרת ${i + 1}`); }
  const lid = m.lineId ?? m.id.match(/\.COL\.([^.]+)$/)?.[1];
  if (lid) out.push(`ציר ${lines?.find((q) => q.id === lid)?.label ?? lid}`);
  if (m.purlin) out.push(`פטה ${m.purlin.index}`);
  return out.join(' · ') || m.label;
}

function ConnTable({ type, onOpen }: { type: Connection['type']; onOpen: (id: string) => void }) {
  const d = useStore((s) => s.derived);
  const frames = useStore((s) => s.project.building.frames);
  const cs = d.connections.filter((c) => c.type === type);
  const desc = (c: Connection) => d.byId.get(c.parts.find((x) => ['plate', 'cleat'].includes(d.byId.get(x)?.kind ?? '')) ?? '')?.partDesc ?? '—';
  const bolts = (c: Connection) => {
    const m = new Map<string, number>();
    for (const b of c.bolts) { const k = `M${b.d}×${b.length}`; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].map(([k, n]) => `${n}×${k}`).join(', ') || '—';
  };
  // קיבוץ לפי סוג החלק והברגים (1.34): כרטיס לכל וריאנט — במקום מאות שורות זהות
  const groups = new Map<string, Connection[]>();
  for (const c of cs) { const k = `${desc(c)}|${bolts(c)}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const variants = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const st = { approved: 0, 'for-review': 0, 'not-verified': 0 } as Record<string, number>;
  for (const c of cs) st[c.status]++;
  const mark = (list: Connection[]) => { store.select(list.flatMap((c) => c.parts.filter((x) => d.byId.has(x)))); setTimeout(() => window.__ksp?.viewport?.fitSelection(), 0); };
  return (
    <div className="panel-body" data-testid={`ctable-${type}`}>
      <div className="panel-title">{CONN_TYPE[type]} <span className="badge">{cs.length}</span></div>
      <div className="conn-status-sum">
        {st.approved > 0 && <span className="st ok">{st.approved} מאושר</span>}
        {st['for-review'] > 0 && <span className="st warn">{st['for-review']} לבדיקה</span>}
        {st['not-verified'] > 0 && <span className="st muted">{st['not-verified'] === cs.length ? 'כולם' : st['not-verified']} לא מאומת</span>}
      </div>
      <div className="conn-variants" data-testid={`cvariants-${type}`}>
        {variants.map(([k, list], i) => (
          <div className="conn-var" key={k} data-testid={`cvar-${type}-${i}`}>
            <div className="conn-var-h"><b>{list.length}×</b><span>{desc(list[0])}</span></div>
            <div className="conn-var-b">ברגים: <span className="n">{bolts(list[0])}</span></div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn small primary" data-testid={`cvar-open-${type}-${i}`} onClick={() => onOpen(list[0].id)}>עריכה</button>
              <button className="btn small" onClick={() => mark(list)}>סמן במודל ({list.length})</button>
            </div>
          </div>
        ))}
      </div>
      <Adv id={`ctbl-${type}`} label={`רשימה מלאה (${cs.length})`}>
        <table className="tbl nav-tbl">
          <thead><tr><th>מיקום</th><th>חלק / ברגים</th><th>סטטוס</th></tr></thead>
          <tbody>
            {cs.slice(0, 400).map((c) => (
              <tr key={c.id} onClick={() => onOpen(c.id)} title={c.id}>
                <td>{connPlace(c, d, frames)}</td><td><div>{desc(c)}</div><div className="n muted">{bolts(c)}</div></td>
                <td><span className={`st ${c.status === 'approved' ? 'ok' : c.status === 'for-review' ? 'warn' : 'muted'}`}>{STATUS[c.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Adv>
      <div className="hint">"עריכה" פותחת דוגמה בעורך — שינוי בשרטוט שם חל על כל החיבורים מהסוג. "סמן במודל" מסמן את כל החיבורים בקבוצה.</div>
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

/**
 * ריבון לפי תחומים (1.54, עיצוב מחדש): לשונית לכל קבוצה, כלים עם ציור ושם, ערך ומצב לכל כלי.
 * אותם מפתחות nav ואותם עורכים כמו בעץ — רק פריסה אחרת. ניתן לכיווץ (לשוניות בלבד).
 */
function Ribbon({ groups, nav, setNav, stat }: {
  groups: { key: NavKey; tab: string; testId: string; pic: string; items: { key: NavKey; label: string; n?: number; cls?: string; pic: string }[]; badge?: ReactNode }[];
  nav: NavKey; setNav: (k: NavKey) => void; stat: Record<string, { v?: string; n?: number; warn?: number; err?: number; off?: boolean }>;
}) {
  const navGrp = navGroupOf(nav);
  const [tab, setTab] = useState<string>(navGrp || 'structure');
  useEffect(() => { if (navGrp) setTab(navGrp); }, [navGrp]);
  const [open, setOpenS] = useState(() => { try { return localStorage.getItem('ksp-ribbon') !== '0'; } catch { return true; } });
  const setOpen = (v: boolean) => { setOpenS(v); try { localStorage.setItem('ksp-ribbon', v ? '1' : '0'); } catch { /* */ } setTimeout(() => window.dispatchEvent(new Event('resize')), 30); };
  const g = groups.find((x) => x.key === tab) ?? groups[0];
  return (
    <div className={`ribbon${open ? '' : ' closed'}`} data-testid="ribbon">
      <div className="rb-tabs" role="tablist" aria-label="תחומי עבודה">
        {groups.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === g.key} className={`rb-tab${x.key === g.key ? ' on' : ''}`} data-testid={x.testId}
            onClick={() => { setTab(x.key); setNav(x.key); if (!open) setOpen(true); }}>{x.tab}{x.badge}</button>
        ))}
        <span className="rb-sp" />
        <button className="rb-collapse" data-testid="ribbon-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▴ כווץ ריבון' : '▾ הצג כלים'}</button>
      </div>
      {open && (
        <div className="rb-tools" role="toolbar" aria-label={g.tab}>
          {g.items.map((c) => {
            const st = stat[c.key];
            const n = c.n ?? st?.n;
            return (
              <button key={c.key} className={`rb-tool${nav === c.key ? ' on' : ''}${st?.off ? ' off' : ''}`} data-testid={`nav-${c.key}`} title={st?.v ? `${c.label} — ${st.v}` : c.label} onClick={() => setNav(c.key)}>
                <MenuPic name={c.pic} size={26} />
                <span className="rb-l">{st?.off ? '+ ' : ''}{c.label.split(' — ')[0]}</span>
                {st?.v ? <small className="rb-v" data-testid={`nav-v-${c.key}`}>{st.v}</small> : null}
                {st?.err ? <i className="rb-b err">⚠ {st.err}</i> : st?.warn ? <i className="rb-b warn">⚠ {st.warn}</i> : n !== undefined ? <i className={`rb-b${c.cls ? ` ${c.cls}` : ''}`}>{n}</i> : null}
              </button>
            );
          })}
          {!g.items.length && <span className="hint" style={{ alignSelf: 'center' }}>אין פריטים בתחום הזה</span>}
        </div>
      )}
    </div>
  );
}
