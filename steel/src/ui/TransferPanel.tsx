import { useMemo, useState } from 'react';
import { planOmissions, setBuilding, setTransfers } from '../commands/commands';
import { SEAT_HE, SUPPORT_HE } from '../geometry/transfer';
import { roofTrussLoad, transferLoads, transferUtil, SIZE_LABEL, sizingCfg, type SizeStatus } from '../model/sizing';
import { defaultTrussSpec } from '../geometry/truss';
import { TrussWizard } from './TrussWizard';
import type { RoofTrussParams, TransferDef, TbSeat, TbSupport } from '../model/types';
import { store, useStore } from '../store';
import { Dialog } from './Dialogs';
import { NumField, ProfilePicker, useEdit, Help } from './fields';
import { OffCard } from './pics';
import { Collapsed, groupBy, PanelAlerts, SumCard, TabbedEditor, type EditorTab, type Pill } from './summary';
import { FramePickStrip } from './schematics';

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
export function TransferRow({ t, onChange, onRemove, embed, onApplyLine, lineCount, part }: { t: TransferDef; onChange: (patch: Partial<TransferDef>) => void; onRemove?: () => void; onApplyLine?: () => void; lineCount?: number; /** לשונית בעורך (1.42): רק החלק הזה */ part?: 'beam' | 'support' | 'seat' | 'knee' | 'adv'; /** בחלון האלמנט: החתכים נבחרים ב"חתך וחומר" — כאן לקריאה בלבד */ embed?: boolean }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const lab = useLineLabel();
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const span = (fr.find((f) => f.id === t.to)!.y - fr.find((f) => f.id === t.from)!.y) / 1000;
  const u = useMemo(() => { try { return transferUtil(p, d, t, t.profile); } catch { return null; } }, [p, d, t]);
  const tl = useMemo(() => { try { return { points: transferLoads(p, d, t).points }; } catch { return {}; } }, [p, d, t]);
  const st: SizeStatus = !u ? 'na' : u.util > 1 ? 'small' : u.util < sizingCfg(p).lowUtil ? 'big' : 'ok';
  const show = (k: string) => !part || part === k;
  return (
    <div className={part ? '' : 'op-card'} data-testid={`tb-${t.id}`}>
      {!part && <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>ציר {lab(t.lineId)} · עמודים {frameNo(t.from)} ↔ {frameNo(t.to)} · מפתח {span.toFixed(2)} מ'</b>
        {onRemove && <button className="btn small" data-testid={`tb-restore-${t.id}`} onClick={onRemove}>החזר עמודים</button>}
      </div>
      <div className="hint">עמודים מבוטלים: {t.removed.map((f) => `${lab(t.lineId)}${frameNo(f)}`).join(', ')}</div>
      </>}
      {show('beam') && <>
      <div className="seg scope-seg" role="radiogroup" aria-label="סוג האלמנט הנושא">
        <button className={`tbtn${(t.kind ?? 'beam') === 'beam' ? ' on' : ''}`} data-testid={`tb-kind-beam-${t.id}`} onClick={() => onChange({ kind: 'beam' })}>קורה</button>
        <button className={`tbtn${t.kind === 'truss' ? ' on' : ''}`} data-testid={`tb-kind-truss-${t.id}`} onClick={() => onChange({ kind: 'truss', support: 'A1', seat: t.seat === 'B4' ? 'B1' : t.seat, truss: t.truss ?? defaultTrussSpec((fr.findIndex((f) => f.id === t.to) - fr.findIndex((f) => f.id === t.from)) * 2, Math.max(1000, Math.round(span * 1000 / 12 / 100) * 100)) })}>מסבך</button>
      </div>
      {t.kind === 'truss' && <>
        <div className="tb-lbl">מיקום המסבך</div>
        <div className="seg scope-seg" role="radiogroup" aria-label="מיקום המסבך">
          <button role="radio" aria-checked={(t.trussFit ?? 'top') === 'top'} className={`tbtn${(t.trussFit ?? 'top') === 'top' ? ' on' : ''}`} data-testid={`tb-fit-top-${t.id}`} onClick={() => onChange({ trussFit: 'top' })}>על ראשי העמודים</button>
          <button role="radio" aria-checked={t.trussFit === 'between'} className={`tbtn${t.trussFit === 'between' ? ' on' : ''}`} data-testid={`tb-fit-between-${t.id}`} onClick={() => onChange({ trussFit: 'between' })}>העמודים עד הקורה — המסבך ביניהם</button>
        </div>
        <div className="hint">{t.trussFit === 'between'
          ? 'העמודים התומכים ממשיכים עד קורת הגג (כמו במסגרת רגילה); המסבך בין העמודים, מתחת לראשיהם — כמו קורת אגד B, בלי אנך בקצוות (העמוד סוגר את המסבך). חלוקת השדות לפי צירי העמודים.'
          : 'העמודים התומכים מתקצרים; המסבך יושב על ראשיהם (A1) וקורות הגג על הצמתים העליונים.'}</div>
        {t.trussFit === 'between' && <>
          <div className="tb-lbl">חיבור החגורות לעמוד</div>
          <div className="seg scope-seg" role="radiogroup" aria-label="חיבור החגורות לעמוד">
            {([['auto', 'אוטומטי'], ['fin', 'סנפיר'], ['plate', 'פלטה אל פלטה']] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={(t.trussConn ?? 'auto') === k} className={`tbtn${(t.trussConn ?? 'auto') === k ? ' on' : ''}`} data-testid={`tb-conn-${k}-${t.id}`} onClick={() => onChange({ trussConn: k })}>{l}</button>
            ))}
          </div>
          {(t.trussConn ?? 'auto') !== 'plate' && <div className="seg scope-seg" role="radiogroup" aria-label="כיוון הסנפיר" style={{ marginTop: 4 }}>
            {([['horizontal', 'פח שוכב — החגורה מונחת עליו'], ['vertical', 'פח עומד במישור המסבך']] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={(t.finOrient ?? 'horizontal') === k} className={`tbtn${(t.finOrient ?? 'horizontal') === k ? ' on' : ''}`} data-testid={`tb-orient-${k}-${t.id}`} onClick={() => onChange({ finOrient: k })}>{l}</button>
            ))}
          </div>}
          <TrussConnPic conn={t.trussConn ?? 'auto'} orient={t.finOrient ?? 'horizontal'} />
          <div className="hint">סנפיר: פח מרותך לעמוד במסגריה — לווב בין האגפים (עמוד I שהווב פונה למסבך) או ישירות לדופן (עמוד RHS / אגף שפונה למסבך); בחגורה לשונית בחריץ, 2 ברגים בשטח. פח שוכב — מניחים את החגורה על הפח ומכניסים ברגים אנכיים. פלטה אל פלטה: כשהחגורה רחבה מהמרווח בין האגפים — פלטת סגירה רחבה על קצות האגפים ופלטת קצה בחגורות. "אוטומטי" בוחר סנפיר כשהחגורה נכנסת, אחרת פלטה אל פלטה.</div>
        </>}
      </>}
      {t.kind === 'truss' && t.truss
        ? <TrussWizard spec={t.truss} span={span * 1000} chordFamilies={['HEA', 'HEB', 'IPE', 'RHS', 'SHS']} loads={tl} testId={`tw-${t.id}`} readOnlyProfiles={embed} onChange={(sp) => onChange({ truss: sp })}
            frames={t.removed.map((fid) => (fr.find((f) => f.id === fid)?.y ?? 0) - fr.find((f) => f.id === t.from)!.y)}
            note={t.trussFit === 'between' ? 'בין העמודים; קורות הגג על הצמתים העליונים. חיבור המשך בחגורה חלולה — בפלנץ.' : 'נתמך על ראש העמוד (A1); קורות הגג על הצמתים העליונים. חגורה חלולה (RHS/SHS): פלטת תמיכה מרותכת וברגים מחוץ לצינור, חיבור המשך בפלנץ.'} />
        : <>
          {!embed && <div className="field prof"><label>קורה נושאת</label><ProfilePicker testId={`tb-prof-${t.id}`} value={t.profile} families={['IPE', 'HEA', 'HEB']} onCommit={(v) => onChange({ profile: v })} /></div>}
          {u && (u.tags
            ? <div className={`tb-tags sz-${st}`} title={u.text} data-testid={`tb-tags-${t.id}`}>
                <span className="tb-tag main">{SIZE_LABEL[st]}</span>
                <span className="tb-tag">מפתח {(u.tags.span / 1000).toFixed(2)} מ'</span>
                <span className={`tb-tag${u.tags.uM > 1 ? ' bad' : u.tags.uM > 0.85 ? ' warn' : ''}`}>כפיפה {Math.round(u.tags.uM * 100)}%</span>
                <span className={`tb-tag${u.tags.dl > u.tags.dlLim ? ' bad' : ''}`}>שקיעה {u.tags.dl.toFixed(0)} / {u.tags.dlLim.toFixed(0)} מ"מ</span>
                <span className="tb-tag muted">עומס מקורה ≈{u.tags.P.toFixed(1)} kN</span>
              </div>
            : <div className={`sz-note sz-${st}`} style={{ margin: '2px 0 6px' }}>{SIZE_LABEL[st]} — {u.text}</div>)}
        </>}
      </>}
      {show('support') && <>
      {t.kind !== 'truss' && <>
        <div className="tb-lbl">תמיכה בעמוד</div>
        <div className="tile-row" role="radiogroup" aria-label="תמיכה בעמוד">
          {SUPPORTS.map((k) => <button key={k} role="radio" aria-checked={t.support === k} className={`pic-tile${t.support === k ? ' on' : ''}`} data-testid={`tb-sup-tile-${t.id}-${k}`} title={SUP_HINT[k]} onClick={() => onChange({ support: k })}><SupPic k={k} /><b>{k}</b><span>{SUPPORT_HE[k]}</span></button>)}
        </div>
        <div className="hint">{SUP_HINT[t.support]}</div>
      </>}
      </>}
      {show('seat') && <>
      <div className="tb-lbl">קורת גג על הקורה</div>
      <div className="tile-row" role="radiogroup" aria-label="קורת גג על הקורה">
        {SEATS.filter((k) => !(t.kind === 'truss' && (k === 'B4' || (k === 'B2' && /^(RHS|SHS)/i.test(t.truss?.profiles.top ?? ''))))).map((k) => <button key={k} role="radio" aria-checked={t.seat === k} className={`pic-tile${t.seat === k ? ' on' : ''}`} data-testid={`tb-seat-tile-${t.id}-${k}`} title={SEAT_HINT[k]} onClick={() => onChange({ seat: k })}><SeatPic k={k} /><b>{k}</b><span>{SEAT_HE[k]}</span></button>)}
      </div>
      <div className="hint">{SEAT_HINT[t.seat]}</div>
      </>}
      {show('knee') && <>
      {(t.kind ?? 'beam') === 'beam' && <>
        <label className="row" style={{ marginTop: 6 }}><input type="checkbox" data-testid={`tb-knee-${t.id}`} checked={!!t.knee?.enabled} onChange={(e) => onChange({ knee: { ...(t.knee ?? { profile: 'L50x5', drop: 800, angle: 45 }), enabled: e.target.checked } })} />אלכסוני Y מהקורה לעמודים התומכים</label>
        {t.knee?.enabled && <>
          <div className="field prof"><label>חתך אלכסון</label><ProfilePicker testId={`tb-knee-prof-${t.id}`} value={t.knee.profile} families={['L', 'RHS', 'SHS', 'CHS']} onCommit={(v) => onChange({ knee: { ...t.knee!, profile: v } })} /></div>
          <div className="field"><label>ירידה מתחתית הקורה</label><NumField testId={`tb-knee-drop-${t.id}`} value={t.knee.drop} suffix='מ"מ' onCommit={(v) => onChange({ knee: { ...t.knee!, drop: Math.max(200, v) } })} /></div>
          <div className="field"><label>זווית מהאופק</label><NumField testId={`tb-knee-ang-${t.id}`} value={t.knee.angle} suffix="°" onCommit={(v) => onChange({ knee: { ...t.knee!, angle: Math.max(25, Math.min(65, v)) } })} /></div>
          <div className="hint">זוויתן: מוברג לפח מרותך; RHS: פח + לשונית בחריץ. בבדיקת החתך המפתח האפקטיבי קטן בהיטל האלכסונים (הערכה).</div>
        </>}
      </>}
      </>}
      {show('adv') && <>
      {onApplyLine && (lineCount ?? 0) > 1 && <button className="btn small" data-testid={`tb-apply-line-${t.id}`} title="חתך, סוג, תמיכה, חיבור קורות הגג ואלכסונים — לכל הקורות הנושאות בציר" onClick={onApplyLine}>החל על כל {lineCount} הקורות בציר {lab(t.lineId)}</button>}
      {span * 1000 > p.settings.stockLength - 30 && <>
        <div className="field"><label>חלוקה (ארוך מ-{(p.settings.stockLength / 1000).toFixed(1)} מ')</label>
          <select className="inp" data-testid={`tb-splice-${t.id}`} value={t.splice ?? 'auto'} onChange={(e) => onChange({ splice: e.target.value as 'auto' | 'none' })}>
            <option value="auto">אוטומטית — חיבורי המשך מוברגים מחוץ למושבים</option>
            <option value="none">ללא — מוט אחד (הזמנה מיוחדת / הובלה ארוכה)</option>
          </select></div>
      </>}
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
/** חתימת קבוצה: קורות שכל ההגדרות שלהן זהות (חוץ ממיקום) נערכות יחד */
const tbSig = (t: TransferDef) => JSON.stringify([t.lineId, t.kind ?? 'beam', t.profile, t.support, t.seat, t.knee?.enabled ? t.knee : null, t.trussFit, t.trussConn, t.finOrient, t.splice, t.kind === 'truss' ? t.truss : null]);

/** לשוניות העורך — קורה / תמיכה / קורת גג / אלכסוני Y / מתקדם */
function tbTabs(t: TransferDef, onChange: (patch: Partial<TransferDef>) => void, extra?: { onApplyLine?: () => void; lineCount?: number; embed?: boolean }): EditorTab[] {
  const r = (part: 'beam' | 'support' | 'seat' | 'knee' | 'adv') => () => <TransferRow t={t} part={part} onChange={onChange} {...extra} />;
  return [
    { key: 'beam', label: t.kind === 'truss' ? 'מסבך' : 'קורה', render: r('beam') },
    { key: 'support', label: 'תמיכה בעמוד', render: r('support'), hidden: t.kind === 'truss' },
    { key: 'seat', label: 'קורת גג על הקורה', render: r('seat') },
    { key: 'knee', label: 'אלכסוני Y', render: r('knee'), hidden: t.kind === 'truss' },
    { key: 'adv', label: 'מתקדם', render: r('adv') },
  ];
}

export function TransferPanel() {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const lab = useLineLabel();
  const list = p.building.transfers ?? [];
  const set = (defs: TransferDef[]) => store.exec(setTransfers(defs));
  /** עריכה: קבוצה (חתימה) או קורה אחת (מזהה) */
  const [edit, setEdit] = useState<{ ids: string[]; title: string } | null>(null);
  const fr = [...p.building.frames].sort((a, b) => a.y - b.y);
  const spanOf = (t: TransferDef) => ((fr.find((f) => f.id === t.to)?.y ?? 0) - (fr.find((f) => f.id === t.from)?.y ?? 0)) / 1000;
  const util = useMemo(() => new Map(list.map((t) => { try { return [t.id, transferUtil(p, d, t, t.profile)] as const; } catch { return [t.id, null] as const; } })), [p, d, list]);
  const patchIds = (ids: string[], patch: Partial<TransferDef>) => set(list.map((x) => (ids.includes(x.id) ? { ...x, ...patch } : x)));
  const issues = d.issues.filter((i) => /^(TB_|C\.TB|C\.KT)/.test(i.code) || /^(TB\.|C\.TB|KT\.|C\.KT)/.test(i.elementId ?? '') || /קורה נושאת|מסבך נושא/.test(i.message)).filter((i) => i.code !== 'TB_INFO' && i.code !== 'TB_DROP');
  const bad = list.filter((t) => (util.get(t.id)?.util ?? 0) > 1);
  if (edit) {
    const items = list.filter((t) => edit.ids.includes(t.id));
    if (!items.length) { setTimeout(() => setEdit(null)); return null; }
    const t0 = items[0];
    const sameLine = list.filter((x) => x.lineId === t0.lineId);
    return (
      <div className="panel-body" data-testid="tb-panel">
        <TabbedEditor testId="tb-ed" crumb="דילול עמודים" title={edit.title} onBack={() => setEdit(null)}
          tabs={tbTabs(t0, (patch) => patchIds(edit.ids, patch), { lineCount: sameLine.length, onApplyLine: items.length < sameLine.length ? () => set(list.map((x) => (x.lineId === t0.lineId && !edit.ids.includes(x.id) ? { ...x, profile: t0.profile, kind: t0.kind, support: t0.support, seat: t0.seat, knee: t0.knee ? { ...t0.knee } : undefined, truss: t0.truss, trussFit: t0.trussFit, trussConn: t0.trussConn, finOrient: t0.finOrient } : x))) : undefined })}
          footer={items.length > 1 ? `השינוי חל על ${items.length} הקורות בקבוצה. קורה שנערכת לבד (מהרשימה) הופכת לחריג.` : 'קורה אחת — שינוי כאן הופך אותה לחריג מהקבוצה.'} />
      </div>
    );
  }
  const groups = groupBy(list, tbSig);
  const fmtSpan = (ts: TransferDef[]) => { const sp = ts.map(spanOf); const a = Math.min(...sp), b = Math.max(...sp); return Math.abs(a - b) < 0.01 ? `${a.toFixed(2)} מ'` : `${a.toFixed(2)}–${b.toFixed(2)} מ'`; };
  return (
    <div className="panel-body" data-testid="tb-panel">
      <div className="panel-title">קורות נושאות (דילול עמודים){list.length > 0 && <span className="sum-pill">{list.length} קורות · {groups.length} {groups.length === 1 ? 'קבוצה' : 'קבוצות'}</span>}</div>
      {!list.length && <Help>אין עמודים מבוטלים. לביטול: בוחרים עמודים בתלת־ממד (Ctrl ללחיצה מרובה) ← "בטל עמודים" בסרגל ההקשר. התוכנה מציעה קורה נושאת בין העמודים שנותרו, עם בחירת תמיכה (A1–A5) וחיבור קורות הגג (B1–B4).</Help>}
      {list.length > 0 && <>
        <PanelAlerts testId="tb-alerts" issues={[...issues, ...bad.map((t) => ({ code: 'TB_SIZE', severity: 'warning' as const, elementId: `TB.${t.id}`, message: `ציר ${lab(t.lineId)} ${frameNo(t.from)}↔${frameNo(t.to)}: ${t.profile} קטן מדי (ניצולת ${(util.get(t.id)!.util).toFixed(2)})` }))]} okText={`כל ${list.length} הקורות עוברות בדיקה`} />
        <div className="sum-group">קבוצות — קורות זהות נערכות יחד</div>
        {groups.map((g, gi) => {
          const t = g.items[0];
          const us = g.items.map((x) => util.get(x.id)).filter((x): x is NonNullable<typeof x> => !!x);
          const worst = us.reduce((a, u) => (u.util > (a?.util ?? -1) ? u : a), us[0]);
          const lineGroups = groups.filter((q) => q.items[0].lineId === t.lineId);
          const minor = lineGroups.length > 1 && g.items.length < Math.max(...lineGroups.map((q) => q.items.length));
          const pills: Pill[] = worst?.tags ? [
            { text: `ניצולת ${worst.util.toFixed(2)}`, tone: worst.util > 1 ? 'bad' : worst.util > 0.9 ? 'warn' : 'ok' },
            { text: `שקיעה ${worst.tags.dl.toFixed(0)}/${worst.tags.dlLim.toFixed(0)}`, tone: worst.tags.dl > worst.tags.dlLim ? 'bad' : 'ok' },
          ] : [];
          if (t.knee?.enabled) pills.push({ text: 'עם אלכסוני Y — הערכה', tone: 'muted' });
          const title = `ציר ${lab(t.lineId)} · ${g.items.length} ${g.items.length === 1 ? 'קורה' : 'קורות'} · מפתח ${fmtSpan(g.items)}`;
          return <SumCard key={g.key} testId={`tb-grp-${gi}`} hi={!minor && groups.length > 1} title={title} badge={minor ? { text: 'חריג', tone: 'warn' } : undefined}
            sub={<>{t.kind === 'truss' ? 'מסבך' : <span className="mono">{t.profile}</span>} · תמיכה {t.support} · קורת גג {t.seat}{t.knee?.enabled ? <> · אלכסוני Y <span className="mono">{t.knee.profile}</span></> : ''}</>}
            pills={pills} editLabel={g.items.length > 1 ? 'ערוך את כולן' : 'ערוך'} onEdit={() => setEdit({ ids: g.items.map((x) => x.id), title: `ציר ${lab(t.lineId)} · ${g.items.length} ${g.items.length === 1 ? 'קורה' : 'קורות'}` })} />;
        })}
        <div className="sum-group">פירוט — לחיצה על שורה עורכת קורה אחת</div>
        <Collapsed testId="tb-list" items={list} first={3} render={(t) => {
          const u = util.get(t.id);
          return <div key={t.id} className="sum-row" data-testid={`tb-row-${t.id}`} onClick={() => setEdit({ ids: [t.id], title: `ציר ${lab(t.lineId)} · ${frameNo(t.from)}↔${frameNo(t.to)}` })}>
            <span>{lab(t.lineId)} {frameNo(t.from)}↔{frameNo(t.to)} <span className="k">({t.removed.length} עמוד{t.removed.length > 1 ? 'ים' : ''} מבוטל{t.removed.length > 1 ? 'ים' : ''})</span></span>
            <span className="k">{spanOf(t).toFixed(2)} מ'{u ? ` · ${u.util.toFixed(2)}` : ''}</span>
            <button className="link-btn" data-testid={`tb-restore-${t.id}`} onClick={(e) => { e.stopPropagation(); set(list.filter((x) => x.id !== t.id)); }}>החזר עמודים</button>
          </div>;
        }} />
      </>}
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
  return <TabbedEditor testId="tb-shape" title="" tabs={tbTabs(list[i], (patch) => set(list.map((x, k) => (k === i ? { ...x, ...patch } : x))), { embed: true })} />;
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
      {ed.showTitle && <Help>קורת הגג היא החגורה העליונה; חגורה תחתונה, אנכיים ואלכסונים מרותכים במסגריה; חיבורי המשך וחיבור החגורה לעמודים — ברגים בשטח. לחתך עם שני עמודים (מפתח אחד).</Help>}
      {!rt?.enabled && ed.showTitle && <OffCard pic="roofX" title="מסבכי גג" desc="קורת הגג הופכת לחגורה עליונה של מסבך — למפתחים גדולים" onAdd={() => set({ enabled: true })} testId="off-rt" />}
      {rt?.enabled && <>
        <FramePickStrip frames={fr} sel={sel} onToggle={toggleFrame} testPre="rt-f-" label={`מסגרות עם מסבך: ${sel.length} מתוך ${fr.length} — לחיצה על מסגרת מוסיפה/מסירה`} />
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

/** תרשים מבט על של חיבור חגורה לעמוד I (הווב פונה למסבך): סנפיר / פלטה אל פלטה */
function TrussConnPic({ conn, orient }: { conn: 'auto' | 'fin' | 'plate'; orient: 'horizontal' | 'vertical' }) {
  const plate = conn === 'plate';
  return (
    <div className="schem" data-testid="tb-conn-pic">
      <svg viewBox="0 0 220 74" role="img" aria-label="חיבור החגורה לעמוד — מבט על">
        <text x={110} y={9} className="sm-lbl-s" textAnchor="middle">מבט על — עמוד I, הווב פונה למסבך</text>
        {/* עמוד: שני אגפים ווב */}
        <rect x={30} y={18} width={44} height={4} className="sm-main" />
        <rect x={30} y={52} width={44} height={4} className="sm-main" />
        <rect x={50} y={22} width={4} height={30} className="sm-main" />
        {plate ? <>
          <rect x={74} y={16} width={4} height={42} className="sm-hi" />
          <rect x={78} y={18} width={4} height={38} className="sm-hi" />
          <rect x={82} y={24} width={110} height={26} className="sm-thin" />
          <text x={150} y={68} className="sm-lbl-s" textAnchor="middle">פלטת סגירה + פלטת קצה, ברגים אופקיים</text>
        </> : <>
          {orient === 'horizontal'
            ? <rect x={54} y={27} width={60} height={20} className="sm-hi" />
            : <rect x={54} y={35} width={60} height={4} className="sm-hi" />}
          <rect x={92} y={orient === 'horizontal' ? 29 : 39} width={70} height={orient === 'horizontal' ? 16 : 3} className="sm-hi" opacity={0.6} />
          <rect x={106} y={26} width={86} height={22} className="sm-thin" />
          {[0, 1].map((i) => <circle key={i} cx={98 + i * 10} cy={orient === 'horizontal' ? 37 : 41} r={2.2} className="sm-main" />)}
          <text x={150} y={68} className="sm-lbl-s" textAnchor="middle">{orient === 'horizontal' ? 'פח שוכב מרותך לווב — החגורה מונחת עליו' : 'פח עומד מרותך לווב — לשונית בצד'}</text>
        </>}
      </svg>
    </div>
  );
}
