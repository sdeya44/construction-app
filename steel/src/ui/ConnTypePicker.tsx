import { createContext, useContext, useState, type ReactNode } from 'react';
import { assignDetail, setCleat, setCleatEverywhere, withDetailCleared } from '../commands/commands';
import { effCleat } from '../geometry/connections';
import { detailPresets, similarSites } from '../geometry/detail';
import type { CleatParams, CustomDetail } from '../model/types';
import { store, useStore } from '../store';

/**
 * בחירת סוג חיבור בכרטיסים: סוגים מובנים + פרטים מהספרייה + "פרט חדש בסטודיו".
 * אם אין סוג מתאים — הסטודיו בונה אותו, והוא מצטרף לרשימה.
 */
type Style = NonNullable<CleatParams['style']>;
const CLEAT_ICON: Record<Style, ReactNode> = {
  run: <><path d="M4 22h24" /><path d="M8 22V8h3v11h14v3" fill="currentColor" fillOpacity=".15" /><circle cx="9.5" cy="12" r="1.2" /><circle cx="9.5" cy="16" r="1.2" /></>,
  stand: <><path d="M4 26h24" /><path d="M11 26V6h4v20M15 26h8v-3h-8" fill="currentColor" fillOpacity=".15" /><circle cx="13" cy="11" r="1.3" /><circle cx="13" cy="19" r="1.3" /></>,
  plate: <><path d="M4 26h24" /><rect x="9" y="6" width="4" height="20" fill="currentColor" fillOpacity=".15" /><path d="M13 26V9l10 17z" fill="currentColor" fillOpacity=".3" /><circle cx="11" cy="11" r="1.3" /><circle cx="11" cy="19" r="1.3" /></>,
};
const CLEAT_NAME: Record<Style, [string, string]> = {
  run: ['זוויתן שוכב', 'L לאורך הפטה, ברגים לרוחב'],
  stand: ['זוויתן עומד L40×40', 'רגל מוברגת לווב, 2 חורים אנכיים'],
  plate: ['פלטה + משולש תמיכה', 'פלטה אנכית לווב, משולש מאחור'],
};

export function TypeCard({ on, icon, title, sub, onClick, testId }: { on: boolean; icon?: ReactNode; title: string; sub?: string; onClick: () => void; testId?: string }) {
  return (
    <button className={`type-card${on ? ' on' : ''}`} onClick={onClick} data-testid={testId} aria-pressed={on}>
      {icon && <svg viewBox="0 0 32 32">{icon}</svg>}
      <span><b>{title}</b>{sub && <small>{sub}</small>}</span>
    </button>
  );
}

/** פאנל האלמנט מעביר את מזהה חיבור התושבת שנבחרה לבורר שמוטמע בהגדרות הגג */
export const CleatHubCtx = createContext<string | undefined>(undefined);

