import { useEffect, useMemo, useState } from 'react';
import { resetOverrides, setBuilding, setKneeBraces, setMemberProps } from '../commands/commands';
import { defaultHaunch } from '../geometry/haunch';
import { defaultKneeBraces, kneeDetail } from '../geometry/knee';
import { checkKneePair, kneeKeyOf, measureKnee, solveKnee, type KDim, type KMeas } from '../geometry/kneeSolve';
import type { KneeSideOverride } from '../model/types';
import { tryProfile } from '../profiles/library';
import { store, useStore } from '../store';
import { DetailTiles } from './DetailPicker';
import { BoltSelect, EditCtx, NumField, ProfilePicker } from './fields';
import { LockIc } from './LiveView3D';
import { ConnectorBlock } from './wizard/ConnectorBlock';
import { HaunchEditor, KneePic, KneeSides } from './SectionEditor';
import { WizardNavigation, WizardScopeSelector, WizardSection, WizardTypeSelector, WizardValidation, wizardClip, wizardCopy } from './wizard/Wizard';

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
  // 1.57: בדיקת דרגות חופש של שתי המידות הקובעות (על המודל עצמו)
  const [pairBad, setPairBad] = useState<string | null>(null);
  useEffect(() => {
    if (!ref || locks.length !== 2) { setPairBad(null); return; }
    const t = setTimeout(() => { const r = checkKneePair(store.state.project, ref, [locks[0], locks[1]], scope === 'loc' ? key ?? undefined : undefined); setPairBad(r.ok ? null : r.reason ?? 'לא תקין'); }, 60);
    return () => clearTimeout(t);
  }, [locks.join(','), ref, scope, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1.58: מכפל — חלקים במודל (להדגשה ולתצוגה)
  const hnConns = useMemo(() => d.connections.filter((c) => c.id.startsWith('C.HN.')), [d]);
  const hnN = hnConns.length;
  const hnIds = useMemo(() => hnConns.flatMap((c) => c.parts), [hnConns]);
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
    const chk = checkKneePair(store.state.project, ref, [k, other], scope === 'loc' ? key! : undefined);
    if (!chk.ok) { setPairBad(chk.reason ?? 'לא תקין'); setMsg(null); return; }
    const targets: Partial<KMeas> = { [k]: v, [other]: meas[other] };
    // אנכי + אופקי קובעות: הן בדיוק ירידה ו-reach של המנוע (מצב reach) — נשמרות כמו שהוזנו, בלי המרה לזווית ובלי reach ישן שנשאר בצד
    if (L2.includes('v') && L2.includes('h')) {
      const dropV = Math.round(targets.v!), reachH = Math.round(targets.h!);
      if (scope === 'loc') store.exec(setKneeBraces({ sides: { ...(kb.sides ?? {}), [key!]: { ...(kb.sides?.[key!] ?? {}), mode: 'reach', drop: dropV, reach: reachH } } }));
      else {
        const sides = Object.fromEntries(Object.entries(kb.sides ?? {}).map(([kk, o]) => { const { drop: _d, angle: _a, reach: _r, mode: _m, ...rest } = o; void _d; void _a; void _r; void _m; return [kk, rest]; }).filter(([, o]) => Object.keys(o as object).length));
        store.exec(setKneeBraces({ mode: 'reach', drop: dropV, reach: reachH, sides }));
      }
      setBusy(false); setMsg(null);
      return;
    }
    setBusy(true); setMsg(null);
    setTimeout(() => {
      const r = solveKnee(store.state.project, ref, targets, scope === 'loc' ? key! : undefined);
      setBusy(false);
      if (!r) { setMsg('אין אלכסון שעונה על שתי המידות האלה — נסו ערך אחר או מידה קובעת אחרת'); return; }
      if (scope === 'loc') store.exec(setKneeBraces({ sides: { ...(kb.sides ?? {}), [key!]: { ...(kb.sides?.[key!] ?? {}), mode: 'angle', drop: r.drop, angle: r.angle, reach: Math.round(r.meas.h) } } }));
      else {
        // כל המודל: גובר על מידות שהוגדרו קודם למיקומים
        const sides = Object.fromEntries(Object.entries(kb.sides ?? {}).map(([kk, o]) => { const { drop: _d, angle: _a, reach: _r, mode: _m, ...rest } = o; void _d; void _a; void _r; void _m; return [kk, rest]; }).filter(([, o]) => Object.keys(o as object).length));
        store.exec(setKneeBraces({ mode: 'angle', drop: r.drop, angle: r.angle, reach: Math.round(r.meas.h), sides }));
      }
    }, 20);
  };

  // תמונה ריאלית: הצומת עם 6 מידות (2 קובעות — מנעול סגור)

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

  // הדגשה כתומה של מה שהשינוי יחול עליו
  const scopeIds = useMemo(() => {
    const own = scope === 'one' && ref ? [ref] : scope === 'loc' && key ? kbs.filter((m) => kneeKeyOf(m.id) === key).map((m) => m.id) : kbs.map((m) => m.id);
    const S = new Set(own);
    return [...own, ...d.connections.filter((c) => c.parts.some((x) => S.has(x)) || c.members.some((x) => S.has(x))).flatMap((c) => c.parts.filter((x) => !S.has(x)))];
  }, [d, kbs, scope, ref, key]);
  useEffect(() => { store.set({ scopeHi: type === 'knee' ? scopeIds : type === 'haunch' ? (hnIds.length ? hnIds : null) : null }); }, [scopeIds, type, hnIds]);
  useEffect(() => () => { store.set({ scopeHi: null }); }, []);
  const issues = useMemo(() => d.issues.filter((i) => /^(C\.)?KB\./.test(i.elementId ?? '') || /^KNEE_/.test(i.code)), [d]);
  type KCopy = { drop: number; angle: number; mode: 'angle' | 'reach'; reach: number; profile: string; detail?: 'fin' | 'flange' | 'angle' | 'stub' };
  const copyNow = () => wizardCopy('knee', { drop: (scope === 'loc' ? ov?.drop : undefined) ?? kb.drop, angle: (scope === 'loc' ? ov?.angle : undefined) ?? kb.angle ?? 45, mode: 'angle', reach: kb.reach, profile: profNow, detail: (scope !== 'all' ? ov?.detail : undefined) ?? kb.detail } as KCopy);
  const clipNow = wizardClip<KCopy>('knee');
  const paste = () => {
    const c = wizardClip<KCopy>('knee'); if (!c) return;
    if (scope !== 'all' && key) store.exec(setKneeBraces({ sides: { ...(kb.sides ?? {}), [key]: { ...(kb.sides?.[key] ?? {}), mode: 'angle', drop: c.drop, angle: c.angle, profile: c.profile, detail: c.detail === 'stub' ? undefined : c.detail } } }));
    else store.exec(setKneeBraces({ mode: 'angle', drop: c.drop, angle: c.angle, profile: c.profile, detail: c.detail }));
  };
  return (
    <div className="ks" data-testid="knee-studio">
      {/* סוג: אחד משניהם */}
      <WizardTypeSelector<'knee' | 'haunch'> label="סוג החיזוק בראש העמוד" value={type === 'none' ? null : type} onPick={setType}
        types={[
          { key: 'knee', title: 'אלכסון עמוד-קורה', sub: 'אלכסון RHS בין העמוד לקורה', pic: <KneePic k={fam === 'L' ? 'angle' : 'fin'} />, testId: 'ks-type-knee' },
          { key: 'haunch', title: 'מכפל', sub: 'פח משולש מתחת לקורה ליד העמוד', pic: <svg viewBox="0 0 120 60" className="ks-hn" aria-hidden="true"><rect x="10" y="4" width="14" height="54" fill="#5b6977" /><rect x="10" y="4" width="104" height="10" fill="#5b6977" /><path d="M24 14 L84 14 L24 40 Z" fill="#8fa1b3" stroke="#3b4b5e" /></svg>, testId: 'ks-type-haunch' },
        ]}
        extra={<label className="ks-off"><input type="checkbox" data-testid="kb-on" checked={kb.enabled} onChange={(e) => setType(e.target.checked ? 'knee' : 'none')} />פעיל</label>} />

      {type === 'none' && <div className="ks-empty">בחרו סוג — אלכסון עמוד-קורה או מכפל. אי אפשר את שניהם באותו מבנה.</div>}
      {/* 1.58: מכפל — אותו מבנה: היקף → מיקום · גיאומטריה · חתך ומחברים */}
      {type === 'haunch' && <>
        <WizardScopeSelector<'all'> value="all" onPick={() => undefined} scopes={[{ key: 'all', title: 'כל המכפלים במודל', count: hnN, testId: 'pscope-asm' }]} note={<>{hnIds.length} חלקים — מודגשים בכתום</>} />
        <WizardNavigation value={sec} onPick={setSec} subs={{ loc: `${hnN} מכפלים`, geo: `אורך ${hp.length}`, conn: hp.webT ? `גוף ${hp.webT}` : 'כמו הקורה' }} />
        <WizardValidation issues={d.issues.filter((i) => /^(C\.)?HN\./.test(i.elementId ?? ''))} />
        {sec === 'loc' && <WizardSection id="loc"><div className="ks-note">המכפל נבנה בכל צד שבו קורת הגג ממשיכה מעבר לעמוד — {hnN} מקומות במודל.</div></WizardSection>}
        {sec === 'geo' && <WizardSection id="geo" className="fs-geo"><div className="ks-dims"><EditCtx.Provider value={{ embed: true }}><HaunchEditor part="geo" /></EditCtx.Provider></div></WizardSection>}
        {sec === 'conn' && <WizardSection id="conn"><EditCtx.Provider value={{ embed: true }}><HaunchEditor part="conn" /></EditCtx.Provider><div className="ks-note">פח גוף משולש + פח אגף משופע, מרותכים מתחת לקורת הגג במסגריה — מכלול אחד עם הקורה. ללא בדיקת חוזק.</div></WizardSection>}
      </>}

      {type === 'knee' && <>
        {/* היקף — לפני שמשנים */}
        <WizardScopeSelector<Scope> value={scope} onPick={setScope}
          scopes={scopes.map((o) => ({ key: o.k, title: o.t, count: o.n, disabled: o.dis, testId: o.k === 'all' ? 'pscope-asm' : o.k === 'one' ? 'pscope-one' : 'pscope-loc' }))}
          note={<>{scopeIds.length} אלמנטים וחלקים — מודגשים בכתום · <button className="wz-link" onClick={copyNow} data-testid="wz-copy">העתקת הגדרות</button>{clipNow && <> · <button className="wz-link" onClick={paste} data-testid="wz-paste">הדבקה</button></>}</>} />
        {selKb && <div className="ks-sel">נבחר: אלכסון מסגרת {frameNo} · ציר {lineLabel} ({sideLabel})</div>}
        <WizardNavigation value={sec} onPick={setSec} subs={Object.fromEntries(secs.map((x) => [x.k, x.sub]))} />
        <WizardValidation issues={issues} />

        {sec === 'loc' && <WizardSection id="loc">
          <div className="ks-note">איפה יש אלכסונים — לחיצה על צד בתוכנית מוסיפה או מסירה. "מסגרות הקצה", "כל המסגרות" — בחירה מהירה.</div>
          <KneeSides />
        </WizardSection>}

        {sec === 'geo' && <WizardSection id="geo" className="fs-geo">
          <div className="ks-dims">
            <div className="ks-note">שתי מידות קובעות (מנעול סגור) — השאר נגזרות. לחיצה על מנעול בוחרת מידה קובעת; הקלדת ערך במידה פתוחה הופכת אותה לקובעת.</div>
            {ORDER.map((k) => (
              <div key={k} className={`ks-dim${locks.includes(k) ? ' lk' : ''}${locks.includes(k) && pairBad ? ' bad' : ''}`} data-state={locks.includes(k) ? (pairBad ? 'invalid' : 'locked') : 'computed'} data-testid={`kd-row-${k}`}>
                <button className={`ks-lock${locks.includes(k) ? ' on' : ''}`} onClick={() => toggleLock(k)} aria-pressed={locks.includes(k)} aria-label={`${DIM[k].t} — ${locks.includes(k) ? 'קובעת' : 'נגזרת'}`} data-testid={`kd-lock-${k}`}><LockIc on={locks.includes(k)} /></button>
                <span className="ks-dl"><b>{DIM[k].t}</b><small>{DIM[k].sub}</small></span>
                <DimInput k={k} v={meas?.[k]} onCommit={(v) => commit(k, v)} disabled={busy || scope === 'one' || !meas || (!!pairBad && locks.includes(k))} />
                <span className="ks-u">{DIM[k].unit}</span>
              </div>
            ))}
            {meas && Math.abs(meas.v - meas.h) < 1 && Math.abs(meas.ang - 45) > 0.5 && <div className="ks-note" data-testid="ks-v-eq-h">אנכי = אופקי אבל הזווית {meas.ang.toFixed(1)}°, לא 45°: האופקי נמדד מציר העמוד (כולל חצי עומק העמוד) והאנכי מתחתית הקורה — לאלכסון 45° נעלו אנכי + זווית 45°.</div>}
            {pairBad && <div className="ks-bad" data-testid="ks-pair-bad">{pairBad}</div>}
            {busy && <div className="ks-note" data-testid="ks-busy">מחשב…</div>}
            {msg && <div className="ks-warn" data-testid="ks-msg">{msg}</div>}
            {scope === 'one' && <div className="ks-warn">גיאומטריה לאלכסון בודד אינה נתמכת — היא חלה על כל האלכסונים במיקום (בכל המסגרות) או בכל המודל.</div>}
          </div>
        </WizardSection>}

        {sec === 'conn' && <WizardSection id="conn">
          <div className="field prof"><label>חתך האלכסון</label><ProfilePicker testId={scope === 'one' ? 'prop-profile' : 'kb-profile'} value={profNow} families={['RHS', 'SHS', 'CHS', 'L', 'UPN']} onCommit={setProf} /></div>
          <ConnectorBlock value={end} onPick={(k) => setEnd(k as 'C' | 'R')}
            tabs={[{ key: 'C', title: 'מחבר 1 — לעמוד', sub: 'קצה תחתון, לאגף העמוד', testId: 'ks-end-C' }, { key: 'R', title: 'מחבר 2 — לקורה', sub: 'קצה עליון, לתחתית הקורה', testId: 'ks-end-R' }]}
            built={<>
            <DetailTiles label="פרט החיבור" testId="kb-detail" value={detNow} onChange={setDet} options={[
              { key: 'fin', title: 'פח + לשונית', desc: 'פח מרותך למארח, לשונית בחריץ ה-RHS; מוברג בשטח', pic: <KneePic k="fin" />, hidden: fam === 'L' },
              { key: 'angle', title: 'זוויתן מוברג', desc: 'פח מרותך למארח; רגל הזוויתן מוברגת לפח', pic: <KneePic k="angle" />, hidden: fam !== 'L' },
              { key: 'flange', title: 'פלטת קצה', desc: 'פלטה מרותכת לאלכסון, מוברגת לאגף', pic: <KneePic k="flange" /> },
            ]} />
            <div className="hint">הפרט חל על שני הקצוות{scope !== 'all' ? ' — במיקום הזה' : ''}.</div>
            {detNow === 'fin' && fam !== 'L' && <label className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }} title="פרט ה-fin נבנה ממתכון (סטודיו) במקום מהקוד הישן. השוואה אוטומטית מול הקוד הישן ירוקה; כבוי = הקוד הישן (ברירת מחדל, גיבוי).">
              <input type="checkbox" data-testid="kb-fin-recipe" checked={kb.finEngine === 'recipe'} onChange={(e) => store.exec(setKneeBraces({ finEngine: e.target.checked ? 'recipe' : 'legacy' }))} />
              <span>בנה ממתכון (מנוע חדש, ניסיוני) — כבוי: הקוד הישן</span></label>}
            {detNow !== 'flange'
              ? <div className="field"><label>ברגים בקצה {end === 'C' ? '(לעמוד)' : '(לקורה)'}</label>
                  <select className="inp" data-testid="kb-bolts" value={kb.boltsPerEnd ?? 2} onChange={(e) => store.exec(setKneeBraces({ boltsPerEnd: Number(e.target.value) }))}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}×M{kb.bolt.d} — {n / 2} {n === 2 ? 'שורה' : 'שורות'} של 2</option>)}</select></div>
              : <div className="field"><label>פלטת קצה / ברגים</label><span className="readonly">{kb.plateT}×{kb.plateW}×{kb.plateL} · 4×M{kb.bolt.d}</span></div>}
            <div className="field"><label>עובי פלטות</label><NumField testId="kb-t" value={kb.plateT} suffix='מ"מ' onCommit={(v) => store.exec(setKneeBraces({ plateT: Math.max(6, v) }))} /></div>
            <div className="field"><label>קוטר בורג</label><BoltSelect d={kb.bolt.d} onChange={(dd) => store.exec(setKneeBraces({ bolt: { ...kb.bolt, d: dd } }))} /></div>
            <div className="hint">ברגים, עובי וקוטר — לכל האלכסונים (שני הקצוות). שינוי למחבר בודד: באשף או בסטודיו.</div>
            </>}
            site={ref && d.byId.get(ref) ? { memberId: ref, end: end === 'C' ? 'start' : 'end' } : null}
            connId={conn?.id} wizardConnId={conn?.id}
            onStudio={ref ? () => store.set({ detailStudio: `${ref}|${end === 'C' ? 'start' : 'end'}`, studioConn: conn?.id ?? null }) : undefined} />
        </WizardSection>}
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
