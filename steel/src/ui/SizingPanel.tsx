import { useMemo, useState } from 'react';
import { applySizingSuggestion, setSettings } from '../commands/commands';
import { DEFAULT_SIZING, SIZE_COLOR, SIZE_LABEL, sizingAll, sizingCfg, type SizeStatus, type SizingCfg } from '../model/sizing';
import { store, useStore } from '../store';
import { NumField, Help } from './fields';
import { Icon } from './icons';

const KIND_HE: Record<string, string> = { column: 'עמודים', rafter: 'קורות גג', purlin: 'פטות', brace: 'אלכסונים/קושרות', beam: 'קורות', girt: 'מסגור קירות' };
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const FIELDS: [keyof SizingCfg, string, string][] = [
  ['dead', 'עומס קבוע', 'kN/m²'], ['live', 'עומס שימושי', 'kN/m²'], ['snow', 'שלג (ת"י 412)', 'kN/m²'], ['wind', 'לחץ רוח qp (ת"י 414)', 'kN/m²'],
  ['cpRoof', 'מקדם יניקה בגג', ''], ['cpWall', 'מקדם לחץ בקיר', ''], ['gamma', 'מקדם עומס (כבידה)', ''],
  ['kRafter', 'קורת גג: M = qL²/k, k=', ''], ['kPurlin', 'פטה: M = qL²/k, k=', ''],
  ['rafterMinDepth', 'קורה: עומק מינ\' L/', ''], ['rafterMaxDepth', 'קורה: עומק מרבי L/', ''],
  ['columnMinDepth', 'עמוד: עומק מינ\' H/', ''], ['columnK', 'עמוד: מקדם אורך קריסה', ''],
  ['purlinDefl', 'פטה: שקיעה מרבית L/', ''], ['lowUtil', 'ניצולת "גדול מדי" מתחת ל-', ''],
  ['slenderComp', 'תמירות מרבית — לחיצה', ''], ['slenderTens', 'תמירות מרבית — מתיחה', ''],
];

/** מקרא מצב "בדיקת גדלים": ספירה לפי סטטוס ותפקיד, בחירת קבוצה, הסבר לאלמנט שנבחר, והגדרות הספים */
export function SizingPanel() {
  const project = useStore((s) => s.project), derived = useStore((s) => s.derived), sel = useStore((s) => s.selection);
  const [open, setOpen] = useState(false);
  const res = useMemo(() => sizingAll(project, derived), [project, derived]);
  const cfg = sizingCfg(project);
  const rows = useMemo(() => {
    const m = new Map<string, Record<SizeStatus, string[]>>();
    for (const mem of derived.members) {
      const r = res.get(mem.id); if (!r) continue;
      const k = mem.purlin ? 'purlin' : mem.kind;
      const e = m.get(k) ?? { small: [], ok: [], big: [], na: [] };
      e[r.status].push(mem.id); m.set(k, e);
    }
    return [...m.entries()];
  }, [res, derived]);
  const selR = sel.length === 1 ? res.get(sel[0]) : undefined;
  const selM = sel.length === 1 ? derived.byId.get(sel[0]) : undefined;
  const setCfg = (k: keyof SizingCfg, v: number) => store.exec(setSettings({ sizing: { ...(project.settings.sizing ?? {}), [k]: v } }));
  return (
    <div className="sizing-box" data-testid="sizing-box">
      <div className="sizing-h">
        <b>בדיקת גדלים</b>
        <button className="icon-btn" aria-label="סגירה" onClick={() => store.set({ colorMode: 'kind' })}><Icon name="x" /></button>
      </div>
      <div className="sizing-leg">
        {(['small', 'ok', 'big', 'na'] as SizeStatus[]).map((s) => <span key={s}><i style={{ background: hex(SIZE_COLOR[s]) }} />{SIZE_LABEL[s]}</span>)}
      </div>
      <table className="sizing-t">
        <thead><tr><th>תפקיד</th><th style={{ color: hex(SIZE_COLOR.small) }}>קטן</th><th style={{ color: hex(SIZE_COLOR.ok) }}>סביר</th><th style={{ color: hex(SIZE_COLOR.big) }}>גדול</th></tr></thead>
        <tbody>{rows.map(([k, e]) => (
          <tr key={k}><td>{KIND_HE[k] ?? k}</td>
            {(['small', 'ok', 'big'] as SizeStatus[]).map((st) => <td key={st}>{e[st].length ? <button className="linkish" data-testid={`sz-${k}-${st}`} onClick={() => store.select(e[st])}>{e[st].length}</button> : '–'}</td>)}
          </tr>))}</tbody>
      </table>
      {selR && selM && <div className={`sz-note sz-${selR.status}`} data-testid="sz-note"><b>{selM.label} · {selM.profile}</b><br />{SIZE_LABEL[selR.status]} — {selR.text}</div>}
      <Help>הערכה בכללי אצבע: גג {cfg.dead}+max({cfg.live}, שלג {cfg.snow}) kN/m² ×{cfg.gamma}; רוח qp={cfg.wind} kN/m² (יניקה בפטות, לחץ על העמודים). ללא עגורן, ללא בדיקת יציבות כוללת. אינה תכן סטטי — לעדכן רוח ושלג לפי האתר.</Help>
      <button className="btn small primary" data-testid="sz-apply" title="עמודים, קורות, פטות וקושרות — הגודל הקטן ביותר שמסומן 'סביר' באותה משפחה; פלטות ראש עמוד ובסיס מותאמות" onClick={() => { if (store.exec(applySizingSuggestion())) store.toast('ok', 'החתכים הותאמו לפי כללי האצבע — יש לבדוק את רשימת הבדיקות'); }}>התאם חתכים</button>{' '}
      <button className="btn small" data-testid="sz-settings" onClick={() => setOpen(!open)}>{open ? 'הסתר ספים' : 'ספים ועומסים…'}</button>
      {open && <div className="sz-cfg">
        {FIELDS.map(([k, lab, suf]) => <div className="field" key={k}><label>{lab}</label><NumField testId={`szc-${k}`} value={cfg[k]} suffix={suf} step={0.05} onCommit={(v) => setCfg(k, v)} /></div>)}
        <button className="btn small" onClick={() => store.exec(setSettings({ sizing: {} }))}>איפוס לברירת מחדל</button>
        <span className="hint"> ברירות מחדל: {DEFAULT_SIZING.dead}/{DEFAULT_SIZING.live} kN/m²</span>
      </div>}
    </div>
  );
}
