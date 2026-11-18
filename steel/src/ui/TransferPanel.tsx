import { useMemo, useState } from 'react';
import { planOmissions, setBuilding, setTransfers } from '../commands/commands';
import { SEAT_HE, SUPPORT_HE } from '../geometry/transfer';
import { roofTrussLoad, transferLoads, transferUtil, SIZE_LABEL, sizingCfg, type SizeStatus } from '../model/sizing';
import { defaultTrussSpec } from '../geometry/truss';
import { TrussWizard } from './TrussWizard';
import type { RoofTrussParams, TransferDef, TbSeat, TbSupport } from '../model/types';
import { store, useStore } from '../store';
import { Dialog } from './Dialogs';
import { ProfilePicker, useEdit } from './fields';

const SUPPORTS: TbSupport[] = ['A1', 'A2', 'A3', 'A4', 'A5'];
const SEATS: TbSeat[] = ['B1', 'B2', 'B3', 'B4'];
const SUP_HINT: Record<TbSupport, string> = { A1: 'הקורה על ראש העמוד; העמוד מתקצר. פשוט וחזק — מומלץ', A2: 'פלטת קצה מרותכת לקורה, מוברגת לפלטת סגירה בין אגפי העמוד', A3: 'פלטה מרותכת לווב העמוד; ווב הקורה מוברג. הכי זול; למפתחים קטנים', A4: '2 זוויתנים מוברגים לעמוד ולווב הקורה — הכל בברגים', A5: 'תושבת מוקשחת; הקורה מונחת ומוברגת — הכי נוח בהרכבה' };
const SEAT_HINT: Record<TbSeat, string> = { B1: 'כיסא משופע + פלטה על הקורה + 4 ברגים אנכיים', B2: 'טריז מרותך לקורת הגג, ברגים דרך אגף הקורה הנושאת — גובה מינימלי', B3: 'עמוד קצר עם ראש משופע — לפער גובה; לקצה קורה בלבד', B4: 'קורת הגג ממוסגרת לווב הקורה הנושאת (עם A1 בלבד) — הכי נמוך' };

function useLineLabel() {
  const d = useStore((s) => s.derived);
  return (id: string) => d.section?.lines.find((l) => l.id === id)?.label ?? id;
}
function frameNo(id: string) { const fr = [...store.state.project.building.frames].sort((a, b) => a.y - b.y); return fr.findIndex((f) => f.id === id) + 1; }

/** ציורים קטנים (מבט צד) לבחירת התמיכה והמושב */
const BEAM = '#c4600a', COL = '#3d4a44', PLT = '#7a3fc4';
function SupPic({ k }: { k: TbSupport }) {
  // עמוד במרכז, קורה נושאת אופקית מגיעה משמאל
  const col = <rect x={k === 'A1' ? 26 : 34} y={k === 'A1' ? 22 : 6} width={10} height={k === 'A1' ? 20 : 36} fill="#dfe5e1" stroke={COL} strokeWidth={1} />;
  return (
    <svg viewBox="0 0 60 44" width={54} height={40} aria-hidden="true">
      {col}
      {k === 'A1' && <><rect x={4} y={10} width={52} height={10} fill="#fde8d7" stroke={BEAM} /><rect x={22} y={20} width={18} height={2.5} fill={PLT} /></>}
      {k !== 'A1' && <rect x={2} y={12} width={k === 'A3' ? 30 : 28} height={12} fill="#fde8d7" stroke={BEAM} />}
      {k === 'A2' && <rect x={30} y={10} width={3} height={16} fill={PLT} />}
      {k === 'A3' && <rect x={24} y={14} width={12} height={8} fill="none" stroke={PLT} strokeWidth={1.4} />}
      {k === 'A4' && <><rect x={28} y={12} width={6} height={12} fill="none" stroke={PLT} strokeWidth={1.4} /></>}
      {k === 'A5' && <><rect x={20} y={24} width={14} height={3} fill={PLT} /><polygon points="33,27 33,36 24,27" fill={PLT} /></>}
    </svg>
  );
}
function SeatPic({ k }: { k: TbSeat }) {
  // קורה נושאת בחתך (I) למטה, קורת גג משופעת מעליה
  return (
    <svg viewBox="0 0 60 44" width={54} height={40} aria-hidden="true">
      <path d="M22 30h16M30 30v10M22 40h16" stroke={BEAM} strokeWidth={2.4} fill="none" />
      {k === 'B1' && <><rect x={20} y={25} width={20} height={4} fill={PLT} /><polygon points="22,25 38,25 38,21" fill={PLT} /><line x1={2} y1={23} x2={58} y2={13} stroke={COL} strokeWidth={5} /></>}
      {k === 'B2' && <><polygon points="22,29 38,29 38,25" fill={PLT} /><line x1={2} y1={27} x2={58} y2={17} stroke={COL} strokeWidth={5} /></>}
      {k === 'B3' && <><rect x={27} y={16} width={6} height={13} fill="#e3e8e5" stroke={PLT} /><line x1={2} y1={18} x2={34} y2={11} stroke={COL} strokeWidth={5} /></>}
      {k === 'B4' && <><rect x={33} y={30} width={2.5} height={10} fill={PLT} /><line x1={36} y1={36} x2={58} y2={32} stroke={COL} strokeWidth={6} /></>}
    </svg>
  );
}

