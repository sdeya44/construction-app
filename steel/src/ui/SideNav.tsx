import { IssueList } from './IssueList';
import { useMemo, useState, type ReactNode } from 'react';
import type { Connection, MemberKind, Severity } from '../model/types';
import { cutLength } from '../geometry/solid';
import { massPerMeter, tryProfile } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import { store, useStore } from '../store';
import { CONN_TYPE } from './ConnectionEditor';
import { ConnectionsPanel } from './Overlays';
import { RoofPanel, type RoofSection } from './RoofPanel';
import { StructurePanel, type StructSection } from './StructurePanel';
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
  | 'issues' | `i:${Severity}`;

const ORDER_C: Connection['type'][] = ['eave', 'ridge', 'base', 'purlin-cleat', 'purlin-splice', 'brace-end', 'brace-cross', 'brace'];
const KINDS: MemberKind[] = ['column', 'rafter', 'purlin', 'brace', 'cleat', 'plate', 'anchor', 'beam'];
const SEV_LABEL: Record<Severity, string> = { error: 'שגיאות', warning: 'אזהרות', info: 'מידע' };

export function SideNav({ nav, setNav, onOpenConn }: { nav: NavKey; setNav: (k: NavKey) => void; onOpenConn: (id: string) => void }) {
  const d = useStore((s) => s.derived);
  const roofType = useStore((s) => s.project.building.roofType);
  const [open, setOpen] = useState<Record<string, boolean>>({ structure: true, roof: true });
  const kindCount = useMemo(() => { const m = new Map<string, number>(); for (const x of d.members) m.set(x.kind, (m.get(x.kind) ?? 0) + 1); return m; }, [d]);
  const connCount = useMemo(() => { const m = new Map<string, number>(); for (const c of d.connections) m.set(c.type, (m.get(c.type) ?? 0) + 1); return m; }, [d]);
  const sevCount = useMemo(() => { const m = new Map<string, number>(); for (const i of d.issues) m.set(i.severity, (m.get(i.severity) ?? 0) + 1); return m; }, [d]);
  const errs = sevCount.get('error') ?? 0, warns = sevCount.get('warning') ?? 0;

  const group = (key: NavKey, label: string, testId: string, children: { key: NavKey; label: string; n?: number; cls?: string }[], badge?: ReactNode) => {
    const isOpen = open[key] ?? false;
    const on = nav === key;
    return (
      <div className="nav-group" key={key}>
        <div className={`nav-head${on ? ' on' : ''}`}>
          <button className="nav-chev" aria-label={isOpen ? 'כיווץ' : 'הרחבה'} onClick={() => setOpen({ ...open, [key]: !isOpen })}>{isOpen ? '▾' : '▸'}</button>
          <button className="nav-lbl" data-testid={testId} onClick={() => { setNav(key); setOpen({ ...open, [key]: true }); }}>{label}</button>
          {badge}
        </div>
        {isOpen && children.map((c) => (
          <button key={c.key} className={`nav-item${nav === c.key ? ' on' : ''}`} onClick={() => setNav(c.key)} data-testid={`nav-${c.key}`}>
            <span>{c.label}</span>{c.n !== undefined && <span className={`nav-n${c.cls ? ` ${c.cls}` : ''}`}>{c.n}</span>}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="sidenav">
      <nav className="nav-tree" aria-label="עץ תפריטים">
        {group('structure', 'מבנה', 'tab-structure', [
          { key: 's:project', label: 'פרטי פרויקט והגדרות' }, { key: 's:geometry', label: 'גיאומטריה' }, { key: 's:profiles', label: 'חתכים וחומר' },
          { key: 's:frames', label: 'מסגרות', n: d.grid.filter((g) => g.dir === 'Y').length }, { key: 's:bracing', label: 'קושרות ושורות קשירה' },
        ])}
        {group('roof', 'גג ופטות', 'tab-roof', [
          { key: 'r:system', label: 'מערכת פטות' },
          ...(roofType === 'gable' ? [{ key: 'r:left' as NavKey, label: 'שיפוע שמאל' }, { key: 'r:right' as NavKey, label: 'שיפוע ימין' }] : [{ key: 'r:left' as NavKey, label: 'שיפוע הגג' }]),
          { key: 'r:splices', label: 'חיבורי המשך', n: d.splices.filter((x) => x.memberId.startsWith('PL.')).length },
        ])}
        {group('tree', 'אלמנטים', 'tab-tree', KINDS.filter((k) => kindCount.get(k)).map((k) => ({ key: `k:${k}` as NavKey, label: KIND_LABEL[k], n: kindCount.get(k) })))}
        {group('conns', 'חיבורים', 'tab-conns', ORDER_C.filter((t) => connCount.get(t)).map((t) => ({ key: `c:${t}` as NavKey, label: CONN_TYPE[t], n: connCount.get(t) })))}
        {group('issues', 'בדיקות', 'tab-issues', (['error', 'warning', 'info'] as Severity[]).filter((s) => sevCount.get(s)).map((s) => ({ key: `i:${s}` as NavKey, label: SEV_LABEL[s], n: sevCount.get(s), cls: s === 'error' ? 'err' : s === 'warning' ? 'warn' : '' })),
          (errs + warns) > 0 ? <span className={`count ${errs ? 'err' : 'warn'}`}>{errs + warns}</span> : null)}
      </nav>
      <div className="nav-content">
        <NavContent nav={nav} onOpenConn={onOpenConn} />
      </div>
    </div>
  );
}

function NavContent({ nav, onOpenConn }: { nav: NavKey; onOpenConn: (id: string) => void }) {
  if (nav === 'structure') return <StructurePanel />;
  if (nav === 'roof') return <RoofPanel />;
  if (nav === 'tree') return <TreePanel />;
  if (nav === 'conns') return <ConnectionsPanel onOpen={onOpenConn} />;
  if (nav === 'issues') return <IssuesPanel />;
  const [g, k] = nav.split(':') as [string, string];
  if (g === 's') return <StructurePanel section={k as StructSection} />;
  if (g === 'r') return <RoofPanel section={k as RoofSection} />;
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