/** תושבת פטה: סוג התושבת (לתושבת אחת / לשיפוע / לכולן), תושבת תפר, פרטים מהספרייה וסטודיו */
export function CleatTypePicker({ connId: connId0, side: side0 }: { connId?: string; side?: string }) {
  const ctxConn = useContext(CleatHubCtx);
  const connId = connId0 ?? ctxConn;
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const c0 = connId ? d.connById.get(connId) : undefined;
  // תושבת שהוחלפה בפרט מותאם — החיבור הוא custom, והאתר שמור בו
  const customSite = c0?.type === 'custom' ? c0.custom?.site : undefined;
  const c = c0?.type === 'purlin-cleat' ? c0 : undefined;
  const pur = c ? d.byId.get(c.members[0]) : customSite ? d.byId.get(customSite.slice(0, customSite.lastIndexOf('|'))) : undefined;
  const side = side0 ?? pur?.purlin?.paramKey ?? (pur?.purlin?.side === 'R' ? 'right' : 'left');
  const cleatId = c ? c.parts[0] : customSite ? `CL.${pur?.id}.${customSite.split('|x:')[1]}` : undefined;
  const frame = c ? c.id.split('.').pop()! : undefined;
  const siteKeyCur = pur && frame ? `${pur.id}|x:${frame}` : customSite;
  const [scope, setScope] = useState<'one' | 'side' | 'all'>(connId ? 'one' : 'side');
  const cl = effCleat(p, side, cleatId ?? '');
  const style: Style = cl.style ?? 'run';
  const assigned = siteKeyCur ? p.detailAssign?.[siteKeyCur] : undefined;
  const lib = (p.customDetails ?? []).filter((x) => x.family === 'cleat' || Object.entries(p.detailAssign ?? {}).some(([k, v]) => v === x.id && k.includes('|x:')));
  const presets = detailPresets().filter((x) => x.family === 'cleat');
  const allCleatKeys = () => similarSites(d.members, siteKeyCur ?? anyKey(), false, d.connections);
  const anyKey = () => { const cc = d.connections.find((x) => x.type === 'purlin-cleat'); return cc ? `${cc.members[0]}|x:${cc.id.split('.').pop()}` : ''; };
  const keysFor = (): string[] => {
    const all = allCleatKeys();
    if (scope === 'one') return siteKeyCur ? [siteKeyCur] : [];
    if (scope === 'all') return all;
    return all.filter((k) => { const m = d.byId.get(k.slice(0, k.lastIndexOf('|'))); return (m?.purlin?.paramKey ?? (m?.purlin?.side === 'R' ? 'right' : 'left')) === side; });
  };
  const pickStyle = (st: Style) => {
    const keys = keysFor();
    const inner = scope === 'one' && cleatId ? setCleat(side, { style: st }, cleatId) : scope === 'side' ? setCleat(side, { style: st }) : setCleatEverywhere({ style: st });
    store.exec(withDetailCleared(keys, inner, `סוג תושבת: ${CLEAT_NAME[st][0]}`));
  };
  const pickDetail = (det: CustomDetail, copy: boolean) => {
    const dd = copy ? { ...structuredClone(det), id: `cd-${Date.now().toString(36)}` } : det;
    const keys = keysFor();
    if (keys.length) store.exec(assignDetail(keys, dd));
  };
  const openStudio = () => { const k = siteKeyCur ?? anyKey(); if (k) store.set({ detailStudio: k }); };
  return (
    <div className="type-pick" data-testid="cleat-type">
      <div className="hub-set-h">סוג התושבת</div>
      <div className="seg scope-seg">
        {connId && <button className={`tbtn${scope === 'one' ? ' on' : ''}`} onClick={() => setScope('one')} data-testid="ct-scope-one">תושבת זו</button>}
        <button className={`tbtn${scope === 'side' ? ' on' : ''}`} onClick={() => setScope('side')} data-testid="ct-scope-side">כל השיפוע</button>
        <button className={`tbtn${scope === 'all' ? ' on' : ''}`} onClick={() => setScope('all')} data-testid="ct-scope-all">כל התושבות</button>
      </div>
      <div className="type-grid">
        {(['run', 'stand', 'plate'] as Style[]).map((st) => <TypeCard key={st} on={!assigned && style === st} icon={CLEAT_ICON[st]} title={CLEAT_NAME[st][0]} sub={CLEAT_NAME[st][1]} onClick={() => pickStyle(st)} testId={`ct-${st}`} />)}
        {lib.map((x) => <TypeCard key={x.id} on={assigned === x.id} title={x.name} sub="פרט מהספרייה" onClick={() => pickDetail(x, false)} testId={`ct-lib-${x.id}`} />)}
        {presets.filter((x) => !lib.some((l) => l.name === x.name)).map((x) => <TypeCard key={x.id} on={false} title={x.name} sub="פרט מוכן — לעריכה בסטודיו" onClick={() => pickDetail(x, true)} testId={`ct-preset-${x.id}`} />)}
        <TypeCard on={false} title="＋ פרט חדש בסטודיו…" sub="אין סוג מתאים? בונים ושומרים — והוא יופיע כאן" onClick={openStudio} testId="ct-studio" />
      </div>
      <label className="ss-radio" style={{ marginTop: 4 }}>
        <input type="checkbox" checked={!!cl.spliceCleat} data-testid="ct-splice" onChange={(e) => store.exec(scope === 'all' || scope === 'one' ? setCleatEverywhere({ spliceCleat: e.target.checked }, 'תושבת בתפר פטה') : setCleat(side, { spliceCleat: e.target.checked }))} />
        בתפר פטה מעל התומך: פלטה + משולש עם 4 חורים (2 לכל פטה) במקום פלטת המשך
      </label>
      {assigned && <div className="hint">התושבת הזו מוחלפת בפרט מהספרייה. <button className="btn small" onClick={openStudio}>עריכה בסטודיו</button></div>}
    </div>
  );
}

