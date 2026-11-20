import { useEffect, useMemo, useState } from 'react';
import { setBuilding } from '../commands/commands';
import { defaultLockTruss } from '../geometry/lockTruss';
import { defaultPortal } from '../geometry/portal';
import type { LockTrussParams, PortalBraceParams } from '../model/types';
import { store, useStore } from '../store';
import { wallLineOf, wallSet, WALL_RE } from '../view/realView';
import { ComponentTable } from './ComponentTable';
import { openConnStudio } from './ComponentWindow';
import { EditCtx, ProfilePicker } from './fields';
import { ConnectionEditor } from './ConnectionEditor';
import { DetailEnds, EndCards } from './PropertiesPanel';
import { LiveView3D } from './LiveView3D';
import { LineTiesEditor, LockTrussFields, PortalFields, WallLines, WallPic, WallXShape, XConnFields } from './StructurePanel';

/**
 * 1.56: חלון קשיחות קירות במבנה האחיד: סוג → "השינויים יחולו על" (ציר / כל המודל) → 1 מיקום · 2 גיאומטריה · 3 חתך ומחברים.
 */
type WType = 'x' | 'portal' | 'truss';
type Sec = 'loc' | 'geo' | 'conn';
const TNAME: Record<WType, string> = { x: 'קושרות X', portal: 'אגד B', truss: 'מסבך נעילה' };
const TSUB: Record<WType, string> = { x: 'זוויתנים במתיחה', portal: 'קורה + שני אלכסונים', truss: 'מסבך + סיב רציף' };

function stripKeys<T extends object>(rec: Record<string, T> | undefined, keys: string[]): Record<string, T> | undefined {
  if (!rec) return rec;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec)) { const o = { ...v } as Record<string, unknown>; for (const kk of keys) delete o[kk]; if (Object.keys(o).length) out[k] = o as T; }
  return Object.keys(out).length ? out : undefined;
}

