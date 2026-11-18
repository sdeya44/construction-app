import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Connection, Member } from '../model/types';
import { store, useStore } from '../store';
import type { Viewport } from '../view/viewport';
import { CONN_TYPE, SectionSvg } from './ConnectionEditor';
import { Icon } from './icons';
import { fabFor } from '../fab/useFab';
import { OmitDialog } from './TransferPanel';
import { kindLabelOf } from './TreePanel';
import { connPlace } from './connPlace';


/** פקודה בלוח הפקודות / בתפריט. keys = קיצור מקלדת להצגה. */
export interface Cmd { id: string; label: string; group: string; keys?: string; search?: string; run: () => void; disabled?: boolean; danger?: boolean; icon?: string }

const STATUS: Record<string, string> = { approved: 'מאושר', 'for-review': 'לבדיקה', 'not-verified': 'לא מאומת' };
const statusCls = (s: string) => (s === 'approved' ? 'ok' : s === 'for-review' ? 'warn' : 'muted');

/** החיבורים שאלמנט משתתף בהם (כאלמנט ראשי או כחלק חיבור). */
export function connectionsOf(m: Member, conns: Connection[], byId: Map<string, Connection>): Connection[] {
  if (m.connId) { const c = byId.get(m.connId); return c ? [c] : []; }
  return conns.filter((c) => c.members.includes(m.id) || c.parts.includes(m.id));
}

/** סדר עדיפות להצגה בכרטיס: חיבורים "מבניים" לפני זוויתני פטות. */
const ORDER: Record<string, number> = { eave: 0, ridge: 1, base: 2, 'purlin-splice': 3, 'brace-end': 4, 'brace-cross': 5, 'purlin-cleat': 6, brace: 7 };

// ---------------------------------------------------------------- סרגל הקשרי
export function ContextBar({ vp, onMore }: { vp: Viewport | null; onMore: (x: number, y: number) => void; onOpenConn: (id: string) => void }) {
  const sel = useStore((s) => s.selection);
  const d = useStore((s) => s.derived);
  const tool = useStore((s) => s.tool);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [omit, setOmit] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!vp) return;
    const upd = () => {
      const b = vp.selectionScreenBox();
      if (!b) { setPos(null); return; }
      const W = vp.host.clientWidth, H = vp.host.clientHeight;
      // רצועה עליונה קבועה (מעל המודל, לא מסתירה אותו); אופקית — מעל מרכז הבחירה
      const w = ref.current?.offsetWidth ?? 360;
      let x = (b.x0 + b.x1) / 2 - w / 2;
      x = Math.max(8, Math.min(W - w - 8, x));
      const y = W < 700 ? H - 120 : 58;
      void H;
      setPos((p) => (p && Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5 ? p : { x, y }));
    };
    vp.frameListeners.add(upd);
    upd();
    return () => { vp.frameListeners.delete(upd); };
  }, [vp, sel, d]);

  const ms = sel.map((id) => d.byId.get(id)).filter((m): m is Member => !!m);
  if (omit) return <OmitDialog columnIds={omit} onClose={() => setOmit(null)} />;
  if (!ms.length || !pos || tool !== 'select') return null;
  const single = ms.length === 1 ? ms[0] : null;
  const similar = () => {
    const keys = new Set(ms.map((m) => `${m.kind}|${m.profile}`));
    store.select(d.members.filter((m) => keys.has(`${m.kind}|${m.profile}`)).map((m) => m.id));
  };
  return (
    <div className="ctxbar" ref={ref} role="toolbar" aria-label="סרגל הקשרי" data-testid="ctxbar" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      <span className="ctx-title">{single ? <><b>{kindLabelOf(single)}</b> <span className="mono">{single.id}</span></> : <b data-testid="ctx-count">{ms.length} נבחרו</b>}</span>
      <span className="ctx-hint">עריכה בפאנל המאפיינים ←</span>
      <span className="ctx-sep" />
      {!single && <button className="ctx-btn" onClick={similar} data-testid="ctx-similar">בחר דומים</button>}
      {ms.some((m) => m.kind === 'column') && <button className="ctx-btn pri" data-testid="ctx-omit" title="ביטול העמודים שנבחרו והחלפתם בקורה נושאת בין העמודים שנותרו" onClick={() => setOmit(ms.filter((m) => m.kind === 'column').map((m) => m.id))}>בטל עמודים</button>}
      <button className="ctx-btn" onClick={() => store.set({ isolated: [...sel] })}>בודד</button>
      {single && <button className="ctx-btn" data-testid="ctx-isolate-asm" title="הצג רק את המכלול (החלק הראשי והחלקים המרותכים אליו) והברגים שלו" onClick={() => {
        const st = store.state, { fab } = fabFor(st.project, st.derived);
        const pt = fab.parts.find((x) => x.memberId === single.id);
        const asm = pt && fab.assemblies.find((a) => a.id === pt.assembly);
        if (!asm) return;
        const ids = new Set(asm.parts.map((pid) => fab.byPart.get(pid)?.memberId).filter((x): x is string => !!x));
        for (const c of st.derived.connections) for (const b of c.bolts) if (b.holesIn.some((h) => ids.has(h))) for (const sfx of ['', '.H', '.S', '.N']) ids.add(`${b.id}${sfx}`);
        store.set({ isolated: [...ids], selection: [single.id] });
        store.toast('info', `מכלול ${asm.mark}: ${asm.parts.length} חלקים`);
      }}>בודד מכלול</button>}
      {single && <button className="ctx-btn" data-testid="ctx-hide-kind" title="הסתרת כל האלמנטים מסוג זה (שכבות — הצג הכל)" onClick={() => store.set({ hidden: [...new Set([...store.state.hidden, ...d.members.filter((m) => m.kind === single.kind && (single.kind !== 'brace' || m.id.slice(0, 4) === single.id.slice(0, 4))).map((m) => m.id)])], selection: [] })}>הסתר סוג</button>}
      <button className="ctx-btn" onClick={() => store.set({ hidden: [...new Set([...store.state.hidden, ...sel])], selection: [] })}>הסתר</button>
      <button className="ctx-btn icon" aria-label="עוד פעולות" title="עוד פעולות (לחיצה ימנית)" data-testid="ctx-more"
        onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMore(r.left + r.width / 2, r.bottom + 120); }}><Icon name="more" /></button>
    </div>
  );
}

