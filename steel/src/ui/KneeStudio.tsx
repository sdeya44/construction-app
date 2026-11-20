import { useEffect, useMemo, useState } from 'react';
import { resetOverrides, setBuilding, setKneeBraces, setMemberProps } from '../commands/commands';
import { defaultHaunch } from '../geometry/haunch';
import { defaultKneeBraces, kneeDetail } from '../geometry/knee';
import { kneeKeyOf, measureKnee, solveKnee, type KDim, type KMeas } from '../geometry/kneeSolve';
import type { KneeSideOverride } from '../model/types';
import { tryProfile } from '../profiles/library';
import { store, useStore } from '../store';
import { kneeSet, type RealTag } from '../view/realView';
import { DetailTiles } from './DetailPicker';
import { BoltSelect, EditCtx, NumField, ProfilePicker } from './fields';
import { LiveView3D, LockIc } from './LiveView3D';
import { HaunchEditor, KneePic, KneeSides } from './SectionEditor';
import { DetailEnds, EndCards } from './PropertiesPanel';

/**
 * 1.56: חלון אלכסונים — במבנה אחיד לכל הרכיבים:
 *   סוג (אלכסון עמוד-קורה / מכפל — אחד מהם) → "השינוי יחול על" → שלושה כפתורים:
 *   1 מיקום במבנה · 2 גיאומטריה (תמונה ריאלית + 6 מידות, שתיים קובעות) · 3 חתך ומחברים.
 */
type Scope = 'one' | 'loc' | 'all';
type Sec = 'loc' | 'geo' | 'conn';
const DIM: Record<KDim, { t: string; sub: string; unit: string }> = {
  v: { t: 'אנכי', sub: 'מתחתית הקורה לנקודת המגע בעמוד', unit: 'מ"מ' },
  h: { t: 'אופקי', sub: 'מציר העמוד לנקודת המגע בקורה', unit: 'מ"מ' },
  ang: { t: 'זווית', sub: 'מהאופק', unit: '°' },
  face: { t: 'בין נקודות המגע', sub: 'מפני העמוד לפני הקורה', unit: 'מ"מ' },
  ax: { t: 'מידה צירית', sub: 'בין צירי העמוד והקורה', unit: 'מ"מ' },
  L: { t: 'אורך האלכסון', sub: 'אורך חיתוך', unit: 'מ"מ' },
};
const ORDER: KDim[] = ['v', 'h', 'ang', 'face', 'ax', 'L'];
const fmt = (k: KDim, v: number) => (k === 'ang' ? v.toFixed(1) : String(Math.round(v)));

