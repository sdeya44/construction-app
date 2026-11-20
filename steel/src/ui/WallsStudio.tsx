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
import { DetailEnds, EndCards } from './PropertiesPanel';
import { LiveView3D } from './LiveView3D';
import { LockedDims } from './wizard/LockedDims';
import { ConnView } from './wizard/ConnView';
import { LineTiesEditor, LockTrussFields, PortalFields, WallLines, WallPic, WallXShape, XConnFields } from './StructurePanel';
import { WizardNavigation, WizardScopeSelector, WizardSection, WizardTypeSelector, WizardValidation, wizardClip, wizardCopy, type WzSec } from './wizard/Wizard';

/**
 * 1.56: חלון קשיחות קירות במבנה האחיד: סוג → "השינויים יחולו על" (ציר / כל המודל) → 1 מיקום · 2 גיאומטריה · 3 חתך ומחברים.
 */
type WType = 'x' | 'portal' | 'truss';
type Sec = WzSec;
type WCopy = { type: WType; portal: PortalBraceParams; truss: LockTrussParams; profile: string };
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

  // הדגשה כתומה במודל של מה שהשינוי יחול עליו (ציר / כל המודל) + המחברים שלו
  const scopeIds = useMemo(() => {
    const own = d.members.filter((m) => WALL_RE.test(m.id) && (scope === 'all' || wallLineOf(m.id) === line)).map((m) => m.id);
    const S = new Set(own);
    const parts = d.connections.filter((c) => c.members.some((x) => S.has(x))).flatMap((c) => c.parts);
    return [...own, ...parts];
  }, [d, scope, line]);
  useEffect(() => { store.set({ scopeHi: w.enabled ? scopeIds : null }); }, [scopeIds, w.enabled]);
  useEffect(() => () => { store.set({ scopeHi: null }); }, []);
  const issues = useMemo(() => d.issues.filter((i) => /^(C\.)?(BR\.W|BB\.|LT\.)/.test(i.elementId ?? '') || ['TIE_PORTAL', 'TIE_TRUSS'].includes(i.code)), [d]);
  // העתקת הגדרות: סוג + פרמטרים של הציר (או הכללי) — הדבקה לציר אחר / לכל המודל
  const copyNow = () => wizardCopy('walls', { type, portal, truss, profile: w.profile } as WCopy);
  const clipNow = wizardClip<WCopy>('walls');
  const paste = () => {
    const c = wizardClip<WCopy>('walls'); if (!c) return;
    if (lid) putWalls({ ...w, enabled: true, lineType: { ...(w.lineType ?? {}), [lid]: c.type }, linePortal: { ...(w.linePortal ?? {}), [lid]: c.portal }, lineTruss: { ...(w.lineTruss ?? {}), [lid]: c.truss } });
    else putWalls({ ...w, enabled: true, type: c.type, lineType: undefined, portal: c.portal, truss: c.truss, linePortal: undefined, lineTruss: undefined, profile: c.profile });
  };
  return (
    <div className="ks" data-testid="walls-studio">
      <WizardTypeSelector label="סוג קשיחות הקיר" value={w.enabled ? type : null} onPick={setType}
        types={(['x', 'portal', 'truss'] as const).map((k) => ({ key: k, title: TNAME[k], sub: TSUB[k], pic: <WallPic k={k} />, testId: `br-walls-${k}` }))}
        extra={<label className="ks-off"><input type="checkbox" data-testid="br-walls" checked={w.enabled} onChange={(e) => putWalls({ ...w, enabled: e.target.checked })} />פעיל</label>} />
      {!w.enabled && <div className="ks-empty">בחרו סוג כדי להוסיף קשיחות לקירות.</div>}
      {w.enabled && <>
        <WizardScopeSelector<'one' | 'line' | 'all'> value={scope} onPick={(k) => k !== 'one' && setScope(k)}
          scopes={[
            { key: 'one', title: 'המכלול שנבחר', disabled: 'קשיחות הקיר נקבעת לכל ציר — לא למכלול בודד (המנוע אינו שומר הגדרה למכלול)' },
            { key: 'line', title: 'כל הציר', count: nLine, testId: 'pscope-asm' },
            { key: 'all', title: 'כל המודל', count: nOn, testId: 'pscope-asmall' },
          ]}
          after={scope === 'line' ? <select className="inp ks-linesel" value={line} onChange={(e) => setLine(e.target.value)} aria-label="ציר" data-testid="ks-line">{lines.map((l) => <option key={l.id} value={l.id}>ציר {l.label}</option>)}</select> : undefined}
          note={<>{scopeIds.length} אלמנטים וחלקים — מודגשים בכתום · <button className="wz-link" onClick={copyNow} data-testid="wz-copy">העתקת הגדרות</button>{clipNow && <> · <button className="wz-link" onClick={paste} data-testid="wz-paste">הדבקה {scope === 'line' ? `לציר ${lineLabel}` : 'לכל המודל'}</button></>}</>} />
        <WizardNavigation value={sec} onPick={setSec} subs={{ loc: `${nOn} אלמנטים`, geo: TNAME[type], conn: type === 'x' ? w.profile : type === 'portal' ? `${portal.beam} · ${portal.brace}` : `${truss.chord} · ${truss.diag}` }} />
        <WizardValidation issues={issues} />

        {sec === 'loc' && <WizardSection id="loc">
          <div className="ks-note">באילו צירים ומפתחים יש קשיחות — לחיצה על מפתח מוסיפה או מסירה. הסוג לכל ציר נקבע למעלה ("כל הציר").</div>
          <WallLines nb={p.building.frames.length - 1} />
          <details className="ks-more" open><summary>סיב רציף לאורך הציר</summary><LineTiesEditor /></details>
          <details className="ks-more" open><summary>טבלת מופעים</summary><ComponentTable match={/^(BR\.W|BB\.|LT\.)/} testId="ctab-walls" /></details>
        </WizardSection>}

        {sec === 'geo' && <WizardSection id="geo" className="ks-geo">
          <LiveView3D set={set3d} rev={d} height={320} modes={<div className="seg-mini"><button className={whole ? '' : 'on'} onClick={() => setWhole(false)} data-testid="live3d-near">מפתח</button><button className={whole ? 'on' : ''} onClick={() => setWhole(true)} data-testid="live3d-far">כל הקיר</button></div>} />
          <div className="ks-dims">
            <div className="ks-note">{scope === 'line' ? `ציר ${lineLabel} בלבד` : 'כל הצירים'} — מידות על השרטוט ניתנות לעריכה בלחיצה.</div>
            <EditCtx.Provider value={{ embed: true, part: 'shape' }}>
              {type === 'portal' && <PortalFields lineId={lid} />}
              {type === 'truss' && <LockTrussFields lineId={lid} />}
              {type === 'x' && <WallXShape />}
            </EditCtx.Provider>
            {/* 1.60: אלכסוני אגד B — שתי מידות קובעות את השאר */}
            {type === 'portal' && <LockedDims v={portal.drop} ang={portal.angle} testPre="pb-ld" onCommit={(v, a) => setPortal({ drop: v, angle: a })}
              labels={{ v: { t: portal.invert ? 'עלייה על העמוד' : 'ירידה על העמוד', sub: 'מקורת האגד לנקודת החיבור בעמוד' }, h: { t: 'אופקי', sub: 'מציר העמוד לנקודת החיבור בקורה' }, ang: { t: 'זווית', sub: 'מהאופק' }, L: { t: 'אורך צירי', sub: 'בין נקודות העבודה' } }} />}
          </div>
        </WizardSection>}

        {sec === 'conn' && <WizardSection id="conn">
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
            {selId && d.byId.get(selId) && <div className="ks-elend"><div className="ks-note">קצוות האלמנט שנבחר — פרט מוכן לכל קצה, או פרט חדש בסטודיו:</div><EndCards m={d.byId.get(selId)!} /><DetailEnds m={d.byId.get(selId)!} /></div>}
            {groups[cg] && <div className="ks-acts">
              <button className="btn" onClick={() => store.set({ connWizard: groups[cg][1][0].id })} data-testid="ks-wizard">אשף המחברים</button>
              <button className="btn" onClick={() => openConnStudio(groups[cg][1][0], d)} data-testid="ks-studio">סטודיו ✎</button>
            </div>}
            {groups[cg] && <ConnView connId={groups[cg][1][0].id} />}
          </div>
        </WizardSection>}
      </>}
    </div>
  );
}