// ---------------------------------------------------------------- כרטיס פרט חיבור
export function ConnCard({ onOpen }: { onOpen: (id: string) => void }) {
  const sel = useStore((s) => s.selection);
  const d = useStore((s) => s.derived);
  const active = useStore((s) => s.activeConn);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [sel]);
  // מקופל לתג קטן כברירת מחדל (לא מכסה את המודל); נשמר בין בחירות
  const [expanded, setExpandedS] = useState(() => { try { return localStorage.getItem('ksp-cc-open') === '1'; } catch { return false; } });
  const setExpanded = (v: boolean) => { setExpandedS(v); try { localStorage.setItem('ksp-cc-open', v ? '1' : '0'); } catch { /* */ } };
  const m = sel.length === 1 ? d.byId.get(sel[0]) : undefined;
  const conns = useMemo(() => (m ? connectionsOf(m, d.connections, d.connById).sort((a, b) => ORDER[a.type] - ORDER[b.type]) : []), [m, d]);
  if (!m || !conns.length || active) return null;
  const c = conns[Math.min(i, conns.length - 1)];
  const main = c.parts.map((x) => d.byId.get(x)).find((x) => x && (x.kind === 'plate' || x.kind === 'cleat'));
  const agg = new Map<string, number>();
  for (const b of c.bolts) { const k = `M${b.d} · ${b.grade} · ${b.location === 'site' ? 'שטח' : 'מסגריה'}`; agg.set(k, (agg.get(k) ?? 0) + 1); }
  const shop = c.welds.filter((w) => w.location === 'shop').length, site = c.welds.length - shop;
  if (!expanded) return (
    <button className="conncard-tag" onClick={() => setExpanded(true)} data-testid="conncard-tag" title="פרט החיבור של האלמנט — לחיצה לפתיחה">
      🔩 {CONN_TYPE[c.type]}{conns.length > 1 ? ` (+${conns.length - 1})` : ''} ›
    </button>
  );
  return (
    <aside className="conncard" aria-label="פרט חיבור של האלמנט" data-testid="conncard">
      <div className="cc-body">
        <div className="cc-top">
          <span className="eyebrow">פרט חיבור {conns.length > 1 ? `· ${Math.min(i, conns.length - 1) + 1}/${conns.length}` : ''}</span>
          <button className="cc-min" aria-label="כיווץ לתג" title="כיווץ לתג" onClick={() => setExpanded(false)} data-testid="cc-min">–</button>
          {conns.length > 1 && <span className="cc-nav">
            <button aria-label="הקודם" onClick={() => setI((i - 1 + conns.length) % conns.length)}>‹</button>
            <button aria-label="הבא" data-testid="cc-next" onClick={() => setI((i + 1) % conns.length)}>›</button>
          </span>}
        </div>
        <b className="cc-title" data-testid="cc-title">{CONN_TYPE[c.type]}</b>
        <dl className="cc-kv">
          {main && <><dt>{main.kind === 'cleat' ? 'זוויתן' : 'פלטה'}</dt><dd>{main.partDesc}</dd></>}
          {[...agg].map(([k, n]) => <Fragment key={k}><dt>ברגים</dt><dd className="mono">{n} × {k}</dd></Fragment>)}
          {c.welds.length > 0 && <><dt>ריתוכים</dt><dd>{shop ? `${shop} במסגריה` : ''}{shop && site ? ' · ' : ''}{site ? <span className="warn-t">{site} בשטח</span> : ''}</dd></>}
          <dt>סטטוס</dt><dd><span className={`st ${statusCls(c.status)}`}>{STATUS[c.status]}</span></dd>
        </dl>
        <button className="cc-open" onClick={() => onOpen(c.id)} data-testid="cc-open">פתח בעורך החיבורים ←</button>
      </div>
      {(c.type === 'purlin-cleat' || c.type === 'eave' || c.type === 'ridge' || c.type === 'base') && <div className="cc-svg"><SectionSvg c={c} /></div>}
    </aside>
  );
}