export function WallsStudio({ memberId }: { memberId?: string }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const br = p.building.bracing, w = br.walls;
  const lines = useMemo(() => [...(d.section?.lines ?? [])].sort((a, b) => a.x - b.x), [d]);
  const selId = memberId ? (d.byId.get(memberId)?.connId ? d.connById.get(d.byId.get(memberId)!.connId!)?.members.find((x) => WALL_RE.test(x)) ?? memberId : /^C\./.test(memberId) ? d.connById.get(memberId)?.members.find((x) => WALL_RE.test(x)) ?? memberId : memberId) : undefined;
  const selLine = selId ? wallLineOf(selId) : undefined;
  const [line, setLine] = useState<string>(selLine ?? lines[0]?.id ?? '');
  const [scope, setScope] = useState<'line' | 'all'>(selLine ? 'line' : 'all');
  useEffect(() => { if (selLine) { setLine(selLine); setScope('line'); } }, [selLine]);
  const [sec, setSec] = useState<Sec>('loc');
  const activeConn = useStore((s) => s.activeConn);
  useEffect(() => { if (activeConn && /^C\.(BR\.W|BB\.|LT\.)/.test(activeConn)) setSec('conn'); }, [activeConn]);
  const [whole, setWhole] = useState(false);
  const lid = scope === 'line' ? line : undefined;
  const type: WType = ((lid && w.lineType?.[lid]) ?? w.type ?? 'x') as WType;
  const lineLabel = lines.find((l) => l.id === line)?.label ?? line;
  const nOn = d.members.filter((m) => WALL_RE.test(m.id) && m.kind !== 'plate' && m.kind !== 'bolt' && m.kind !== 'cleat').length;
  const nLine = d.members.filter((m) => WALL_RE.test(m.id) && wallLineOf(m.id) === line && m.kind !== 'plate' && m.kind !== 'bolt' && m.kind !== 'cleat').length;

  const putWalls = (walls: typeof w) => store.exec(setBuilding({ bracing: { ...br, walls: { ...walls, portal: walls.portal ?? defaultPortal(), truss: walls.truss ?? defaultLockTruss() } } }));
  const setType = (k: WType) => putWalls(lid ? { ...w, enabled: true, lineType: { ...(w.lineType ?? {}), [lid]: k } } : { ...w, enabled: true, type: k, lineType: undefined });
  const portal: PortalBraceParams = { ...(w.portal ?? defaultPortal()), ...(lid ? w.linePortal?.[lid] ?? {} : {}) };
  const truss: LockTrussParams = { ...(w.truss ?? defaultLockTruss()), ...(lid ? w.lineTruss?.[lid] ?? {} : {}) };
  const setPortal = (patch: Partial<PortalBraceParams>) => putWalls(lid
    ? { ...w, linePortal: { ...(w.linePortal ?? {}), [lid]: { ...(w.linePortal?.[lid] ?? {}), ...patch } } }
    : { ...w, portal: { ...(w.portal ?? defaultPortal()), ...patch }, linePortal: stripKeys(w.linePortal, Object.keys(patch)) });
  const setTruss = (patch: Partial<LockTrussParams>) => putWalls(lid
    ? { ...w, lineTruss: { ...(w.lineTruss ?? {}), [lid]: { ...(w.lineTruss?.[lid] ?? {}), ...patch } } }
    : { ...w, truss: { ...(w.truss ?? defaultLockTruss()), ...patch }, lineTruss: stripKeys(w.lineTruss, Object.keys(patch)) });

  const set3d = useMemo(() => wallSet(p, d, { memberId: selId ?? d.members.find((m) => WALL_RE.test(m.id) && wallLineOf(m.id) === line)?.id, whole }), [p, d, selId, line, whole]);
  const conns = useMemo(() => d.connections.filter((c) => c.members.some((x) => WALL_RE.test(x) && (scope === 'all' || wallLineOf(x) === line))), [d, scope, line]);
  const groups = useMemo(() => {
    const g = new Map<string, typeof conns>();
    for (const c of conns) { const k = c.label.replace(/(ציר|מפתח|מסגרת)\s+[^\s—–-]+/g, '').replace(/\s+/g, ' ').trim(); (g.get(k) ?? g.set(k, []).get(k)!).push(c); }
    return [...g.entries()];
  }, [conns]);
  const [cg, setCg] = useState(0);

  const secs: { k: Sec; n: number; t: string; sub: string }[] = [
    { k: 'loc', n: 1, t: 'מיקום במבנה', sub: `${nOn} אלמנטים` },
    { k: 'geo', n: 2, t: 'גיאומטריה', sub: TNAME[type] },
    { k: 'conn', n: 3, t: 'חתך ומחברים', sub: type === 'x' ? w.profile : type === 'portal' ? `${portal.beam} · ${portal.brace}` : `${truss.chord} · ${truss.diag}` },
  ];
  return (
    <div className="ks" data-testid="walls-studio">
      <div className="ks-types ks-types3" role="radiogroup" aria-label="סוג קשיחות הקיר">
        {(['x', 'portal', 'truss'] as const).map((k) => (
          <button key={k} role="radio" aria-checked={w.enabled && type === k} className={`ks-type ks-type-v${w.enabled && type === k ? ' on' : ''}`} onClick={() => setType(k)} data-testid={`br-walls-${k}`}>
            <WallPic k={k} /><b>{TNAME[k]}</b><small>{TSUB[k]}</small>
          </button>
        ))}
        <label className="ks-off"><input type="checkbox" data-testid="br-walls" checked={w.enabled} onChange={(e) => putWalls({ ...w, enabled: e.target.checked })} />פעיל</label>
      </div>
      {!w.enabled && <div className="ks-empty">בחרו סוג כדי להוסיף קשיחות לקירות.</div>}
      {w.enabled && <>
        <div className="ks-scope" role="radiogroup" aria-label="השינויים יחולו על" data-testid="ks-scope">
          <span className="ks-lbl">השינויים יחולו על:</span>
          <button role="radio" aria-checked={false} disabled className="ks-sc" title="קשיחות הקיר נקבעת לכל ציר — לא למכלול בודד">המכלול שנבחר</button>
          <button role="radio" aria-checked={scope === 'line'} className={`ks-sc${scope === 'line' ? ' on' : ''}`} onClick={() => setScope('line')} data-testid="pscope-asm">כל הציר<i>{nLine}</i></button>
          {scope === 'line' && <select className="inp ks-linesel" value={line} onChange={(e) => setLine(e.target.value)} aria-label="ציר" data-testid="ks-line">{lines.map((l) => <option key={l.id} value={l.id}>ציר {l.label}</option>)}</select>}
          <button role="radio" aria-checked={scope === 'all'} className={`ks-sc${scope === 'all' ? ' on' : ''}`} onClick={() => setScope('all')} data-testid="pscope-asmall">כל המודל<i>{nOn}</i></button>
        </div>
        <div className="ks-secs" role="tablist">
          {secs.map((s) => (
            <button key={s.k} role="tab" aria-selected={sec === s.k} className={`ks-sec${sec === s.k ? ' on' : ''}`} onClick={() => setSec(s.k)} data-testid={`ks-sec-${s.k}`}>
              <span className="ks-n">{s.n}</span><span className="ks-st"><b>{s.t}</b><small>{s.sub}</small></span>
            </button>
          ))}
        </div>

        {sec === 'loc' && <div className="ks-panel" data-testid="ks-loc">
          <div className="ks-note">באילו צירים ומפתחים יש קשיחות — לחיצה על מפתח מוסיפה או מסירה. הסוג לכל ציר נקבע למעלה ("כל הציר").</div>
          <WallLines nb={p.building.frames.length - 1} />
          <details className="ks-more" open><summary>סיב רציף לאורך הציר</summary><LineTiesEditor /></details>
          <details className="ks-more" open><summary>טבלת מופעים</summary><ComponentTable match={/^(BR\.W|BB\.|LT\.)/} testId="ctab-walls" /></details>
        </div>}

        {sec === 'geo' && <div className="ks-panel ks-geo" data-testid="ks-geo">
          <LiveView3D set={set3d} rev={d} height={320} modes={<div className="seg-mini"><button className={whole ? '' : 'on'} onClick={() => setWhole(false)} data-testid="live3d-near">מפתח</button><button className={whole ? 'on' : ''} onClick={() => setWhole(true)} data-testid="live3d-far">כל הקיר</button></div>} />
          <div className="ks-dims">
            <div className="ks-note">{scope === 'line' ? `ציר ${lineLabel} בלבד` : 'כל הצירים'} — מידות על השרטוט ניתנות לעריכה בלחיצה.</div>
            <EditCtx.Provider value={{ embed: true, part: 'shape' }}>
              {type === 'portal' && <PortalFields lineId={lid} />}
              {type === 'truss' && <LockTrussFields lineId={lid} />}
              {type === 'x' && <WallXShape />}
            </EditCtx.Provider>
          </div>
        </div>}

        {sec === 'conn' && <div className="ks-panel" data-testid="ks-conn">
          {type === 'x' && <div className="field prof"><label>חתך הקושרת</label><ProfilePicker value={w.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => putWalls({ ...w, profile: v })} /></div>}
          {type === 'portal' && <>
            <div className="field prof"><label>קורת אגד</label><ProfilePicker testId="pb-beam" value={portal.beam} families={['RHS', 'SHS']} onCommit={(v) => setPortal({ beam: v })} /></div>
            <div className="field prof"><label>אלכסונים</label><ProfilePicker testId="pb-brace" value={portal.brace} families={['RHS', 'SHS', 'CHS']} onCommit={(v) => setPortal({ brace: v })} /></div>
          </>}
          {type === 'truss' && <>
            <div className="field prof"><label>סיב וחגורה</label><ProfilePicker testId="lt-chord" value={truss.chord} families={['RHS', 'SHS']} onCommit={(v) => setTruss({ chord: v })} /></div>
            <div className="field prof"><label>אלכסונים</label><ProfilePicker testId="lt-diag" value={truss.diag} families={['RHS', 'SHS', 'CHS']} onCommit={(v) => setTruss({ diag: v })} /></div>
          </>}
          <div className="ks-ends" role="tablist" aria-label="מחברים">
            {groups.map(([label, cs], i) => (
              <button key={label} role="tab" aria-selected={cg === i} className={`ks-end${cg === i ? ' on' : ''}`} onClick={() => setCg(i)} data-testid={`ks-cg-${i}`}><b>מחבר {i + 1} — {label.replace(/^(אגד B|קושרת קיר|מסבך נעילה|קשיחות)\s*[—–-]?\s*/, '') || label}</b><small>{cs.length} חיבורים</small></button>
            ))}
          </div>
          <div className="ks-endbody">
            <EditCtx.Provider value={{ embed: true, part: 'conn' }}>
              {type === 'portal' && <PortalFields lineId={lid} />}
              {type === 'truss' && <LockTrussFields lineId={lid} />}
              {type === 'x' && <XConnFields />}
            </EditCtx.Provider>
            {activeConn && /^C\.(BR\.W|BB\.|LT\.)/.test(activeConn) && <div className="ks-connedit"><ConnectionEditor /></div>}
            {selId && d.byId.get(selId) && <div className="ks-elend"><div className="ks-note">קצוות האלמנט שנבחר — פרט מוכן לכל קצה, או פרט חדש בסטודיו:</div><EndCards m={d.byId.get(selId)!} /><DetailEnds m={d.byId.get(selId)!} /></div>}
            {groups[cg] && <div className="ks-acts">
              <button className="btn" onClick={() => store.set({ connWizard: groups[cg][1][0].id })} data-testid="ks-wizard">אשף המחברים</button>
              <button className="btn" onClick={() => openConnStudio(groups[cg][1][0], d)} data-testid="ks-studio">סטודיו ✎</button>
            </div>}
          </div>
        </div>}
      </>}
    </div>
  );
}
