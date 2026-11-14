import { proposeSplicesFor, setPurlinSide, setPurlinSystem, type Command } from '../commands/commands';
import { fromMm } from '../core/units';
import type { Member, PurlinSideParams } from '../model/types';
import { MATERIALS } from '../profiles/materials';
import { store, useStore } from '../store';
import { LenField, TextField } from './fields';

const OPENING: Record<'up' | 'down', string> = { up: 'לכיוון הרכס / הצד הגבוה', down: 'לכיוון המרזב / הצד הנמוך' };

function SideEditor({ side, title, items }: { side: 'left' | 'right'; title: string; items: Member[] }) {
  const p = useStore((s) => s.project);
  const prm = p.building.purlins[side];
  const u = p.displayUnit;
  const set = (patch: Partial<PurlinSideParams>) => store.exec(setPurlinSide(side, patch));
  const f = (mm: number) => (u === 'm' ? fromMm(mm, 'm').toFixed(3) : mm.toFixed(0));
  const mono = p.building.roofType === 'mono';
  const tid = (k: string) => `${side}-${k}`;
  return (
    <>
      <div className="panel-title">{title}
        <label className="badge" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={prm.enabled} data-testid={tid('enabled')} onChange={(e) => set({ enabled: e.target.checked })} />פעיל
        </label>
      </div>
      {prm.enabled && <>
        <div className="field"><label>חתך</label><TextField ltr list="profiles" testId={tid('profile')} value={prm.profile} onCommit={(v) => set({ profile: v.toUpperCase().replace(/\s/g, '') })} /></div>
        <div className="field"><label>{mono ? 'מרחק ראשון מקצה ההתחלה' : 'מרחק ראשון מהרכס'}</label><LenField testId={tid('first')} mm={prm.first} unit={u} onCommit={(v) => set({ first: v })} /></div>
        <div className="field"><label>מרווח רגיל</label><LenField testId={tid('spacing')} mm={prm.spacing} unit={u} onCommit={(v) => set({ spacing: v })} /></div>
        <div className="field"><label>פטה אחרונה – מרחק מהקצה</label><LenField testId={tid('edge')} mm={prm.edgeOffset} unit={u} onCommit={(v) => set({ edgeOffset: v })} /></div>
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
        {prm.measure === 'horizontal' && <div className="issue warning"><span className="ic">!</span>המרחקים נמדדים בהיטל אופקי ולא לאורך השיפוע.</div>}
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
        <div className="row" style={{ marginTop: 6 }}>
          {prm.manualPositions
            ? <><span className="badge warn">פריסה ידנית</span><button className="btn small" onClick={() => set({ manualPositions: null })}>חזרה לאוטומטי</button></>
            : <button className="btn small" data-testid={tid('manual')} onClick={() => set({ manualPositions: items.map((m) => m.purlin!.sSlope * (prm.measure === 'horizontal' ? 1 : 1)) })}>עריכה ידנית של המיקומים</button>}
        </div>
        {prm.manualPositions && (
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

export function RoofPanel() {
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const pu = p.building.purlins;
  const purlins = d.members.filter((m) => m.purlin).sort((a, b) => a.purlin!.index - b.purlin!.index);
  const L = purlins.filter((m) => m.purlin!.side === 'L'), R = purlins.filter((m) => m.purlin!.side === 'R'), M = purlins.filter((m) => m.purlin!.side === 'M');
  const nSpl = d.splices.filter((s) => s.memberId.startsWith('PL.')).length;
  const exec = (c: Command) => store.exec(c);
  return (
    <div className="panel-body" data-testid="roof-panel">
      <div className="panel-title">מערכת פטות</div>
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
      <div className="hint">הפריסה מתחילה {p.building.roofType === 'gable' ? 'ברכס, לכל צד בנפרד,' : 'בקצה שנבחר'} ומתקדמת עד הקצה החיצוני של קורת הגג כולל הקונזולה. הפטה האחרונה בקצה, והשארית נשארת במפתח האחרון בלבד.</div>
      {p.building.roofType === 'gable'
        ? <><SideEditor side="left" title="שיפוע שמאל" items={L} /><SideEditor side="right" title="שיפוע ימין" items={R} /></>
        : <SideEditor side="left" title="שיפוע הגג" items={M} />}
      <div className="panel-title">חלוקה לחלקי ייצור</div>
      <div className="hint">אורך חומר גלם: {(p.settings.stockLength / 1000).toFixed(2)} מ'. ההצעה ממקמת חיבורי המשך מעל מסגרות, רק במקום הנדרש — לא בכל מסגרת. כל חיבור מסומן "דורש תכנון".</div>
      <div className="row">
        <button className="btn" data-testid="propose-purlin-splices" onClick={() => exec(proposeSplicesFor(purlins.map((m) => m.id)))}>הצעת חיבורי המשך לכל הפטות</button>
        <button className="btn" disabled={!nSpl} onClick={() => exec({
          label: 'ניקוי חיבורי המשך בפטות',
          run: (pp) => ({ ...structuredClone(pp), splices: Object.fromEntries(Object.entries(pp.splices).filter(([k]) => !k.startsWith('PL.'))) }),
        })}>ניקוי</button>
      </div>
      <div className="hint">חיבורי המשך בפטות: <b data-testid="purlin-splice-count">{nSpl}</b></div>
    </div>
  );
}