// ---------------------------------------------------------------- תפריט מעגלי
const DIRS = [[0, -1], [0.72, -0.72], [1, 0], [0.72, 0.72], [0, 1], [-0.72, 0.72], [-1, 0], [-0.72, -0.72]];
export function MarkingMenu({ x, y, items, title, onClose }: { x: number; y: number; items: Cmd[]; title: string; onClose: () => void }) {
  const R = 92;
  const cx = Math.max(R + 60, Math.min(window.innerWidth - R - 60, x)), cy = Math.max(R + 30, Math.min(window.innerHeight - R - 30, y));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="mm-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onContextMenu={(e) => { e.preventDefault(); onClose(); }} data-testid="marking-menu">
      <div className="mm" style={{ left: cx, top: cy }} role="menu" aria-label="תפריט מעגלי">
        <div className="mm-ring" />
        <div className="mm-center">{title}</div>
        {items.slice(0, 8).map((it, i) => (
          <button key={it.id} role="menuitem" className={`mm-item${it.danger ? ' danger' : ''}`} disabled={it.disabled} data-testid={`mm-${it.id}`}
            style={{ left: DIRS[i][0] * R, top: DIRS[i][1] * R }} onClick={() => { onClose(); it.run(); }}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- לוח פקודות
export function CommandPalette({ cmds, onClose, onPickElement }: { cmds: Cmd[]; onClose: () => void; onPickElement: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const d = useStore((s) => s.derived);
  const listRef = useRef<HTMLDivElement>(null);
  const norm = (s: string) => s.toLowerCase().replace(/[\s'"׳״.\-_]/g, '');
  const nq = norm(q);
  // חיפוש לפי מילים (כל מילה צריכה להופיע), עם סובלנות לסיומות עבריות: "גבהים" ← "גבה", "תחתיות" ← "תחתי"
  const stem = (w: string) => (w.length >= 4 ? w.replace(/(ים|ות|יות|ה|ת|י)$/, '') : w);
  const toks = q.toLowerCase().split(/[\s,]+/).map((w) => w.replace(/['"׳״.\-_]/g, '')).filter(Boolean);
  const hay = (c: Cmd) => norm(`${c.label} ${c.group} ${c.search ?? ''}`);
  // דירוג: התאמה רציפה בשם (0) ← בקבוצה/מילות חיפוש (1) ← כל המילים בנפרד (2)
  const rank = (c: Cmd): number => {
    if (c.disabled) return -1;
    if (!nq) return 0;
    if (norm(c.label).includes(nq)) return 0;
    if (norm(c.group).includes(nq) || (c.search && nq.length >= 2 && norm(c.search).includes(nq))) return 1;
    const h = hay(c);
    return toks.length > 0 && toks.every((w) => h.includes(w) || (stem(w).length >= 3 && h.includes(stem(w)))) ? 2 : -1;
  };
  const cmdHits = cmds.map((c, i) => ({ c, r: rank(c), i })).filter((x) => x.r >= 0).sort((a1, b1) => a1.r - b1.r || a1.i - b1.i).map((x) => x.c);
  const elHits = nq.length >= 2
    ? d.members.filter((m) => m.kind !== 'bolt' && (norm(m.id).includes(nq) || norm(m.label).includes(nq) || norm(m.profile).includes(nq))).slice(0, 8)
    : [];
  const rows: ({ k: 'cmd'; c: Cmd } | { k: 'el'; m: Member })[] = [...cmdHits.slice(0, 14).map((c) => ({ k: 'cmd' as const, c })), ...elHits.map((m) => ({ k: 'el' as const, m }))];
  useEffect(() => setI(0), [q]);
  useLayoutEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const run = (r: (typeof rows)[number]) => { onClose(); if (r.k === 'cmd') r.c.run(); else onPickElement(r.m.id); };
  let lastGroup = '';
  return (
    <div className="overlay cmdk-ov" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-label="לוח פקודות" data-testid="cmdk">
        <div className="cmdk-head">
          <Icon name="search" />
          <input autoFocus value={q} placeholder="פקודה, אלמנט, חתך…" aria-label="חיפוש פקודה או אלמנט" data-testid="cmdk-input"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(rows.length - 1, x + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (rows[i]) run(rows[i]); }
              else if (e.key === 'Escape') onClose();
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {!rows.length && <div className="cmdk-empty">אין תוצאות</div>}
          {rows.map((r, k) => {
            const g = r.k === 'cmd' ? r.c.group : 'אלמנטים';
            const head = g !== lastGroup ? <div className="cmdk-group" key={`g${g}`}>{g}</div> : null;
            lastGroup = g;
            return [head, (
              <div key={r.k === 'cmd' ? r.c.id : r.m.id} className={`cmdk-row${k === i ? ' on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => run(r)}
                data-testid={r.k === 'cmd' ? `cmdk-${r.c.id}` : `cmdk-el-${r.m.id}`}>
                {r.k === 'cmd'
                  ? <><span>{r.c.label}</span>{r.c.keys && <kbd>{r.c.keys}</kbd>}</>
                  : <><span>{r.m.label}</span><span className="mono muted">{r.m.id} · {r.m.profile}</span></>}
              </div>
            )];
          })}
        </div>
        <div className="cmdk-foot">↑↓ ניווט · Enter ביצוע · הקיצור מוצג כדי שבפעם הבאה לא יהיה צורך בלוח</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- רשימת חיבורים (לשונית)
export function ConnectionsPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const d = useStore((s) => s.derived);
  const frames = useStore((s) => s.project.building.frames);
  const [open, setOpen] = useState<string | null>(null);
  const groups = new Map<string, Connection[]>();
  for (const c of d.connections) groups.set(c.type, [...(groups.get(c.type) ?? []), c]);
  const types = [...groups.keys()].sort((a, b) => ORDER[a] - ORDER[b]);
  return (
    <div className="panel-body" data-testid="conns-panel">
      <div className="panel-title">חיבורים במודל <span className="badge">{d.connections.length}</span></div>
      {types.map((t) => {
        const cs = groups.get(t)!;
        const st = { approved: 0, 'for-review': 0, 'not-verified': 0 } as Record<string, number>;
        for (const c of cs) st[c.status]++;
        return (
          <div className="tree-group" key={t}>
            <div className="tree-head" onClick={() => setOpen(open === t ? null : t)} data-testid={`conns-${t}`}>
              <span>{open === t ? '▾' : '▸'}</span><span>{CONN_TYPE[t as Connection['type']]}</span>
              <span className="badge" style={{ marginInlineStart: 'auto' }}>{cs.length}</span>
              {st.approved > 0 && <span className="badge ok">{st.approved} ✓</span>}
            </div>
            {open === t && cs.slice(0, 200).map((c) => (
              <div key={c.id} className="tree-item" onClick={() => onOpen(c.id)} title={c.id}>
                <span>{connPlace(c, d, frames)}</span>
                <span className={`st ${statusCls(c.status)}`} style={{ marginInlineStart: 'auto' }}>{STATUS[c.status]}</span>
              </div>
            ))}
          </div>
        );
      })}
      <div className="hint">לחיצה פותחת את החיבור בעורך ומסמנת את חלקיו במודל. עיקרון: ריתוך במסגריה, גלוון, הרכבה בברגים בשטח.</div>
    </div>
  );
}