/** שורת עריכה של קורה נושאת אחת (בחלון ובפאנל) */
function TransferRow({ t, onChange, onRemove, embed }: { t: TransferDef; onChange: (patch: Partial<TransferDef>) => void; onRemove?: () => void; /** בחלון האלמנט: החתכים נבחרים ב"חתך וחומר" — כאן לקריאה בלבד */ embed?: boolean }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const lab = useLineLabel();
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const span = (fr.find((f) => f.id === t.to)!.y - fr.find((f) => f.id === t.from)!.y) / 1000;
  const u = useMemo(() => { try { return transferUtil(p, d, t, t.profile); } catch { return null; } }, [p, d, t]);
  const tl = useMemo(() => { try { return { points: transferLoads(p, d, t).points }; } catch { return {}; } }, [p, d, t]);
  const st: SizeStatus = !u ? 'na' : u.util > 1 ? 'small' : u.util < sizingCfg(p).lowUtil ? 'big' : 'ok';
  return (
    <div className="op-card" data-testid={`tb-${t.id}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>ציר {lab(t.lineId)} · עמודים {frameNo(t.from)} ↔ {frameNo(t.to)} · מפתח {span.toFixed(2)} מ'</b>
        {onRemove && <button className="btn small" data-testid={`tb-restore-${t.id}`} onClick={onRemove}>החזר עמודים</button>}
      </div>
      <div className="hint">עמודים מבוטלים: {t.removed.map((f) => `${lab(t.lineId)}${frameNo(f)}`).join(', ')}</div>
      <div className="seg scope-seg" role="radiogroup" aria-label="סוג האלמנט הנושא">
        <button className={`tbtn${(t.kind ?? 'beam') === 'beam' ? ' on' : ''}`} data-testid={`tb-kind-beam-${t.id}`} onClick={() => onChange({ kind: 'beam' })}>קורה</button>
        <button className={`tbtn${t.kind === 'truss' ? ' on' : ''}`} data-testid={`tb-kind-truss-${t.id}`} onClick={() => onChange({ kind: 'truss', support: 'A1', seat: t.seat === 'B4' ? 'B1' : t.seat, truss: t.truss ?? defaultTrussSpec((fr.findIndex((f) => f.id === t.to) - fr.findIndex((f) => f.id === t.from)) * 2, Math.max(1000, Math.round(span * 1000 / 12 / 100) * 100)) })}>מסבך</button>
      </div>
      {t.kind === 'truss' && t.truss
        ? <TrussWizard spec={t.truss} span={span * 1000} chordFamilies={['HEA', 'HEB', 'IPE', 'RHS', 'SHS']} loads={tl} testId={`tw-${t.id}`} readOnlyProfiles={embed} onChange={(sp) => onChange({ truss: sp })}
            frames={t.removed.map((fid) => (fr.find((f) => f.id === fid)?.y ?? 0) - fr.find((f) => f.id === t.from)!.y)}
            note="נתמך על ראש העמוד (A1); קורות הגג על הצמתים העליונים. חגורה חלולה (RHS/SHS): פלטת תמיכה מרותכת וברגים מחוץ לצינור, חיבור המשך בפלנץ." />
        : <>
          {!embed && <div className="field prof"><label>קורה נושאת</label><ProfilePicker testId={`tb-prof-${t.id}`} value={t.profile} families={['IPE', 'HEA', 'HEB']} onCommit={(v) => onChange({ profile: v })} /></div>}
          {u && <div className={`sz-note sz-${st}`} style={{ margin: '2px 0 6px' }}>{SIZE_LABEL[st]} — {u.text}</div>}
        </>}
      {t.kind !== 'truss' && <>
        <div className="tb-lbl">תמיכה בעמוד</div>
        <div className="tile-row" role="radiogroup" aria-label="תמיכה בעמוד">
          {SUPPORTS.map((k) => <button key={k} role="radio" aria-checked={t.support === k} className={`pic-tile${t.support === k ? ' on' : ''}`} data-testid={`tb-sup-tile-${t.id}-${k}`} title={SUP_HINT[k]} onClick={() => onChange({ support: k })}><SupPic k={k} /><b>{k}</b><span>{SUPPORT_HE[k]}</span></button>)}
        </div>
        <div className="hint">{SUP_HINT[t.support]}</div>
      </>}
      <div className="tb-lbl">קורת גג על הקורה</div>
      <div className="tile-row" role="radiogroup" aria-label="קורת גג על הקורה">
        {SEATS.filter((k) => !(t.kind === 'truss' && (k === 'B4' || (k === 'B2' && /^(RHS|SHS)/i.test(t.truss?.profiles.top ?? ''))))).map((k) => <button key={k} role="radio" aria-checked={t.seat === k} className={`pic-tile${t.seat === k ? ' on' : ''}`} data-testid={`tb-seat-tile-${t.id}-${k}`} title={SEAT_HINT[k]} onClick={() => onChange({ seat: k })}><SeatPic k={k} /><b>{k}</b><span>{SEAT_HE[k]}</span></button>)}
      </div>
      <div className="hint">{SEAT_HINT[t.seat]}</div>
      {span * 1000 > p.settings.stockLength - 30 && <>
        <div className="field"><label>חלוקה (ארוך מ-{(p.settings.stockLength / 1000).toFixed(1)} מ')</label>
          <select className="inp" data-testid={`tb-splice-${t.id}`} value={t.splice ?? 'auto'} onChange={(e) => onChange({ splice: e.target.value as 'auto' | 'none' })}>
            <option value="auto">אוטומטית — חיבורי המשך מוברגים מחוץ למושבים</option>
            <option value="none">ללא — מוט אחד (הזמנה מיוחדת / הובלה ארוכה)</option>
          </select></div>
      </>}
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

/** חלון האלמנט: עריכת הקורה/המסבך הנושא שהאלמנט שייך אליו בלבד */
export function TransferShape({ id }: { id: string }) {
  const p = useStore((s) => s.project);
  const list = p.building.transfers ?? [];
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const set = (defs: TransferDef[]) => store.exec(setTransfers(defs));
  return <TransferRow t={list[i]} embed onChange={(patch) => set(list.map((x, k) => (k === i ? { ...x, ...patch } : x)))} onRemove={() => set(list.filter((_, k) => k !== i))} />;
}

/** מסבכי גג: הפעלה, מסגרות, צורה ואשף המסבך (חל על כל המסגרות שנבחרו) */
export function RoofTrussPanel() {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const rt = p.building.roofTruss;
  const cols = d.members.filter((m) => m.kind === 'column' && m.frameId === p.building.frames[0]?.id).sort((a, b) => a.start.x - b.start.x);
  const span = cols.length >= 2 ? cols[cols.length - 1].start.x - cols[0].start.x : p.building.width;
  const set = (patch: Partial<RoofTrussParams>) => store.exec(setBuilding({ roofTruss: { ...(rt ?? { enabled: false, frames: 'all', shape: 'flat', spec: defaultTrussSpec(evenPanels(span), depthFor(span), { top: p.building.rafterProfile }) }), ...patch } }));
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const hasRidge = d.members.filter((m) => m.kind === 'rafter' && m.frameId === fr[0]?.id).length >= 2;
  const sel = rt?.frames === 'all' || !rt ? fr.map((f) => f.id) : rt.frames;
  const ed = useEdit();
  const toggleFrame = (id: string) => { const s2 = new Set(sel); if (s2.has(id)) s2.delete(id); else s2.add(id); set({ frames: s2.size === fr.length ? 'all' : fr.filter((f) => s2.has(f.id)).map((f) => f.id) }); };
  return (
    <div className="panel-body" data-testid="rt-panel">
      {ed.showTitle && <div className="panel-title">מסבכי גג
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="rt-on" checked={!!rt?.enabled} onChange={(e) => set({ enabled: e.target.checked })} />פעיל</label>
      </div>}
      {ed.showTitle && <div className="hint">קורת הגג היא החגורה העליונה; חגורה תחתונה, אנכיים ואלכסונים מרותכים במסגריה; חיבורי המשך וחיבור החגורה לעמודים — ברגים בשטח. לחתך עם שני עמודים (מפתח אחד).</div>}
      {rt?.enabled && <>
        <div className="field"><label>מסגרות</label>
          <div className="bay-pick">{fr.map((f, i) => <button key={f.id} className={`tbtn${sel.includes(f.id) ? ' on' : ''}`} data-testid={`rt-f-${i + 1}`} onClick={() => toggleFrame(f.id)}>{i + 1}</button>)}</div></div>
        <div className="field"><label>צורה</label>
          <select className="inp" data-testid="rt-shape" value={rt.shape} onChange={(e) => set({ shape: e.target.value as 'flat' | 'parallel' | 'scissor', rise: rt.rise ?? 1000 })}>
            <option value="flat">חגורה תחתונה אופקית</option><option value="parallel">חגורה תחתונה מקבילה לגג</option><option value="scissor">"מספריים" — מוגבהת ברכס</option>
          </select></div>
        <div className="field prof"><label>חגורה עליונה (= קורת הגג)</label><span className="readonly mono">{p.building.rafterProfile}</span></div>
        <TrussWizard spec={{ ...rt.spec, profiles: { ...rt.spec.profiles, top: p.building.rafterProfile } }} span={span} chordFamilies={['HEA', 'HEB', 'IPE', 'RHS', 'SHS']} loads={{ q: roofTrussLoad(p) }} testId="tw-roof" readOnlyProfiles={ed.embed}
          roof={{ ridge: hasRidge, shape: rt.shape, rise: rt.rise ?? 1000, onRise: (v) => set({ rise: v }) }}
          onChange={(sp) => { if (sp.profiles.top !== rt.spec.profiles.top) store.exec(setBuilding({ rafterProfile: sp.profiles.top, roofTruss: { ...rt, spec: sp } })); else set({ spec: sp }); }}
          note="בגג דו-שיפועי: השדות ליד הרכס — אלכסונים לרכס, והחגורה התחתונה נחתכת ברכס (חיבור מוברג)." />
      </>}
    </div>
  );
}
const evenPanels = (span: number) => { const n = Math.max(4, Math.round(span / 1500)); return n % 2 ? n + 1 : n; };
const depthFor = (span: number) => Math.max(800, Math.round(span / 12 / 100) * 100);