/** קצה אלמנט: פרט רגיל / פרט מהספרייה / חדש בסטודיו */
export function EndTypePicker({ memberId, end }: { memberId: string; end: 'start' | 'end' }) {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const key = `${memberId}|${end}`;
  const assigned = p.detailAssign?.[key];
  const lib = (p.customDetails ?? []).filter((x) => x.family !== 'cleat' && !Object.entries(p.detailAssign ?? {}).some(([k, v]) => v === x.id && k.includes('|x:')));
  const presets = detailPresets().filter((x) => x.family !== 'cleat');
  const [all, setAll] = useState(false);
  const sim = all ? similarSites(d.members, key, true, d.connections) : [key];
  const regular = d.connections.find((c) => c.type !== 'custom' && (c.members.includes(memberId) || c.parts.includes(memberId)));
  // מצב מקופל: שורה אחת עם הפרט הנוכחי; הכרטיסים נפתחים בלחיצה
  const [open, setOpen] = useState(false);
  const cur = assigned ? (p.customDetails ?? []).find((x) => x.id === assigned)?.name ?? 'פרט מותאם' : 'פרט רגיל';
  if (!open) return (
    <div className="type-pick compact" data-testid={`end-type-${end}`}>
      <button className="btn small" onClick={() => setOpen(true)} data-testid={`et-${end}-open`} title="בחירת סוג חיבור אחר / פרט מהספרייה / סטודיו">{cur} · שינוי ▾</button>
      <button className="btn small" onClick={() => store.set({ detailStudio: key })} data-testid={`studio-${end}`} title="בניית פרט חדש או עריכת הפרט בסטודיו">{assigned ? '✎ סטודיו' : '＋ סטודיו'}</button>
    </div>
  );
  return (
    <div className="type-pick" data-testid={`end-type-${end}`}>
      <button className="btn small link-btn" onClick={() => setOpen(false)} style={{ marginBottom: 6 }}>▴ סגירה</button>
      <div className="type-grid">
        <TypeCard on={!assigned} title="פרט רגיל" sub={regular ? regular.label.split(' ').slice(0, 3).join(' ') : 'לפי הגדרות התוכנה'} onClick={() => store.exec(withDetailCleared(sim, null, 'חזרה לפרט הרגיל'))} testId={`et-${end}-regular`} />
        {lib.map((x) => <TypeCard key={x.id} on={assigned === x.id} title={x.name} sub="מהספרייה" onClick={() => store.exec(assignDetail(sim, x))} testId={`et-${end}-lib-${x.id}`} />)}
        {presets.filter((x) => !lib.some((l) => l.name === x.name)).map((x) => <TypeCard key={x.id} on={false} title={x.name} sub="פרט מוכן" onClick={() => store.exec(assignDetail(sim, { ...structuredClone(x), id: `cd-${Date.now().toString(36)}` }))} testId={`et-${end}-preset-${x.id}`} />)}
        <TypeCard on={false} title={assigned ? '✎ עריכה בסטודיו' : '＋ פרט חדש בסטודיו…'} sub="בונים פרט מחלקים ושומרים לספרייה" onClick={() => store.set({ detailStudio: key })} testId={`studio-${end}`} />
      </div>
      <label className="ss-radio"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid={`et-${end}-all`} /> להחיל גם על כל הקצוות הדומים{all ? ` (${sim.length})` : ''}</label>
    </div>
  );
}