export function KneeStudio({ memberId }: { memberId?: string }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const kb = p.building.kneeBraces ?? defaultKneeBraces();
  const hp = p.building.haunch ?? { ...defaultHaunch(), enabled: false };
  const type: 'knee' | 'haunch' | 'none' = kb.enabled ? 'knee' : hp.enabled ? 'haunch' : 'none';
  const kbs = useMemo(() => d.members.filter((m) => /^KB\./.test(m.id) && m.kind === 'brace'), [d]);
  // האלכסון שנבחר (גם מפלטה/בורג שלו) — אחרת הראשון
  const selKb = memberId ? (/^KB\./.test(memberId) ? memberId.split('.').slice(0, 5).join('.') : /^C\.KB\./.test(memberId) ? memberId.slice(2).split('.').slice(0, 5).join('.') : d.byId.get(memberId)?.connId?.slice(2).split('.').slice(0, 5).join('.')) : undefined;
  const ref = (selKb && d.byId.has(selKb) ? selKb : kbs[0]?.id) ?? null;
  const key = ref ? kneeKeyOf(ref) : null;
  const atKey = kbs.filter((m) => key && kneeKeyOf(m.id) === key).length;
  const [scope, setScope] = useState<Scope>(selKb ? 'loc' : 'all');
  useEffect(() => { setScope(selKb ? 'loc' : 'all'); }, [selKb]);
  const [sec, setSec] = useState<Sec>('geo');
  // עורך חיבור פתוח (מכרטיס החיבור במודל) — ישר ל"חתך ומחברים"
  const activeConn = useStore((s) => s.activeConn);
  useEffect(() => { if (activeConn && /^C\.KB\./.test(activeConn)) setSec('conn'); }, [activeConn]);
  const ov: KneeSideOverride | undefined = key ? kb.sides?.[key] : undefined;
  const mode = (scope === 'loc' ? ov?.mode : undefined) ?? kb.mode ?? 'angle';
  const [locks, setLocks] = useState<KDim[]>(() => (mode === 'reach' ? ['v', 'h'] : ['v', 'ang']));
  const meas = useMemo(() => (ref ? measureKnee(d, ref) : null), [d, ref]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const setType = (t: 'knee' | 'haunch' | 'none') => store.exec(setBuilding({
    kneeBraces: { ...kb, enabled: t === 'knee' },
    haunch: { ...hp, enabled: t === 'haunch' },
  }));
  const toggleLock = (k: KDim) => setLocks((L) => (L.includes(k) ? (L.length > 1 ? L : L) : [L[L.length - 1], k]));
  // שינוי מידה: המידה הזו + המידה הקובעת השנייה ⇒ ירידה וזווית (פתרון על המודל)
  const commit = (k: KDim, v: number) => {
    if (!ref || !meas || !Number.isFinite(v)) return;
    if (scope === 'one') { setMsg('מידות לאלכסון בודד — דרך "כל האלכסונים במיקום הזה"'); return; }
    const L2 = locks.includes(k) ? locks : [locks[locks.length - 1], k];
    setLocks(L2);
    const other = L2.find((x) => x !== k)!;
    const targets: Partial<KMeas> = { [k]: v, [other]: meas[other] };
    setBusy(true); setMsg(null);
    setTimeout(() => {
      const r = solveKnee(store.state.project, ref, targets, scope === 'loc' ? key! : undefined);
      setBusy(false);
      if (!r) { setMsg('אין אלכסון שעונה על שתי המידות האלה — נסו ערך אחר או מידה קובעת אחרת'); return; }
      if (scope === 'loc') store.exec(setKneeBraces({ sides: { ...(kb.sides ?? {}), [key!]: { ...(kb.sides?.[key!] ?? {}), mode: 'angle', drop: r.drop, angle: r.angle } } }));
      else {
        // כל המודל: גובר על מידות שהוגדרו קודם למיקומים
        const sides = Object.fromEntries(Object.entries(kb.sides ?? {}).map(([kk, o]) => { const { drop: _d, angle: _a, reach: _r, mode: _m, ...rest } = o; void _d; void _a; void _r; void _m; return [kk, rest]; }).filter(([, o]) => Object.keys(o as object).length));
        store.exec(setKneeBraces({ mode: 'angle', drop: r.drop, angle: r.angle, sides }));
      }
    }, 20);
  };

  // תמונה ריאלית: הצומת עם 6 מידות (2 קובעות — מנעול סגור)
  const set3d = useMemo(() => {
    if (!ref) return null;
    const s = kneeSet(p, d, { memberId: ref });
    if (!s || !meas) return s;
    const m = d.byId.get(ref)!;
    const P = m.start.z < m.end.z ? m.start : m.end, Q = m.start.z < m.end.z ? m.end : m.start;
    const inw = Math.sign(Q.x - P.x) || 1;
    const at = (t: number, du: number, dz: number) => ({ x: P.x + (Q.x - P.x) * t + inw * du, y: P.y, z: P.z + (Q.z - P.z) * t + dz });
    const pos: Record<KDim, ReturnType<typeof at>> = {
      v: at(0, -inw * 520 * inw, (meas.v) * 0.45), h: at(1, 0, 420), ang: at(0.12, 380, -60), face: at(0.5, 330, -260), ax: at(0.5, -320, 260), L: at(0.82, 380, -300),
    };
    const tags: RealTag[] = ORDER.map((k) => ({ a: P, b: P, at: pos[k], text: `${DIM[k].t} ${fmt(k, meas[k])}${k === 'ang' ? '°' : ''}`, lock: locks.includes(k), onLock: () => toggleLock(k), id: k }));
    return { ...s, tags, key: `${s.key}|studio` };
  }, [p, d, ref, meas, locks]); // eslint-disable-line react-hooks/exhaustive-deps

  const profNow = scope === 'one' && ref ? (p.memberOverrides[ref]?.profile ?? d.byId.get(ref)?.profile ?? kb.profile) : scope === 'loc' ? ov?.profile ?? kb.profile : kb.profile;
  const setProf = (v: string) => {
    if (scope === 'one' && ref) store.exec(setMemberProps([ref], { profile: v }));
    else if (scope === 'loc' && key) store.exec(setKneeBraces({ sides: { ...(kb.sides ?? {}), [key]: { ...(kb.sides?.[key] ?? {}), profile: v } } }));
    else {
      // כל האלכסונים במודל: גובר גם על חתך שנקבע לאלכסון בודד
      const ovIds = kbs.map((m) => m.id).filter((id) => p.memberOverrides[id]?.profile);
      if (ovIds.length) store.exec(resetOverrides(ovIds));
      store.exec(setKneeBraces({ profile: v, sides: Object.fromEntries(Object.entries(kb.sides ?? {}).map(([kk, o]) => { const { profile: _p, ...rest } = o; void _p; return [kk, rest]; }).filter(([, o]) => Object.keys(o as object).length)) }));
    }
  };
  const fam = tryProfile(profNow)?.family ?? 'RHS';
  const detNow = kneeDetail((scope !== 'all' ? ov?.detail : undefined) ?? kb.detail, fam);
  const setDet = (k: 'fin' | 'angle' | 'flange') => {
    if (scope !== 'all' && key) store.exec(setKneeBraces({ sides: { ...(kb.sides ?? {}), [key]: { ...(kb.sides?.[key] ?? {}), detail: k } } }));
    else store.exec(setKneeBraces({ detail: k }));
  };
  const [end, setEnd] = useState<'C' | 'R'>('C');
  const conn = ref ? d.connById.get(`C.${ref}`) : undefined;
  const lineLabel = key ? (d.section?.lines.find((l) => l.id === key.split('.')[0])?.label ?? key.split('.')[0]) : '';
  const sideLabel = key ? (key.endsWith('.R') ? 'ימין' : 'שמאל') : '';
  const frameNo = ref ? ref.split('.')[1]?.replace(/^F/, '') : '';

  const scopes: { k: Scope; t: string; n: number; dis?: string }[] = [
    { k: 'one', t: 'האלכסון שנבחר', n: 1, dis: selKb ? undefined : 'בחרו אלכסון במודל' },
    { k: 'loc', t: key ? `ציר ${lineLabel} (${sideLabel}) — בכל המסגרות` : 'המיקום הזה', n: atKey, dis: selKb ? undefined : 'בחרו אלכסון במודל' },
    { k: 'all', t: 'כל האלכסונים במודל', n: kbs.length },
  ];
  const secs: { k: Sec; n: number; t: string; sub: string }[] = [
    { k: 'loc', n: 1, t: 'מיקום במבנה', sub: `${kbs.length} אלכסונים` },
    { k: 'geo', n: 2, t: 'גיאומטריה', sub: meas ? `${Math.round(meas.v)} · ${meas.ang.toFixed(0)}° · L ${Math.round(meas.L)}` : '—' },
    { k: 'conn', n: 3, t: 'חתך ומחברים', sub: `${profNow} · ${({ fin: 'פח + לשונית', angle: 'זוויתן', flange: 'פלטת קצה' } as const)[detNow]}` },
  ];

  return (
    <div className="ks" data-testid="knee-studio">
      {/* סוג: אחד משניהם */}
      <div className="ks-types" role="radiogroup" aria-label="סוג החיזוק בראש העמוד">
        {([['knee', 'אלכסון עמוד-קורה', 'אלכסון RHS בין העמוד לקורה'], ['haunch', 'מכפל', 'פח משולש מתחת לקורה ליד העמוד']] as const).map(([k, t, sub]) => (
          <button key={k} role="radio" aria-checked={type === k} className={`ks-type${type === k ? ' on' : ''}`} onClick={() => setType(k)} data-testid={`ks-type-${k}`}>
            {k === 'knee' ? <KneePic k={fam === 'L' ? 'angle' : 'fin'} /> : <svg viewBox="0 0 120 80" className="ks-hn" aria-hidden="true"><rect x="10" y="6" width="14" height="70" fill="#5b6977" /><rect x="10" y="6" width="104" height="12" fill="#5b6977" /><path d="M24 18 L84 18 L24 52 Z" fill="#8fa1b3" stroke="#3b4b5e" /></svg>}
            <b>{t}</b><small>{sub}</small>
          </button>
        ))}
        <label className="ks-off"><input type="checkbox" data-testid="kb-on" checked={kb.enabled} onChange={(e) => setType(e.target.checked ? 'knee' : 'none')} />פעיל</label>
      </div>

      {type === 'none' && <div className="ks-empty">בחרו סוג — אלכסון עמוד-קורה או מכפל. אי אפשר את שניהם באותו מבנה.</div>}
      {type === 'haunch' && <div className="ks-panel"><EditCtx.Provider value={{ embed: false }}><HaunchEditor /></EditCtx.Provider></div>}

      {type === 'knee' && <>
        {/* היקף — לפני שמשנים */}
        <div className="ks-scope" role="radiogroup" aria-label="השינוי יחול על" data-testid="ks-scope">
          <span className="ks-lbl">השינויים יחולו על:</span>
          {scopes.map((o) => (
            <button key={o.k} role="radio" aria-checked={scope === o.k} disabled={!!o.dis} title={o.dis} className={`ks-sc${scope === o.k ? ' on' : ''}`} onClick={() => setScope(o.k)}
              data-testid={o.k === 'all' ? 'pscope-asm' : o.k === 'one' ? 'pscope-one' : 'pscope-loc'}>{o.t}<i>{o.n}</i></button>
          ))}
        </div>
        {selKb && <div className="ks-sel">נבחר: אלכסון מסגרת {frameNo} · ציר {lineLabel} ({sideLabel})</div>}

        {/* שלושה כפתורים */}
        <div className="ks-secs" role="tablist">
          {secs.map((s) => (
            <button key={s.k} role="tab" aria-selected={sec === s.k} className={`ks-sec${sec === s.k ? ' on' : ''}`} onClick={() => setSec(s.k)} data-testid={`ks-sec-${s.k}`}>
              <span className="ks-n">{s.n}</span><span className="ks-st"><b>{s.t}</b><small>{s.sub}</small></span>
            </button>
          ))}
        </div>

        {sec === 'loc' && <div className="ks-panel" data-testid="ks-loc">
          <div className="ks-note">איפה יש אלכסונים — לחיצה על צד בתוכנית מוסיפה או מסירה. "מסגרות הקצה", "כל המסגרות" — בחירה מהירה.</div>
          <KneeSides />
        </div>}

        {sec === 'geo' && <div className="ks-panel ks-geo" data-testid="ks-geo">
          <LiveView3D set={set3d} rev={d} height={330} />
          <div className="ks-dims">
            <div className="ks-note">שתי מידות קובעות (מנעול סגור) — השאר נגזרות. לחיצה על מנעול בוחרת מידה קובעת; הקלדת ערך במידה פתוחה הופכת אותה לקובעת.</div>
            {ORDER.map((k) => (
              <div key={k} className={`ks-dim${locks.includes(k) ? ' lk' : ''}`}>
                <button className={`ks-lock${locks.includes(k) ? ' on' : ''}`} onClick={() => toggleLock(k)} aria-pressed={locks.includes(k)} aria-label={`${DIM[k].t} — ${locks.includes(k) ? 'קובעת' : 'נגזרת'}`} data-testid={`kd-lock-${k}`}><LockIc on={locks.includes(k)} /></button>
                <span className="ks-dl"><b>{DIM[k].t}</b><small>{DIM[k].sub}</small></span>
                <DimInput k={k} v={meas?.[k]} onCommit={(v) => commit(k, v)} disabled={busy || scope === 'one' || !meas} />
                <span className="ks-u">{DIM[k].unit}</span>
              </div>
            ))}
            {busy && <div className="ks-note" data-testid="ks-busy">מחשב…</div>}
            {msg && <div className="ks-warn" data-testid="ks-msg">{msg}</div>}
            {scope === 'one' && <div className="ks-warn">גיאומטריה לאלכסון בודד אינה נתמכת — היא חלה על כל האלכסונים במיקום (בכל המסגרות) או בכל המודל.</div>}
          </div>
        </div>}

        {sec === 'conn' && <div className="ks-panel" data-testid="ks-conn">
          <div className="field prof"><label>חתך האלכסון</label><ProfilePicker testId={scope === 'one' ? 'prop-profile' : 'kb-profile'} value={profNow} families={['RHS', 'SHS', 'CHS', 'L', 'UPN']} onCommit={setProf} /></div>
          <div className="ks-ends" role="tablist" aria-label="מחברים">
            {([['C', 'מחבר 1 — לעמוד', 'קצה תחתון, לאגף העמוד'], ['R', 'מחבר 2 — לקורה', 'קצה עליון, לתחתית הקורה']] as const).map(([k, t, sub]) => (
              <button key={k} role="tab" aria-selected={end === k} className={`ks-end${end === k ? ' on' : ''}`} onClick={() => setEnd(k)} data-testid={`ks-end-${k}`}><b>{t}</b><small>{sub}</small></button>
            ))}
          </div>
          <div className="ks-endbody">
            <DetailTiles label="פרט החיבור" testId="kb-detail" value={detNow} onChange={setDet} options={[
              { key: 'fin', title: 'פח + לשונית', desc: 'פח מרותך למארח, לשונית בחריץ ה-RHS; מוברג בשטח', pic: <KneePic k="fin" />, hidden: fam === 'L' },
              { key: 'angle', title: 'זוויתן מוברג', desc: 'פח מרותך למארח; רגל הזוויתן מוברגת לפח', pic: <KneePic k="angle" />, hidden: fam !== 'L' },
              { key: 'flange', title: 'פלטת קצה', desc: 'פלטה מרותכת לאלכסון, מוברגת לאגף', pic: <KneePic k="flange" /> },
            ]} />
            <div className="hint">הפרט חל על שני הקצוות{scope !== 'all' ? ' — במיקום הזה' : ''}.</div>
            {detNow !== 'flange'
              ? <div className="field"><label>ברגים בקצה {end === 'C' ? '(לעמוד)' : '(לקורה)'}</label>
                  <select className="inp" data-testid="kb-bolts" value={kb.boltsPerEnd ?? 2} onChange={(e) => store.exec(setKneeBraces({ boltsPerEnd: Number(e.target.value) }))}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}×M{kb.bolt.d} — {n / 2} {n === 2 ? 'שורה' : 'שורות'} של 2</option>)}</select></div>
              : <div className="field"><label>פלטת קצה / ברגים</label><span className="readonly">{kb.plateT}×{kb.plateW}×{kb.plateL} · 4×M{kb.bolt.d}</span></div>}
            <div className="field"><label>עובי פלטות</label><NumField testId="kb-t" value={kb.plateT} suffix='מ"מ' onCommit={(v) => store.exec(setKneeBraces({ plateT: Math.max(6, v) }))} /></div>
            <div className="field"><label>קוטר בורג</label><BoltSelect d={kb.bolt.d} onChange={(dd) => store.exec(setKneeBraces({ bolt: { ...kb.bolt, d: dd } }))} /></div>
            <div className="hint">ברגים, עובי וקוטר — לכל האלכסונים (שני הקצוות). שינוי למחבר בודד: באשף או בסטודיו.</div>
            {ref && d.byId.get(ref) && <div className="ks-elend"><div className="ks-note">קצוות האלכסון שנבחר — פרט מוכן לכל קצה, או פרט חדש בסטודיו:</div><EndCards m={d.byId.get(ref)!} /><DetailEnds m={d.byId.get(ref)!} /></div>}
            <div className="ks-acts">
              <button className="btn" disabled={!conn} onClick={() => conn && store.set({ connWizard: conn.id })} data-testid="ks-wizard">אשף המחברים</button>
              <button className="btn" disabled={!ref} onClick={() => ref && store.set({ detailStudio: `${ref}|${end === 'C' ? 'start' : 'end'}`, studioConn: conn?.id ?? null })} data-testid="ks-studio">סטודיו ✎ — {end === 'C' ? 'הקצה לעמוד' : 'הקצה לקורה'}</button>
            </div>
          </div>
        </div>}
      </>}
    </div>
  );
}

function DimInput({ k, v, onCommit, disabled }: { k: KDim; v?: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [t, setT] = useState(v == null ? '' : fmt(k, v));
  useEffect(() => { setT(v == null ? '' : fmt(k, v)); }, [k, v]);
  return <input className="inp ks-in" inputMode="decimal" value={t} disabled={disabled} data-testid={`kd-${k}`} aria-label={DIM[k].t}
    onChange={(e) => setT(e.target.value)} onBlur={() => { const n = parseFloat(t); if (v != null && Number.isFinite(n) && Math.abs(n - v) > (k === 'ang' ? 0.05 : 0.5)) onCommit(n); }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setT(v == null ? '' : fmt(k, v)); }} />;
}
