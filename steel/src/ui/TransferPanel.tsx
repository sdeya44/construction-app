import { useMemo, useState } from 'react';
import { planOmissions, setTransfers } from '../commands/commands';
import { SEAT_HE, SUPPORT_HE } from '../geometry/transfer';
import { transferUtil, SIZE_LABEL, sizingCfg, type SizeStatus } from '../model/sizing';
import type { TransferDef, TbSeat, TbSupport } from '../model/types';
import { store, useStore } from '../store';
import { Dialog } from './Dialogs';
import { ProfilePicker } from './fields';

const SUPPORTS: TbSupport[] = ['A1', 'A2', 'A3', 'A4', 'A5'];
const SEATS: TbSeat[] = ['B1', 'B2', 'B3', 'B4'];
const SUP_HINT: Record<TbSupport, string> = { A1: 'הקורה על ראש העמוד; העמוד מתקצר. פשוט וחזק — מומלץ', A2: 'פלטת קצה מרותכת לקורה, מוברגת לפלטת סגירה בין אגפי העמוד', A3: 'פלטה מרותכת לווב העמוד; ווב הקורה מוברג. הכי זול; למפתחים קטנים', A4: '2 זוויתנים מוברגים לעמוד ולווב הקורה — הכל בברגים', A5: 'תושבת מוקשחת; הקורה מונחת ומוברגת — הכי נוח בהרכבה' };
const SEAT_HINT: Record<TbSeat, string> = { B1: 'כיסא משופע + פלטה על הקורה + 4 ברגים אנכיים', B2: 'טריז מרותך לקורת הגג, ברגים דרך אגף הקורה הנושאת — גובה מינימלי', B3: 'עמוד קצר עם ראש משופע — לפער גובה; לקצה קורה בלבד', B4: 'קורת הגג ממוסגרת לווב הקורה הנושאת (עם A1 בלבד) — הכי נמוך' };

function useLineLabel() {
  const d = useStore((s) => s.derived);
  return (id: string) => d.section?.lines.find((l) => l.id === id)?.label ?? id;
}
function frameNo(id: string) { const fr = [...store.state.project.building.frames].sort((a, b) => a.y - b.y); return fr.findIndex((f) => f.id === id) + 1; }

/** שורת עריכה של קורה נושאת אחת (בחלון ובפאנל) */
function TransferRow({ t, onChange, onRemove }: { t: TransferDef; onChange: (patch: Partial<TransferDef>) => void; onRemove?: () => void }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const lab = useLineLabel();
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const span = (fr.find((f) => f.id === t.to)!.y - fr.find((f) => f.id === t.from)!.y) / 1000;
  const u = useMemo(() => { try { return transferUtil(p, d, t, t.profile); } catch { return null; } }, [p, d, t]);
  const st: SizeStatus = !u ? 'na' : u.util > 1 ? 'small' : u.util < sizingCfg(p).lowUtil ? 'big' : 'ok';
  return (
    <div className="op-card" data-testid={`tb-${t.id}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>ציר {lab(t.lineId)} · עמודים {frameNo(t.from)} ↔ {frameNo(t.to)} · מפתח {span.toFixed(2)} מ'</b>
        {onRemove && <button className="btn small" data-testid={`tb-restore-${t.id}`} onClick={onRemove}>החזר עמודים</button>}
      </div>
      <div className="hint">עמודים מבוטלים: {t.removed.map((f) => `${lab(t.lineId)}${frameNo(f)}`).join(', ')}</div>
      <div className="field prof"><label>קורה נושאת</label><ProfilePicker testId={`tb-prof-${t.id}`} value={t.profile} families={['IPE', 'HEA', 'HEB']} onCommit={(v) => onChange({ profile: v })} /></div>
      {u && <div className={`sz-note sz-${st}`} style={{ margin: '2px 0 6px' }}>{SIZE_LABEL[st]} — {u.text}</div>}
      <div className="field"><label>תמיכה בעמוד</label>
        <select className="inp" data-testid={`tb-sup-${t.id}`} value={t.support} onChange={(e) => onChange({ support: e.target.value as TbSupport })}>
          {SUPPORTS.map((s) => <option key={s} value={s}>{s} · {SUPPORT_HE[s]}</option>)}
        </select></div>
      <div className="hint">{SUP_HINT[t.support]}</div>
      <div className="field"><label>קורת גג על הקורה</label>
        <select className="inp" data-testid={`tb-seat-${t.id}`} value={t.seat} onChange={(e) => onChange({ seat: e.target.value as TbSeat })}>
          {SEATS.map((s) => <option key={s} value={s}>{s} · {SEAT_HE[s]}</option>)}
        </select></div>
      <div className="hint">{SEAT_HINT[t.seat]}</div>
    </div>
  );
}

/** חלון "בטל עמודים": מהעמודים שנבחרו — רצפים, מפתח חדש, הצעת חתך ובחירת חיבורים */
export function OmitDialog({ columnIds, onClose }: { columnIds: string[]; onClose: () => void }) {
  const p = useStore((s) => s.project);
  const plan = useMemo(() => planOmissions(p, columnIds), [p, columnIds]);
  const [defs, setDefs] = useState<TransferDef[]>(plan.defs);
  const apply = () => {
    const others = (p.building.transfers ?? []).filter((t) => !defs.some((x) => x.id === t.id || (x.lineId === t.lineId && x.removed.some((f) => t.removed.includes(f)))));
    if (store.exec(setTransfers([...others, ...defs]))) { store.toast('ok', `בוטלו עמודים — ${defs.length} קורות נושאות`); store.select([]); }
    onClose();
  };
  return (
    <Dialog title="דילול עמודים — קורה נושאת" onClose={onClose} wide testId="omit-dialog"
      footer={<><button className="btn primary" disabled={!defs.length} onClick={apply} data-testid="omit-apply">החל</button><button className="btn" onClick={onClose}>ביטול</button></>}>
      {plan.errors.map((e, i) => <div key={i} className="issue error"><span className="ic">!</span>{e}</div>)}
      {defs.map((t, i) => <TransferRow key={t.id} t={t} onChange={(patch) => setDefs(defs.map((x, k) => (k === i ? { ...x, ...patch } : x)))} />)}
      <div className="issue warning"><span className="ic">!</span><div>במסגרות ללא עמוד היציבות לרוחב עוברת דרך קושרות הגג/הקירות. גיאומטריה והערכת גודל בלבד — נדרש אישור מהנדס.</div></div>
    </Dialog>
  );
}

/** פאנל "קורות נושאות": רשימה, עריכה והחזרת עמודים */
export function TransferPanel() {
  const p = useStore((s) => s.project);
  const list = p.building.transfers ?? [];
  const set = (defs: TransferDef[]) => store.exec(setTransfers(defs));
  return (
    <div className="panel-body" data-testid="tb-panel">
      <div className="panel-title">קורות נושאות (דילול עמודים)</div>
      {!list.length && <div className="hint">אין עמודים מבוטלים. לביטול: בוחרים עמודים בתלת־ממד (Ctrl ללחיצה מרובה) ← "בטל עמודים" בסרגל ההקשר. התוכנה מציעה קורה נושאת בין העמודים שנותרו, עם בחירת תמיכה (A1–A5) וחיבור קורות הגג (B1–B4).</div>}
      {list.map((t, i) => <TransferRow key={t.id} t={t} onChange={(patch) => set(list.map((x, k) => (k === i ? { ...x, ...patch } : x)))} onRemove={() => set(list.filter((_, k) => k !== i))} />)}
    </div>
  );
}
