import { CleatTypePicker } from './ConnTypePicker';
import { proposeSplicesFor, setCleat, setPurlinSide, setPurlinSystem, setSection, type Command } from '../commands/commands';
import { PanelAlerts, SumCard, TabbedEditor } from './summary';
import { Adv, BoltSelect, NumField, Help } from './fields';
import { fromMm } from '../core/units';
import type { Member, PurlinSideParams } from '../model/types';
import { MATERIALS } from '../profiles/materials';
import { purlinParams } from '../geometry/purlins';
import { store, useStore } from '../store';
import { LenField, ProfilePicker, useEdit } from './fields';
import { CleatSchematic, PurlinSlopeSchematic, PurlinSpliceSchematic } from './schematics';
import { tryProfile } from '../profiles/library';

const OPENING: Record<'up' | 'down', string> = { up: 'לכיוון הרכס / הצד הגבוה', down: 'לכיוון המרזב / הצד הנמוך' };

export function SideEditor({ side, title, items, freeStart, part }: { side: string; title: string; items: Member[]; freeStart?: boolean; part?: 'layout' | 'cleat' | 'positions' }) {
  const p = useStore((s) => s.project);
  const prm = purlinParams(p.building.purlins, side);
  const u = p.displayUnit;
  const set = (patch: Partial<PurlinSideParams>) => store.exec(setPurlinSide(side, patch));
  const f = (mm: number) => (u === 'm' ? fromMm(mm, 'm').toFixed(3) : mm.toFixed(0));
  const mono = freeStart ?? p.building.roofType === 'mono';
  const tid = (k: string) => `${side}-${k}`;
  const ed = useEdit();
  return (
    <>
      {ed.showTitle && <div className="panel-title">{title}
        <label className="badge" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={prm.enabled} data-testid={tid('enabled')} onChange={(e) => set({ enabled: e.target.checked })} />פעיל
        </label>
      </div>}
      {prm.enabled && <>
        {(!part || part === 'layout') && <>
        {ed.showProfile && <div className="field prof"><label>חתך הפטה</label><ProfilePicker testId={tid('profile')} role="purlin" value={prm.profile} families={['C', 'Z', 'RHS', 'IPE', 'UPN']} onCommit={(v) => set({ profile: v })} /></div>}
        <PurlinSlopeSchematic side={side} items={items} mono={mono} />
        <div className="field"><label>חלוקה</label>
          <select className="inp" data-testid={tid('mode')} value={prm.layout ?? 'fixed'} onChange={(e) => set({ layout: e.target.value as 'fixed' | 'even' })}>
            <option value="even">אוטומטית — מרווחים שווים</option><option value="fixed">מרווח קבוע, שארית במפתח האחרון</option>
          </select>
        </div>
        <SideIssues pkey={side} />
        <Adv id="pside" label="מתקדם — אופן מדידה, פתיחת החתך">
        {!mono && <label className="ss-radio" title="ללא תיקון: מרחק 0 = הפטה בקו הרכס בדיוק. אחרת התוכנה מזיזה את הפטה כך שהפטה והתושבת לא יחצו את קו הרכס">
          <input type="checkbox" checked={!!prm.firstExact} data-testid={tid('first-exact')} onChange={(e) => set({ firstExact: e.target.checked })} />
          מרחק מדויק — בלי תיקון אוטומטי למרחק המזערי מהרכס
        </label>}
        <div className="field"><label>אופן מדידה</label>
          <select className="inp" value={prm.measure} data-testid={tid('measure')} onChange={(e) => set({ measure: e.target.value as PurlinSideParams['measure'] })}>
            <option value="slope">לאורך השיפוע</option><option value="horizontal">בהיטל אופקי (מסומן)</option>
          </select>
        </div>
        <div className="field"><label>פתיחת החתך</label>
          <select className="inp" value={prm.opening} data-testid={tid('opening')} onChange={(e) => set({ opening: e.target.value as 'up' | 'down' })}>
            <option value="up">{OPENING.up}</option><option value="down">{OPENING.down}</option>
          </select>
        </div>
        </Adv>
        {prm.measure === 'horizontal' && <div className="issue warning"><span className="ic">!</span>המרחקים נמדדים בהיטל אופקי ולא לאורך השיפוע.</div>}
        </>}
        {(!part || part === 'positions') && <>
        <Adv id="ptbl" label={`טבלת מיקומי הפטות (${items.length})`} open={part === 'positions' ? true : undefined}>
        <table className="tbl" data-testid={tid('layout')}>
          <thead><tr><th>#</th><th>לאורך שיפוע</th><th>אופקי</th><th>מרווח</th></tr></thead>
          <tbody>
            {items.map((m) => {
              const pi = m.purlin!;
              const rem = pi.isLast && pi.spanBefore > 0 && Math.abs(pi.spanBefore - prm.spacing) > 0.5;
              return (
                <tr key={m.id} style={{ cursor: 'pointer', background: rem ? 'var(--warn-soft)' : undefined }} onClick={() => store.select([m.id])}>
                  <td>{pi.index}</td><td className="readonly">{f(pi.sSlope)}</td><td className="readonly">{f(pi.sHoriz)}</td>
                  <td className="readonly">{pi.index > 1 ? f(pi.spanBefore) : '—'}{rem ? ' ◂ שארית' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </Adv>
        <div className="row" style={{ marginTop: 6 }}>
          {prm.manualPositions
            ? <><span className="badge warn">פריסה ידנית</span><button className="btn small" onClick={() => set({ manualPositions: null })}>חזרה לאוטומטי</button></>
            : <button className="btn small" data-testid={tid('manual')} onClick={() => set({ manualPositions: items.map((m) => m.purlin!.sSlope * (prm.measure === 'horizontal' ? 1 : 1)) })}>עריכה ידנית של המיקומים</button>}
        </div>
        </>}
        {ed.showConn && (!part || part === 'cleat') && <>
        <div className="panel-title">תושבות פטה
          <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" checked={prm.cleat.enabled} data-testid={tid('cleat-enabled')} onChange={(e) => store.exec(setCleat(side, { enabled: e.target.checked }))} />פעיל</label>
        </div>
        {prm.cleat.enabled && <>
          <CleatTypePicker side={side} />
          <label className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }} title="כל סוגי התושבת (זוויתן מרותך, זוויתן עומד שווה-רגליים, פלטה + משולש, וכן תושבת התפר מעל התומך) בפטות C/Z נבנות ממתכון במקום מהקוד הישן. השוואה אוטומטית מול הקוד הישן ירוקה; כבוי = הקוד הישן (ברירת מחדל, גיבוי). חל על כל התושבות במבנה.">
            <input type="checkbox" data-testid="cleat-recipe" checked={p.building.purlins.engine === 'recipe'} onChange={(e) => store.exec(setPurlinSystem({ engine: e.target.checked ? 'recipe' : 'legacy' }))} />
            <span>בנה ממתכון (מנוע חדש) — כבוי: הקוד הישן</span></label>
          {(prm.cleat.style ?? 'run') === 'run' && <CleatSchematic side={side} />}
          {(prm.cleat.style ?? 'run') === 'run' && <div className="field"><label>קוטר בורג</label>
            <BoltSelect d={prm.cleat.bolt.d} onChange={(n) => store.exec(setCleat(side, { bolt: { ...prm.cleat.bolt, d: n } }))} />
          </div>}
          {(prm.cleat.style ?? 'run') !== 'run' && <Adv id="cleat" label="מידות התומך">
          <div className="field"><label>גובה</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              {prm.cleat.height === null
                ? <><span className="readonly" style={{ flex: 1 }}>= גובה הפטה</span><button className="btn small" data-testid={tid('cleat-h-manual')} onClick={() => store.exec(setCleat(side, { height: Math.round(items[0] ? 200 : 200) }))}>ידני</button></>
                : <><LenField testId={tid('cleat-h')} mm={prm.cleat.height} unit="mm" onCommit={(v) => store.exec(setCleat(side, { height: v }))} /><button className="btn small" onClick={() => store.exec(setCleat(side, { height: null }))}>אוטו׳</button></>}
            </div>
          </div>
          <div className="field"><label>רגל בסיס × עובי</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <LenField testId={tid('cleat-base')} mm={prm.cleat.base} unit="mm" onCommit={(v) => store.exec(setCleat(side, { base: v }))} />
              <LenField mm={prm.cleat.thickness} unit="mm" onCommit={(v) => store.exec(setCleat(side, { thickness: v }))} />
            </div>
          </div>
          <div className="field"><label>רוחב לאורך הפטה</label><LenField mm={prm.cleat.width} unit="mm" onCommit={(v) => store.exec(setCleat(side, { width: v }))} /></div>
          <div className="field"><label>ברגים בשורה × מרווח</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <NumField value={prm.cleat.perRow} onCommit={(v) => store.exec(setCleat(side, { perRow: Math.round(v) }))} />
              <LenField mm={prm.cleat.pitch} unit="mm" onCommit={(v) => store.exec(setCleat(side, { pitch: v }))} />
            </div>
          </div>
          <div className="field"><label>קוטר בורג</label>
            <BoltSelect d={prm.cleat.bolt.d} onChange={(n) => store.exec(setCleat(side, { bolt: { ...prm.cleat.bolt, d: n } }))} />
          </div>
          </Adv>}
          <div className="hint">מרותך לקורה במסגריה, מוברג לווב הפטה בשטח. הרגל הניצבת צמודה לווב (0 מ"מ), רגל הבסיס פונה הרחק מהאגף התחתון.</div>
        </>}
        </>}
        {prm.manualPositions && (!part || part === 'positions') && (
          <div style={{ marginTop: 6 }}>
            {prm.manualPositions.map((v, i) => (
              <div className="field" key={i}><label>פטה {i + 1}</label>
                <LenField mm={v} unit={u} onCommit={(nv) => { const arr = [...prm.manualPositions!]; arr[i] = nv; set({ manualPositions: arr }); }} />
              </div>
            ))}
            <div className="hint">המיקומים {prm.measure === 'horizontal' ? 'בהיטל אופקי' : 'לאורך השיפוע'}, מ{mono ? 'קצה ההתחלה' : 'הרכס'}.</div>
          </div>
        )}
      </>}
    </>
  );
}

function SideIssues({ pkey }: { pkey: string }) {
  const issues = useStore((s) => s.derived.issues).filter((i) => i.fix?.purlinKey === pkey || (i.code === 'PURLIN_RIDGE'));
  if (!issues.length) return null;
  return (
    <div data-testid={`side-issues-${pkey}`}>
      {issues.map((i, k) => (
        <div key={k} className={`issue ${i.severity}`}>
          <span className="ic">{i.severity === 'error' ? '✕' : '!'}</span>
          <div><div>{i.message}</div>{i.fix && <button className="btn small fix-btn" data-testid={`side-fix-${i.code}`} onClick={() => store.exec(setPurlinSide(i.fix!.purlinKey, i.fix!.patch))}>תיקון: {i.fix.label}</button>}</div>
        </div>
      ))}
    </div>
  );
}

/** חתך מודולרי: מאיזה צד מתחילה פריסת הפטות במישור (הועבר לכאן מעורך החתך — החלטת משתמש) */
export function PlaneStart({ planeId }: { planeId: string }) {
  const sec = useStore((s) => s.project.building.section);
  const pl = sec?.planes.find((q) => q.id === planeId);
  if (!sec || !pl) return null;
  const set = (start: 'x0' | 'x1') => store.exec(setSection({ ...sec, planes: sec.planes.map((q) => (q.id === planeId ? { ...q, start, fixed: q.fixed ?? q.start } : q)) }, 'צד התחלת פטות'));
  return (
    <div className="field" style={{ marginTop: 12 }}><label>פטות מתחילות מ{sec.planes.length > 1 ? ` (${pl.id})` : ''}</label>
      <div className="seg">
        <button className={`tbtn${pl.start === 'x0' ? ' on' : ''}`} data-testid={`ps-start0-${planeId}`} onClick={() => set('x0')}>שמאל</button>
        <button className={`tbtn${pl.start === 'x1' ? ' on' : ''}`} data-testid={`ps-start1-${planeId}`} onClick={() => set('x1')}>ימין</button>
      </div>
    </div>
  );
}

export type RoofSection = 'system' | 'left' | 'right' | 'splices';
export function RoofPanel({ section }: { section?: RoofSection } = {}) {
  const show = (k: RoofSection) => !section || section === k;
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const pu = p.building.purlins;
  const purlins = d.members.filter((m) => m.purlin).sort((a, b) => a.purlin!.index - b.purlin!.index);
  const L = purlins.filter((m) => m.purlin!.side === 'L'), R = purlins.filter((m) => m.purlin!.side === 'R'), M = purlins.filter((m) => m.purlin!.side === 'M');
  const planes = d.section?.planes ?? [];
  const nSpl = d.splices.filter((s) => s.memberId.startsWith('PL.')).length;
  const exec = (c: Command) => store.exec(c);
  const ed = useEdit();
  const sides: { key: string; side: string; title: string; free?: boolean; items: Member[]; planeId?: string }[] = p.building.section
    ? planes.map((pl) => ({ key: pl.id, side: pl.params, title: `פטות ${pl.label}`, free: pl.startFree, items: purlins.filter((m) => m.purlin!.side === pl.id), planeId: pl.id }))
    : p.building.roofType === 'gable' ? [{ key: 'L', side: 'left', title: 'שיפוע שמאל', items: L }, { key: 'R', side: 'right', title: 'שיפוע ימין', items: R }] : [{ key: 'M', side: 'left', title: 'שיפוע הגג', items: M }];
  if ((section === 'left' || section === 'right') && !ed.embed) {
    const mine = p.building.section || p.building.roofType !== 'gable' ? sides : sides.filter((q) => q.side === section);
    const issues = d.issues.filter((i) => i.fix?.purlinKey || /^PURLIN|^CLEAT|^CLASH/.test(i.code) && /פטה|תומך/.test(i.message));
    return (
      <div className="panel-body" data-testid="roof-panel">
        {mine.map((q) => { const prm = purlinParams(pu, q.side); const sp = q.items.map((m) => m.purlin!.spanBefore).filter((v) => v > 0); return (
          <SumCard key={q.key} testId={`purl-sum-${q.key}`} title={`${q.title} · ${q.items.length} פטות · ${prm.profile}`}
            sub={`מרווח ${(prm.layout ?? 'fixed') === 'even' ? 'שווה' : 'קבוע'} ${sp.length ? `${Math.round(Math.min(...sp))}–${Math.round(Math.max(...sp))}` : prm.spacing} מ"מ · תושבת ${prm.cleat.enabled ? (prm.cleat.style ?? 'run') === 'run' ? 'זוויתן רץ' : 'זוויתן' : 'ללא'}`}
            pills={prm.manualPositions ? [{ text: 'פריסה ידנית', tone: 'warn' }] : []} />); })}
        <PanelAlerts issues={issues} testId="purl-alerts" />
        <TabbedEditor testId="purl-ed" title="" initial={(() => { const sel = store.state.selection[0]; return sel && d.byId.get(sel)?.kind === 'cleat' ? 'cleat' : undefined; })()} tabs={[
          { key: 'layout', label: 'חתך ופריסה', render: () => <>{mine.map((q) => <div key={q.key}>{q.planeId && <PlaneStart planeId={q.planeId} />}<SideEditor side={q.side} title={q.title} freeStart={q.free} items={q.items} part="layout" /></div>)}</> },
          { key: 'cleat', label: 'תושבות', render: () => <>{mine.map((q) => <SideEditor key={q.key} side={q.side} title={q.title} freeStart={q.free} items={q.items} part="cleat" />)}</> },
          { key: 'positions', label: 'מיקומים', render: () => <>{mine.map((q) => <SideEditor key={q.key} side={q.side} title={q.title} freeStart={q.free} items={q.items} part="positions" />)}</> },
          { key: 'system', label: 'חומר וצד התחלה', render: () => <>
            <div className="field"><label>חומר</label>
              <select className="inp" value={pu.material} onChange={(e) => exec(setPurlinSystem({ material: e.target.value }))}>
                {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></div>
            {p.building.roofType === 'mono' && <div className="field"><label>צד התחלת הפריסה</label>
              <select className="inp" value={pu.monoStart} data-testid="monoStart" onChange={(e) => exec(setPurlinSystem({ monoStart: e.target.value as 'low' | 'high' }))}>
                <option value="high">הצד הגבוה</option><option value="low">הצד הנמוך</option>
              </select></div>}
            <Help>הפריסה מתחילה {p.building.roofType === 'gable' ? 'ברכס, לכל צד בנפרד,' : 'בקצה שנבחר'} ומתקדמת עד הקצה החיצוני של קורת הגג כולל הקונזולה. הפטה האחרונה בקצה, והשארית נשארת במפתח האחרון בלבד.</Help>
          </> },
        ]} />
      </div>
    );
  }
  return (
    <div className="panel-body" data-testid="roof-panel">
      {(show('system') || show('left')) && <>
      <div className="panel-title">מערכת פטות — חומר ופריסה</div>
      <div className="field"><label>חומר</label>
        <select className="inp" value={pu.material} onChange={(e) => exec(setPurlinSystem({ material: e.target.value }))}>
          {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {p.building.roofType === 'mono' && (
        <div className="field"><label>צד התחלת הפריסה</label>
          <select className="inp" value={pu.monoStart} data-testid="monoStart" onChange={(e) => exec(setPurlinSystem({ monoStart: e.target.value as 'low' | 'high' }))}>
            <option value="high">הצד הגבוה</option><option value="low">הצד הנמוך</option>
          </select>
        </div>
      )}
      <Help>הפריסה מתחילה {p.building.roofType === 'gable' ? 'ברכס, לכל צד בנפרד,' : 'בקצה שנבחר'} ומתקדמת עד הקצה החיצוני של קורת הגג כולל הקונזולה. הפטה האחרונה בקצה, והשארית נשארת במפתח האחרון בלבד.</Help>
      </>}
      {p.building.section
        ? (show('left') || show('right')) && planes.map((pl) => <div key={pl.id}><PlaneStart planeId={pl.id} /><SideEditor side={pl.params} title={`פטות ${pl.label}`} freeStart={pl.startFree} items={purlins.filter((m) => m.purlin!.side === pl.id)} /></div>)
        : p.building.roofType === 'gable'
        ? <>{show('left') && <SideEditor side="left" title="שיפוע שמאל" items={L} />}{show('right') && <SideEditor side="right" title="שיפוע ימין" items={R} />}</>
        : (show('left') || show('right')) && <SideEditor side="left" title="שיפוע הגג" items={M} />}
      {show('splices') && <>
      <div className="panel-title">חלוקה לחלקי ייצור</div>
      <Help>אורך חומר גלם: {(p.settings.stockLength / 1000).toFixed(2)} מ'. ההצעה ממקמת חיבורי המשך מעל מסגרות, רק במקום הנדרש — לא בכל מסגרת. חיבור המשך בפטת C/Z: פלטה בצד הפנימי של הווב ו-4 ברגים, 2 בכל פטה.</Help>
      <PurlinSpliceSchematic sp={pu.splice} purlinH={tryProfile(purlinParams(pu, 'left').profile)?.props.h ?? 200} onSet={(patch) => exec(setPurlinSystem({ splice: { ...pu.splice, ...patch } }))} />
      <div className="field"><label>קוטר בורג</label><BoltSelect testId="ps-d" d={pu.splice.bolt.d} onChange={(d) => exec(setPurlinSystem({ splice: { ...pu.splice, bolt: { ...pu.splice.bolt, d } } }))} /></div>
      <div className="field"><label>אורך קטע פטה</label>
        <select className="inp" data-testid="piece-bays" value={pu.pieceBays ?? 0} onChange={(e) => exec(setPurlinSystem({ pieceBays: Number(e.target.value) }))}>
          <option value={0}>אוטומטי לפי חומר גלם ({(p.settings.stockLength / 1000).toFixed(1)} מ')</option>
          {[1, 2, 3, 4].map((n) => {
            const fr = p.building.frames.map((f) => f.y).sort((a, b) => a - b);
            const len = fr.length > n ? fr[n] - fr[0] : 0;
            return <option key={n} value={n}>{n} {n === 1 ? 'מפתח' : 'מפתחים'}{len ? ` (≈${(len / 1000).toFixed(2)} מ')` : ''}</option>;
          })}
        </select>
      </div>
      <div className="row">
        <button className="btn" data-testid="propose-purlin-splices" onClick={() => exec(proposeSplicesFor(purlins.map((m) => m.id)))}>הצעת חיבורי המשך לכל הפטות</button>
        <button className="btn" disabled={!nSpl} onClick={() => exec({
          label: 'ניקוי חיבורי המשך בפטות',
          run: (pp) => ({ ...structuredClone(pp), splices: Object.fromEntries(Object.entries(pp.splices).filter(([k]) => !k.startsWith('PL.'))) }),
        })}>ניקוי</button>
      </div>
      <div className="hint">חיבורי המשך בפטות: <b data-testid="purlin-splice-count">{nSpl}</b></div>
      </>}
    </div>
  );
}
