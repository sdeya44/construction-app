import { useState } from 'react';
import { proposeSplicesFor, setSplices, setSplicesAuto } from '../commands/commands';
import { fromMm } from '../core/units';
import type { Member } from '../model/types';
import { store, useStore } from '../store';
import { LenField } from './fields';
import { Icon } from './icons';

/** חלקי ייצור וחיבורי המשך של מכלול אחד: הוספה, הזזה ומחיקה של מיקומי חיבור. */
export function SpliceEditor({ m }: { m: Member }) {
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const u = p.displayUnit;
  const parts = d.parts.filter((x) => x.memberId === m.id);
  // מיקומים: שנקבעו ידנית, או האוטומטיים (נגזרים) כשלא נקבע דבר
  const manual = m.id in p.splices;
  const pos = manual ? p.splices[m.id] : d.splices.filter((x) => x.memberId === m.id).map((x) => x.t);
  const isAuto = !manual && pos.length > 0;
  const [add, setAdd] = useState<number | null>(null);
  const f = (mm: number) => (u === 'm' ? `${fromMm(mm, 'm').toFixed(3)}` : mm.toFixed(0));
  const stock = p.settings.stockLength;
  const total = parts.length ? parts[parts.length - 1].t1 - parts[0].t0 : 0;
  return (
    <>
      <div className="panel-title">מכלול וחלקי ייצור <span className="badge">{parts.length} חלקים</span></div>
      <table className="tbl" data-testid="parts-table">
        <thead><tr><th>חלק</th><th>מ-</th><th>עד</th><th>אורך</th></tr></thead>
        <tbody>
          {parts.map((x) => (
            <tr key={x.id} style={{ background: x.length > stock + 0.5 ? 'var(--warn-soft)' : undefined }}>
              <td style={{ direction: 'ltr', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11 }}>P{x.index}</td>
              <td className="readonly">{f(x.t0)}</td><td className="readonly">{f(x.t1)}</td>
              <td className="readonly" data-testid={`part-len-${x.index}`}>{f(x.length)}{x.length > stock + 0.5 ? ' ◂ ארוך' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">אורך מכלול {f(total)}. מרחקים לאורך ציר האלמנט מנקודת ההתחלה{m.purlin ? ' (קצה הפטה כולל הקונזולה)' : ''}.</div>
      <div className="panel-title">חיבורי המשך</div>
      {pos.map((t, i) => (
        <div className="row" key={i} style={{ marginBottom: 4 }}>
          {isAuto ? <span className="badge blue">אוטומטי</span> : <span className="badge warn">ידני</span>}
          <div style={{ flex: 1 }}><LenField mm={t} unit={u} testId={`splice-${i}`} onCommit={(v) => { const a = [...pos]; a[i] = v; store.exec(setSplices(m.id, a)); }} /></div>
          <button className="icon-btn" title="מחיקת חיבור" data-testid={`splice-del-${i}`} onClick={() => store.exec(setSplices(m.id, pos.filter((_, k) => k !== i)))}><Icon name="x" /></button>
        </div>
      ))}
      <div className="row">
        {add === null
          ? <button className="btn small" data-testid="splice-add" onClick={() => setAdd(Math.round(total / 2))}><Icon name="plus" />חיבור</button>
          : <>
            <div style={{ width: 120 }}><LenField mm={add} unit={u} testId="splice-new" onCommit={setAdd} /></div>
            <button className="btn small primary" data-testid="splice-add-ok" onClick={() => { store.exec(setSplices(m.id, [...pos, add])); setAdd(null); }}>הוספה</button>
            <button className="btn small" onClick={() => setAdd(null)}>ביטול</button>
          </>}
        <button className="btn small" data-testid="splice-propose" onClick={() => store.exec(proposeSplicesFor([m.id]))}>הצעה אוטומטית</button>
        {manual && <button className="btn small" data-testid="splice-auto" title="ביטול המיקומים הידניים — חזרה לחלוקה האוטומטית" onClick={() => store.exec(setSplicesAuto(m.id))}>חזרה לאוטומטי</button>}
      </div>
      <div className="hint">{isAuto ? `חלוקה אוטומטית: מוט מלא (${(stock / 1000).toFixed(1)} מ') מנקודת ההתחלה והשלמה בסוף, התפר מוזז כך שלא ייפול על תומך פטה. שינוי מיקום הופך את החלוקה לידנית. ` : ''}קורת I: שתי פלטות קצה PL12 מוגבהות, 8×M16. חיבור המשך אינו מאושר הנדסית — יש לתכנן ולאשר את מיקומו. אורך חומר הגלם וכיבוי החלוקה האוטומטית — מבנה ← פרטי פרויקט והגדרות.</div>
    </>
  );
}
