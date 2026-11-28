import { ComponentTable } from './ComponentTable';
import { ConnPreview } from './ConnPreview';
import { createContext, useContext, useRef, useState } from 'react';

/** 1.62: באשף המסגרות הגבהים נערכים בחתך המסגרת (גיאומטריה) — כאן (מיקום במבנה) רק צירים ומפתחים */
export const SecHeightsCtx = createContext(true);
import { setBuilding, setKneeBraces, setSection, setSettings } from '../commands/commands';
import { tryProfile } from '../profiles/library';
import { defaultKneeBraces } from '../geometry/knee';
import { defaultHaunch } from '../geometry/haunch';
import { gablePair, lineLabel, moveLines, planeDims, setAxisCount, setPlaneDims, slidePlaneEnd, SECTION_TEMPLATES, toCustomSection, type CustomSection, type RoofPlaneDef } from '../model/section';
import { TriDims, type TriCalc } from './TriDims';
import { store, useStore } from '../store';
import { Adv, LenField, NumField, ProfilePicker, useEdit, Help } from './fields';
import { Icon } from './icons';
import type { KneeSideOverride } from '../model/types';
import { KneeSchematic } from './schematics';
import { OffCard } from './pics';
import { DetailTiles, PIC, ScopeToggle } from './DetailPicker';
import { kneeDetailThumb, RealPic } from './RealPic';
import { PanelAlerts, SumCard, TabbedEditor } from './summary';
import { kneeDetail } from '../geometry/knee';

/**
 * בונה החתך המודולרי (החלטת משתמש 15.11.2026): תבניות + טבלת צירי עמודים + טבלת מישורי גג, עם תצוגה מקדימה.
 * כל שינוי חל מיד על המודל (פקודה אחת, ביטול אחד).
 */
export function SectionEditor({ part }: { part?: 'axes' | 'planes' } = {}) {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const b = p.building;
  const sec = b.section;
  const u = p.displayUnit;
  const apply = (s2: CustomSection | undefined, label?: string) => store.exec(setSection(s2, label));
  return (
    <>
      {part !== 'planes' && <TemplateBar />}
      {/* אין "קלאסי" נפרד: מבנה של 2 צירים מוצג ונערך באותו עורך (העריכה הראשונה שומרת אותו כחתך) */}
      <ModularTables sec={sec ?? toCustomSection(b, d.roof)} unit={u} apply={apply} part={part} />
      {part !== 'axes' && <button className="btn small link-nav" data-testid="goto-knee" onClick={() => window.dispatchEvent(new CustomEvent('ksp-nav', { detail: 'b:knee' }))}>אלכסוני עמוד-קורה, חיזוק רכס וקושרות ← חיזוקים וקשיחות</button>}
    </>
  );
}

/** 1.62: צורת הסככה — תבנית נוכחית + גלריית תבניות (משותף לעורך הצירים ולחתך המסגרת באשף) */
export function TemplateBar() {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const b = p.building;
  const sec = b.section;
  const [tplOpen, setTplOpen] = useState(false);
  return (
    <>
      {/* גלריית התבניות מקופלת (1.34): פותחים רק כדי להחליף צורה */}
      {<div className="tpl-bar">
        <span className="tpl-cur"><SectionPreview section={sec ?? toCustomSection(b, d.roof)} small /><span><small>צורת הסככה</small><b>{SECTION_TEMPLATES.find((t) => t.id === sec?.template)?.name ?? (sec ? 'מותאמת אישית' : b.roofType === 'gable' ? 'דו־שיפועי (2 צירים)' : 'חד־שיפועי (2 צירים)')}</b></span></span>
        <button className={`btn small${tplOpen ? ' primary' : ''}`} data-testid="tpl-toggle" aria-expanded={tplOpen} onClick={() => setTplOpen(!tplOpen)}>{tplOpen ? 'סגירה' : 'החלפת תבנית'}</button>
      </div>}
      {tplOpen && <div className="tpl-grid">
        {SECTION_TEMPLATES.map((t) => (
          <button key={t.id} className={`tpl${sec?.template === t.id ? ' on' : ''}`} data-testid={`tpl-${t.id}`} title={t.desc}
            onClick={() => {
              if (sec && !confirm(`להחליף את החתך בתבנית "${t.name}"?`)) return;
              // תבנית = סככה כמו בתוכניות: כולל אלכסוני עמוד-קורה (ניתן לבטל)
              const s2 = setSection(t.make(), `תבנית חתך: ${t.name}`), k2 = setKneeBraces({ enabled: true });
              store.exec({ label: `תבנית חתך: ${t.name}`, run: (pp) => k2.run(s2.run(pp)) });
              setTplOpen(false);
            }}>
            <SectionPreview section={t.make()} small /><span>{t.name}</span>
          </button>
        ))}
      </div>}
    </>
  );
}

function ModularTables({ sec, unit: u, apply, part }: { sec: CustomSection; unit: 'm' | 'mm'; apply: (s: CustomSection, label?: string) => void; part?: 'axes' | 'planes' }) {
  const lines = [...sec.lines].sort((a, b) => a.x - b.x);
  const lineBase = useStore((st) => st.project.building.lineBase) ?? {};
  const labels = useStore((st) => st.project.building.lineLabels) ?? {};
  const baseEl = useStore((st) => st.project.building.baseElevation);
  const setLine = (id: string, x: number) => apply(moveLines(sec, new Map([[id, x]])), 'הזזת ציר');
  const newId = (pre: string, used: string[]) => { let i = 1; while (used.includes(`${pre}${i}`)) i++; return `${pre}${i}`; };
  const slope = (pl: RoofPlaneDef) => ((pl.z1 - pl.z0) / (pl.x1 - pl.x0)) * 100;
  // מה מחושב בכל מישור (ברירת מחדל: גובה הרכס / העמוד הגבוה)
  const [calc, setCalc] = useState<Record<string, TriCalc>>({});
  const calcOf = (id: string): TriCalc => calc[id] ?? 'top';
  const pair = gablePair(sec);
  const [joint, setJoint] = useState<boolean | null>(null);
  const together = !!pair && (joint ?? pair.symmetric);
  const [bigSec, setBigSec] = useState(false);
  const showZ = useContext(SecHeightsCtx);
  return (
    <>
      {part !== 'planes' && <>
      <div className="axis-count" data-testid="axis-count">
        <div className="field"><label>מספר צירי עמודים</label><NumField testId="axis-n" value={sec.lines.length} onCommit={(v) => apply(setAxisCount(sec, v), 'מספר צירים')} /></div>
        <div className="field"><label>רוחב בין הצירים הקיצוניים</label><LenField testId="axis-w" mm={Math.max(...sec.lines.map((l) => l.x)) - Math.min(...sec.lines.map((l) => l.x))} unit={u} onCommit={(v) => apply(setAxisCount(sec, sec.lines.length, v), 'רוחב כולל')} /></div>
        <div className="hint" style={{ margin: 0 }}>הצירים מחולקים שווה; אחר כך אפשר לשנות כל מפתח בשרטוט (לחיצה על המידה) או לגרור ציר.</div>
      </div>
      </>}
      {showZ && <div className={`sec-prev${bigSec ? ' big' : ''}`}><button className="btn small sec-prev-x" data-testid="sec-enlarge" title={bigSec ? 'הקטנה' : 'הגדלת השרטוט'} onClick={() => setBigSec(!bigSec)}>{bigSec ? '⤡' : '⤢'}</button><InteractiveSection sec={sec} apply={apply} base={baseEl} onBase={(v) => store.exec(setBuilding({ baseElevation: v }))} calcOf={(id) => calcOf(together ? 'gable' : id)} setCalc={(id, c) => setCalc({ ...calc, [together ? 'gable' : id]: c })} together={together} /></div>}
      {part !== 'planes' && <>
      <div className="panel-title">צירי עמודים ({lines.length})
        <button className="btn small" data-testid="sec-add-line" onClick={() => {
          const last = lines[lines.length - 1];
          apply({ ...sec, lines: [...sec.lines, { id: newId('C', sec.lines.map((l) => l.id)), x: last.x + 6000 }] }, 'הוספת ציר');
        }}><Icon name="plus" />ציר</button>
      </div>
      <Adv id="sec-lines-tbl" label="טבלת צירים — שם, מיקום, תחתית עמוד, קיר קיים">
      <table className="tbl" data-testid="sec-lines">
        <thead><tr><th title="שם הציר כמו בתוכנית">שם</th><th>מיקום X</th><th>מפתח</th><th title="מפלס תחתית העמוד: פני חגורה / יסוד, ביחס ל-±0.00">תחתית עמוד</th><th title="קיר קיים: אין עמוד — הקורות מעוגנות לקיר">קיר</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id}>
              <td><input className="inp" style={{ width: 52, fontWeight: 700, textAlign: 'center' }} data-testid={`sec-label-${i}`} defaultValue={labels[l.id] ?? ''} placeholder={lineLabel(i)} key={`${l.id}-${labels[l.id] ?? ''}`} title="שם הציר כמו בתוכנית (ריק = אות ברירת מחדל)"
                onBlur={(e) => { const v = e.target.value.trim(); if (v === (labels[l.id] ?? '')) return; const nl = { ...labels }; if (v) nl[l.id] = v; else delete nl[l.id]; store.exec(setBuilding({ lineLabels: Object.keys(nl).length ? nl : undefined })); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></td>
              <td><LenField mm={l.x} unit={u} testId={`sec-x-${i}`} onCommit={(v) => setLine(l.id, v)} /></td>
              <td>{i > 0 ? <LenField mm={l.x - lines[i - 1].x} unit={u} min={500} onCommit={(v) => {
                const delta = v - (l.x - lines[i - 1].x);
                apply(moveLines(sec, new Map(sec.lines.filter((q) => q.x >= l.x).map((q) => [q.id, q.x + delta]))), 'שינוי מרווח צירים');
              }} /> : <span className="hint">—</span>}</td>
              <td><LenField mm={(lineBase[l.id] ?? baseEl) - baseEl} unit={u} testId={`sec-base-${i}`} onCommit={(v) => store.exec(setBuilding({ lineBase: { ...lineBase, [l.id]: baseEl + v } }))} /></td>
              <td><input type="checkbox" data-testid={`sec-wall-${i}`} title="קיר קיים (ללא עמוד)" checked={!!l.wall} onChange={(e) => apply({ ...sec, lines: sec.lines.map((q) => (q.id === l.id ? { ...q, wall: e.target.checked || undefined } : q)) }, 'קיר קיים')} /></td>
              <td>{lines.length > 1 && <button className="icon-btn" title="מחיקת ציר" onClick={() => apply({ ...sec, lines: sec.lines.filter((q) => q.id !== l.id) }, 'מחיקת ציר')}><Icon name="x" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </Adv>
      {Object.values(lineBase).some((z) => Math.abs(z - baseEl) > 1) && <div className="hint">תחתית עמוד מעל ±0.00 (חגורה / יסוד מוגבה): העמוד בציר מתקצר, גובה הגג לא משתנה. במסגרות ובתוכנית העיגון מופיע מפלס לכל ציר.</div>}
      </>}
      {part !== 'axes' && <>
      <Overhangs sec={sec} unit={u} apply={apply} />
      <div className="panel-title">מישורי גג ({sec.planes.length})
        <button className="btn small" data-testid="sec-add-plane" onClick={() => {
          const xs = lines.map((l) => l.x);
          const x0 = Math.min(...xs), x1 = Math.max(...xs);
          apply({ ...sec, planes: [...sec.planes, { id: newId('P', sec.planes.map((q) => q.id)), x0, z0: 6000, x1, z1: 6000 + 0.1 * (x1 - x0), start: 'x1' }] }, 'הוספת מישור');
        }}><Icon name="plus" />מישור</button>
      </div>
      {pair && (
        <label className="row" style={{ margin: '2px 0' }}><input type="checkbox" data-testid="sec-gable-joint" checked={together} onChange={(e) => setJoint(e.target.checked)} />
          גג דו-שיפועי סימטרי — שני הצדדים זהים (גובה עמוד ושיפוע)</label>
      )}
      {pair && together && (() => {
        const pd = planeDims(sec, pair.a)!;
        return (
          <div className="plane-card" data-testid="sec-plane-gable">
            <b>גג דו-שיפועי</b>
            <TriDims testId="tri-gable" unit={u} col={pd.zLow} top={pd.zHigh} run={pd.run} calc={calcOf('gable')} onCalc={(c) => setCalc({ ...calc, gable: c })}
              labels={{ col: 'גובה עמודים (צירים קיצוניים)', top: 'גובה רכס' }}
              onCommit={(v) => apply(setPlaneDims(setPlaneDims(sec, pair.a, v.col, v.top), pair.b, v.col, v.top), 'מידות גג')} />
          </div>
        );
      })()}
      {!together && sec.planes.map((pl, i) => {
        const pd = planeDims(sec, pl.id);
        return (
        <div className="plane-card" key={pl.id} data-testid={`sec-plane-${i}`}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>שיפוע {i + 1} <span className="mono muted">{pl.id}</span></b>
            <span className="badge">{slope(pl).toFixed(1)}%</span>
            {sec.planes.length > 1 && <button className="icon-btn" title="מחיקת מישור" onClick={() => apply({ ...sec, planes: sec.planes.filter((q) => q.id !== pl.id) }, 'מחיקת מישור')}><Icon name="x" /></button>}
          </div>
          {pd && <TriDims testId={`tri-${i}`} unit={u} col={pd.zLow} top={pd.zHigh} run={pd.run} calc={calcOf(pl.id)} onCalc={(c) => setCalc({ ...calc, [pl.id]: c })}
            labels={planeLabels(pd)} onCommit={(v) => apply(setPlaneDims(sec, pl.id, v.col, v.top), 'מידות גג')} />}
          <Adv id={`pl-x-${pl.id}`} label="קצוות המישור (X) — מתקדם (הגובה בצירי העמודים נשמר)">
            <div className="grid-4">
              <label>X שמאל<LenField mm={pl.x0} unit={u} testId={`pl-x0-${i}`} onCommit={(v) => apply(slidePlaneEnd(sec, pl.id, 'x0', v), 'קצה מישור')} /></label>
              <label>X ימין<LenField mm={pl.x1} unit={u} testId={`pl-x1-${i}`} onCommit={(v) => apply(slidePlaneEnd(sec, pl.id, 'x1', v), 'קצה מישור')} /></label>
            </div>
          </Adv>
        </div>
        );
      })}
      <Help>גבהים = פני עליון של קורת הגג, בציר העמוד (לא בקצה הקונזולה). מזינים שניים מתוך גובה עמוד / גובה רכס / שיפוע — השלישי (מסומן "= מחושב") מתעדכן; "חשב" בשורה אחרת מעביר אליה את החישוב. מישור שעובר מעל עמוד יושב עליו; מישור שמסתיים בעמוד שממשיך למעלה מתחבר לצדו; שני קצוות באותה נקודה ללא עמוד = רכס. צד התחלת הפטות — בגג ופטות.</Help>
      </>}
    </>
  );
}

/** תוויות השדות לפי נקודות הייחוס של המישור */
function planeLabels(pd: NonNullable<ReturnType<typeof planeDims>>) {
  return {
    col: pd.lowLine !== undefined ? `גובה עמוד (ציר ${lineLabel(pd.lowLine)})` : 'גובה בקצה הנמוך',
    top: pd.highIsRidge ? 'גובה רכס' : pd.highLine !== undefined ? `גובה עמוד גבוה (ציר ${lineLabel(pd.highLine)})` : 'גובה בקצה הגבוה',
  };
}

/** קונזולות שמאל/ימין: מעבר קורות הגג מעבר לציר העמודים הקיצוני (שינוי מזיז את קצה המישור לאורך השיפוע) */
function Overhangs({ sec, unit: u, apply }: { sec: CustomSection; unit: 'm' | 'mm'; apply: (s: CustomSection, label?: string) => void }) {
  const setEnd = (pl: RoofPlaneDef, end: 'x0' | 'x1', x: number) => {
    const s = (pl.z1 - pl.z0) / (pl.x1 - pl.x0);
    const patch = end === 'x0' ? { x0: x, z0: pl.z1 - s * (pl.x1 - x) } : { x1: x, z1: pl.z0 + s * (x - pl.x0) };
    apply({ ...sec, template: undefined, planes: sec.planes.map((q) => (q.id === pl.id ? { ...q, ...patch } : q)) }, 'שינוי קונזולה');
  };
  // דירוג: ציר פנימי שבו מישור נמוך מסתיים בצד העמוד ומישור גבוה יותר נשען על ראש העמוד — לקורה הגבוהה אפשר זיז מעבר לעמוד
  const zAtP = (pl: RoofPlaneDef, x: number) => pl.z0 + ((pl.z1 - pl.z0) * (x - pl.x0)) / (pl.x1 - pl.x0);
  const sorted = [...sec.lines].sort((a, b) => a.x - b.x);
  const steps: { pl: RoofPlaneDef; end: 'x0' | 'x1'; x: number; li: number; v: number }[] = [];
  sorted.forEach((l, li) => {
    if (li === 0 || li === sorted.length - 1) return;
    for (const low of sec.planes) for (const lowEnd of ['x0', 'x1'] as const) {
      if (Math.abs(low[lowEnd] - l.x) > 1) continue;
      const zl = lowEnd === 'x0' ? low.z0 : low.z1;
      for (const hi of sec.planes) {
        if (hi === low) continue;
        const end: 'x0' | 'x1' = lowEnd === 'x1' ? 'x0' : 'x1';
        const ex = hi[end], v = end === 'x0' ? l.x - ex : ex - l.x;
        if (v < -1 || v > 3000) continue;
        if (zAtP(hi, l.x) <= zl + 100) continue;
        if (!steps.some((q) => q.pl.id === hi.id && q.end === end)) steps.push({ pl: hi, end, x: l.x, li, v: Math.max(0, Math.round(v)) });
      }
    }
  });
  return (
    <>
      {steps.length > 0 && <div className="panel-title">זיזים בדירוג</div>}
      {steps.map((st) => (
        <div className="field" key={`${st.pl.id}-${st.end}`}><label>זיז קורה עליונה בדירוג — ציר {lineLabel(st.li)} ({st.end === 'x0' ? 'שמאלה' : 'ימינה'}, מעבר לעמוד)</label>
          <LenField testId={`ovh-step-${st.li}`} mm={st.v} unit={u} onCommit={(v) => setEnd(st.pl, st.end, st.end === 'x0' ? st.x - Math.max(0, v) : st.x + Math.max(0, v))} /></div>
      ))}
      {steps.length > 0 && <div className="hint">זיז בדירוג: הקורה העליונה ממשיכה מעבר לעמוד מעל הגג הנמוך — מונע כניסת גשם לפתח שבין הגגות.</div>}
    </>
  );
}

export function HaunchEditor({ part }: { part?: 'geo' | 'conn' } = {}) {
  const ed = useEdit();
  const b = useStore((s) => s.project.building);
  const hp = b.haunch ?? { ...defaultHaunch(), enabled: false };
  const n = useStore((s) => s.derived.connections.filter((c) => c.id.startsWith('C.HN.')).length);
  const set = (patch: Partial<typeof hp>) => store.exec(setBuilding({ haunch: { ...hp, ...patch } }));
  return (
    <>
      {ed.showTitle && <div className="panel-title">מכפל בראש העמוד
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="hn-on" checked={hp.enabled} onChange={(e) => set({ enabled: e.target.checked })} />פעיל {hp.enabled ? `(${n})` : ''}</label>
      </div>}
      {!hp.enabled && ed.showTitle && <OffCard pic="knee" title="מכפל בראש העמוד" desc="פח משולש מתחת לקורה ליד העמוד — מאפשר קורה קלה יותר במפתח גדול" onAdd={() => set({ enabled: true })} testId="off-hn" />}
      {hp.enabled && <>
        {part !== 'conn' && <><div className="field"><label>אורך מפני העמוד</label><NumField testId="hn-length" value={hp.length} suffix='מ"מ' onCommit={(v) => set({ length: Math.max(300, v) })} /></div>
        <div className="field"><label>עומק בפני העמוד (0 = עומק הקורה)</label><NumField testId="hn-depth" value={hp.depth} suffix='מ"מ' onCommit={(v) => set({ depth: Math.max(0, v) })} /></div></>}
        {part !== 'geo' && <div className="field"><label>עובי גוף / אגף (0 = כמו הקורה)</label><span className="row"><NumField value={hp.webT} suffix='מ"מ' onCommit={(v) => set({ webT: Math.max(0, v) })} /><NumField value={hp.flangeT} suffix='מ"מ' onCommit={(v) => set({ flangeT: Math.max(0, v) })} /></span></div>}
        {!part && <Help>פח גוף משולש + פח אגף משופע, מרותכים מתחת לקורת הגג במסגריה (מכלול אחד עם הקורה), בכל צד שבו הקורה ממשיכה מעבר לעמוד. מאפשר קורה קלה יותר במפתח גדול — ללא בדיקת חוזק בתוכנה.</Help>}
      </>}
    </>
  );
}

/**
 * פרט חיבור אלכסון עמוד-קורה — אריחים מסוננים לפי משפחת החתך (זוויתן: מוברג לפח; חלול: לשונית בחריץ; שניהם: פלטת קצה).
 * sideKey: בעורך החיבור — אפשר חריג למפתח-צד הזה (בכל המסגרות).
 */
export function KneeDetailField({ sideKey }: { sideKey?: string } = {}) {
  const kb = useStore((s) => s.project.building.kneeBraces) ?? defaultKneeBraces();
  const ov = sideKey ? kb.sides?.[sideKey] : undefined;
  const [scope, setScope] = useState<'all' | 'one'>(ov?.detail ? 'one' : 'all');
  const prof = (scope === 'one' && ov?.profile) || kb.profile;
  const fam = tryProfile(prof)?.family ?? 'RHS';
  const cur = kneeDetail(scope === 'one' ? ov?.detail ?? kb.detail : kb.detail, fam);
  const pick = (k: 'fin' | 'angle' | 'flange') => {
    if (scope === 'one' && sideKey) store.exec(setKneeBraces({ sides: { ...(kb.sides ?? {}), [sideKey]: { ...(kb.sides?.[sideKey] ?? {}), detail: k } } }));
    else store.exec(setKneeBraces({ detail: k }));
  };
  const setSc = (v: 'all' | 'one') => {
    setScope(v);
    if (v === 'all' && sideKey && kb.sides?.[sideKey]?.detail) { const o = { ...kb.sides[sideKey] }; delete o.detail; store.exec(setKneeBraces({ sides: { ...(kb.sides ?? {}), [sideKey]: o } })); }
  };
  return <>
    {sideKey && <ScopeToggle value={scope} onChange={setSc} oneLabel="רק במיקום הזה (כל המסגרות)" testId="kb-scope" />}
    <DetailTiles label="פרט חיבור" testId="kb-detail" value={cur} onChange={pick} note={fam === 'L' ? '(חתך זוויתן — לשונית בחריץ אינה אפשרית)' : undefined} options={[
      { key: 'fin', title: 'פח + לשונית בחריץ', desc: 'פח מרותך למארח (מסגריה), לשונית מרותכת בחריץ ה-RHS; בשטח מוברגים בחפיפה', pic: <KneePic k="fin" />, hidden: fam === 'L' },
      { key: 'angle', title: 'זוויתן מוברג לפח', desc: 'פח מרותך למארח (מסגריה); הרגל השטוחה של הזוויתן מוברגת ישירות לפח בשטח — ללא לשונית', pic: <KneePic k="angle" />, hidden: fam !== 'L' },
      { key: 'flange', title: 'פלטת קצה לאגף', desc: 'פלטת קצה מרותכת לאלכסון, מוברגת לאגף העמוד ולאגף התחתון של הקורה (4 ברגים)', pic: <KneePic k="flange" /> },
    ]} />
  </>;
}

/** 1.55: תמונה מרונדרת של פרט חיבור האלכסון (המבנה הזה עם הפרט) */
export function KneePic({ k }: { k: 'fin' | 'angle' | 'flange' }) {
  const p = useStore((s) => s.project);
  const t = kneeDetailThumb(p, k);
  return <RealPic id={t.id} make={t.make} fallback={PIC[k]} alt={k} />;
}

export function KneeEditor() {
  const kb = useStore((s) => s.project.building.kneeBraces) ?? defaultKneeBraces();
  const n = useStore((s) => s.derived.connections.filter((c) => c.type === 'knee' && c.id.startsWith('C.KB.')).length);
  const d = useStore((s) => s.derived);
  const set = (patch: Parameters<typeof setKneeBraces>[0]) => store.exec(setKneeBraces(patch));
  const ed = useEdit();
  const [prevOpen, setPrevOpen] = useState(() => { try { return localStorage.getItem('ksp-kb-prev') !== '0'; } catch { return true; } });
  const firstKb = d.connections.find((c) => c.type === 'knee' && c.id.startsWith('C.KB.'))?.id;
  // פרט החיבור — שדות החיבור (בחלון האלמנט: בסעיף "חיבורים"; בתפריט הצד: ב"מתקדם")
  const connFields = <>
    <KneeDetailField />
    {kb.detail !== 'flange'
      ? <div className="field"><label>ברגים בכל קצה</label>
          <select className="inp" data-testid="kb-bolts" value={kb.boltsPerEnd ?? 2} onChange={(e) => set({ boltsPerEnd: Number(e.target.value) })}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}×M{kb.bolt.d} — {n / 2} {n === 2 ? 'שורה' : 'שורות'} של 2 לרוחב</option>)}</select></div>
      : <div className="field"><label>פלטת קצה / ברגים</label><span className="readonly">{kb.plateT}×{kb.plateW}×{kb.plateL} · 4×M{kb.bolt.d}</span></div>}
    <div className="field"><label>עובי פלטות</label><NumField testId="kb-t" value={kb.plateT} suffix='מ"מ' onCommit={(v) => set({ plateT: Math.max(6, v) })} /></div>
  </>;
  if (ed.embed && ed.showConn) return connFields;
  return (
    <>
      {ed.showTitle && <div className="panel-title">אלכסוני עמוד-קורה
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="kb-on" checked={kb.enabled} onChange={(e) => set({ enabled: e.target.checked })} />פעיל {kb.enabled ? `(${n})` : ''}</label>
      </div>}
      {!kb.enabled && ed.showTitle && <OffCard pic="knee" title="אלכסוני עמוד-קורה" desc="אלכסון בכל מפגש עמוד-קורה (RHS80, 45°) — מחזק את המסגרת" onAdd={() => set({ enabled: true })} testId="off-kb" />}
      {kb.enabled && ed.embed && <><>
        <KneeSchematic />
        {ed.showProfile && <div className="field prof"><label>חתך</label><ProfilePicker testId="kb-profile" value={kb.profile} families={['RHS', 'SHS', 'CHS', 'L', 'UPN']} onCommit={(v) => set({ profile: v })} /></div>}
        <div className="field"><label>מה נעול</label>
          <div className="seg">
            <button className={`tbtn${(kb.mode ?? 'angle') === 'angle' ? ' on' : ''}`} data-testid="kb-mode-angle" onClick={() => set({ mode: 'angle' })}>זווית</button>
            <button className={`tbtn${kb.mode === 'reach' ? ' on' : ''}`} data-testid="kb-mode-reach" onClick={() => set({ mode: 'reach' })}>מרחק אופקי</button>
          </div>
        </div>
      </><KneeSides /></>}
      {kb.enabled && !ed.embed && <>
        <SumCard testId="kb-sum" editLabel="פרט ✎" onEdit={() => { const c = d.connections.find((x) => x.id.startsWith('C.KB.')); if (c) store.set({ connWizard: c.id }); }} title={`${n} אלכסונים · ${kb.profile}`} sub={`${(kb.mode ?? 'angle') === 'angle' ? `${kb.angle ?? 45}°` : `מרחק ${kb.reach}`} · ירידה ${kb.drop} · ${({ fin: 'פח + לשונית', angle: 'זוויתן מוברג לפח', flange: 'פלטת קצה לאגף' } as const)[kneeDetail(kb.detail, tryProfile(kb.profile)?.family ?? 'RHS')]}`}
          pills={Object.values(kb.sides ?? {}).some((o) => o && Object.keys(o).some((x) => x !== 'on')) ? [{ text: 'יש ערכים חריגים למפתחים', tone: 'warn' }] : []} />
        <PanelAlerts issues={d.issues.filter((i) => /^KNEE_|^BOLT_ACCESS|^PLATE_WIDE/.test(i.code) && /אלכסון/.test(i.message))} testId="kb-alerts" />
        {/* 1.54: תצוגה מקדימה מתקפלת מעל הלשוניות — שרטוט עם מידות לעריכה + פרט החיבור החי */}
        <details className="kb-prev" open={prevOpen || undefined} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setPrevOpen(o); try { localStorage.setItem('ksp-kb-prev', o ? '1' : '0'); } catch { /* */ } }} data-testid="kb-prev">
          <summary>תצוגה מקדימה</summary>
          {prevOpen && <KneeSchematic />}
        </details>
        <TabbedEditor testId="kb-ed" title="" tabs={[
          { key: 'shape', label: 'כללי ומיקום', render: () => <>
        {ed.showProfile && <div className="field prof"><label>חתך</label><ProfilePicker testId="kb-profile" value={kb.profile} families={['RHS', 'SHS', 'CHS', 'L', 'UPN']} onCommit={(v) => set({ profile: v })} /></div>}
        <div className="field"><label>קביעת הנקודה על הקורה</label>
          <div className="seg">
            <button className={`tbtn${(kb.mode ?? 'angle') === 'angle' ? ' on' : ''}`} data-testid="kb-mode-angle" onClick={() => set({ mode: 'angle' })}>זווית</button>
            <button className={`tbtn${kb.mode === 'reach' ? ' on' : ''}`} data-testid="kb-mode-reach" onClick={() => set({ mode: 'reach' })}>מרחק אופקי</button>
          </div>
        </div>
        <div className="hint">ירידה, זווית ומרחק — לחיצה על המידה בתצוגה המקדימה. הערך הנעול קובע, השני מחושב.</div>
      </> },
          { key: 'conn', label: 'מחברים ופרט', render: () => <>{connFields}{firstKb && <ConnPreview connId={firstKb} compact />}</> },
          { key: 'plan', label: 'לפי מסגרות', render: () => <><KneeSides /><div className="panel-title" style={{ marginTop: 12 }}>טבלת אלכסונים</div><ComponentTable match={/^KB\./} testId="ctab-knee" /></> },
        ]} />
        <div className="live-note" data-testid="kb-live">כל שינוי מוצג מיד במודל ({n} אלכסונים) · Ctrl+Z לביטול · חריג לצד או למסגרת — בלשונית "לפי מסגרות"</div>
        <Help>בכל מפגש עמוד-קורה, לכל צד שבו הקורה ממשיכה. אין בדיקת חוזק.</Help>
      </>}
    </>
  );
}

/**
 * אלכסוני עמוד-קורה — איפה יש ואיפה אין: תוכנית לחיצה (עמודות = עמודים, שורות = מסגרות), בכל תא העמוד ושני צדדיו
 * (אלכסון שמאלי וימני — כולל צד הקונזולה בעמודי הקצה). מתחת — מידות לכל מפתח/קונזולה (חלה על שני הצדדים).
 */
export function kneeKeyParts(key: string) { const a = key.split('.'); return { lid: a[0], sd: a[a.length - 1] as 'L' | 'R' }; }
/** קיבוץ מפתחות "קו.מישור.צד" לפי עמוד (שני צדדים) ולפי מפתח (−1 = קונזולה שמאל, n = קונזולה ימין) */
export function kneeLayout(keys: string[], lineIds: string[]) {
  const li = (k: string) => lineIds.indexOf(kneeKeyParts(k).lid);
  const cols = lineIds.map((_id, i) => ({ i, left: keys.find((k) => li(k) === i && kneeKeyParts(k).sd === 'L'), right: keys.find((k) => li(k) === i && kneeKeyParts(k).sd === 'R') })).filter((c) => c.left || c.right);
  // מפתח של כל מפתח-צד: צד ימין של ציר i ⇒ מפתח i; צד שמאל של ציר i ⇒ מפתח i-1
  const spanOf = (k: string) => (kneeKeyParts(k).sd === 'R' ? li(k) : li(k) - 1);
  const nSpan = Math.max(1, lineIds.length - 1);
  const spans = Array.from({ length: nSpan + 2 }, (_, j) => j - 1).map((i) => ({ i, console: i < 0 || i >= nSpan, left: keys.find((k) => spanOf(k) === i && kneeKeyParts(k).sd === 'R'), right: keys.find((k) => spanOf(k) === i && kneeKeyParts(k).sd === 'L') })).filter((q) => q.left || q.right);
  return { cols, spans, nSpan };
}

export function KneeSides() {
  const kb = useStore((s) => s.project.building.kneeBraces) ?? defaultKneeBraces();
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const lines = [...(d.section?.lines ?? [])].sort((a, b) => a.x - b.x);
  const frames = [...p.building.frames].sort((a, b) => a.y - b.y);
  const truss = new Set(p.building.roofTruss?.enabled ? (p.building.roofTruss.frames === 'all' ? frames.map((f) => f.id) : p.building.roofTruss.frames) : []);
  const keys = [...new Set([...d.connections.filter((c) => c.type === 'knee').map((c) => c.id.split('.').slice(3).join('.')), ...Object.keys(kb.sides ?? {}), ...(kb.offCells ?? []).map((x) => x.split('|')[1])])];
  if (!keys.length) return null;
  const { cols, spans, nSpan } = kneeLayout(keys, lines.map((l) => l.id));
  const off = new Set(kb.offCells ?? []);
  const globalOff = (k: string) => kb.sides?.[k]?.on === false || kb.exclude.includes(k);
  const isOn = (fid: string, k: string) => !truss.has(fid) && !globalOff(k) && !off.has(`${fid}|${k}`);
  const commit = (nOff: Set<string>, sides: Record<string, KneeSideOverride>) => {
    // נרמול: מפתח-צד כבוי בכל המסגרות ⇒ on:false; דלוק בכולן ⇒ ללא רשומות
    for (const k of keys) {
      const fr = frames.filter((f) => !truss.has(f.id));
      const allOff = fr.length > 0 && fr.every((f) => nOff.has(`${f.id}|${k}`));
      if (allOff) { for (const f of frames) nOff.delete(`${f.id}|${k}`); sides[k] = { ...(sides[k] ?? {}), on: false }; }
    }
    store.exec(setKneeBraces({ offCells: [...nOff].sort(), sides, exclude: kb.exclude.filter((k) => !keys.includes(k) || sides[k]?.on === false) }));
  };
  const setCells = (cells: [string, string][], on: boolean) => {
    const nOff = new Set(off); const sides = { ...(kb.sides ?? {}) };
    for (const [fid, k] of cells) {
      if (globalOff(k)) {
        // היה כבוי בכל המסגרות — מדליקים את התא הזה בלבד
        const o = { ...(sides[k] ?? {}) }; delete o.on; sides[k] = o; if (!Object.keys(o).length) delete sides[k];
        for (const f of frames) if (!cells.some(([ff, kk]) => ff === f.id && kk === k)) nOff.add(`${f.id}|${k}`);
      }
      if (on) nOff.delete(`${fid}|${k}`); else nOff.add(`${fid}|${k}`);
    }
    commit(nOff, sides);
  };
  const toggle = (fid: string, k: string) => setCells([[fid, k]], !isOn(fid, k));
  const keysOf = (q: { left?: string; right?: string }) => [q.left, q.right].filter((k): k is string => !!k);
  const allKeys = cols.flatMap(keysOf);
  const toggleKeys = (ks: string[]) => { const any = frames.some((f) => ks.some((k) => isOn(f.id, k))); setCells(frames.filter((f) => !truss.has(f.id)).flatMap((f) => ks.map((k) => [f.id, k] as [string, string])), !any); };
  // 1.52: בחירה מהירה — טווח מסגרות / מסגרות הקצה / הכל (הטבלה מתעדכנת בהתאם)
  const setFrames = (want: (idx: number) => boolean) => {
    const nOff = new Set(off); const sides = { ...(kb.sides ?? {}) };
    for (const k of allKeys) { if (sides[k]?.on === false) { const o = { ...sides[k] }; delete o.on; sides[k] = o; if (!Object.keys(o).length) delete sides[k]; } }
    frames.forEach((f, i) => { for (const k of allKeys) { if (want(i)) nOff.delete(`${f.id}|${k}`); else nOff.add(`${f.id}|${k}`); } });
    commit(nOff, sides);
  };
  const toggleFrame = (fid: string) => { const any = allKeys.some((k) => isOn(fid, k)); setCells(allKeys.map((k) => [fid, k] as [string, string]), !any); };
  // מידות לכל מפתח — כותבות לשני הצדדים
  const setSpan = (q: (typeof spans)[number], patch: Partial<KneeSideOverride> | null) => {
    const sides = { ...(kb.sides ?? {}) };
    for (const k of keysOf(q)) { if (patch === null) { const on = sides[k]?.on; delete sides[k]; if (on === false) sides[k] = { on: false }; } else sides[k] = { ...(sides[k] ?? {}), ...patch }; }
    store.exec(setKneeBraces({ sides }));
  };
  const spanLabel = (q: (typeof spans)[number]) => (q.i < 0 ? `קונזולה ${lines[0]?.label ?? ''}` : q.i >= nSpan ? `קונזולה ${lines[lines.length - 1]?.label ?? ''}` : `${lines[q.i]?.label ?? ''}–${lines[q.i + 1]?.label ?? ''}`);
  const spanTid = (q: (typeof spans)[number]) => (q.i < 0 ? 'cL' : q.i >= nSpan ? 'cR' : String(q.i));
  const lenOf = (key: string) => { const m = d.members.find((x) => x.id.startsWith('KB.') && x.id.endsWith(`.${key}`)); return m ? Math.round(Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z)) : null; };
  const angleMode = (kb.mode ?? 'angle') === 'angle';
  const total = frames.reduce((a, f) => a + allKeys.filter((k) => isOn(f.id, k)).length, 0);
  // שרטוט: עמודה לכל עמוד — קו העמוד באמצע, אלכסון לכל צד
  const X0 = 22, cw = Math.max(34, Math.min(60, 260 / cols.length)), rh = Math.max(11, Math.min(18, 170 / frames.length)), Y0 = 16;
  const W = X0 + cw * cols.length + 4, H = Y0 + rh * frames.length + 4;
  return (
    <div className="op-card" data-testid="kb-sides">
      <b>איפה יש אלכסונים ({total})</b>
      <div className="kb-quick" data-testid="kb-quick">
        <span className="muted">מסגרות</span>
        <input className="inp num" type="number" min={1} max={frames.length} defaultValue={1} data-testid="kb-from" aria-label="ממסגרת" />
        <span>–</span>
        <input className="inp num" type="number" min={1} max={frames.length} defaultValue={frames.length} data-testid="kb-to" aria-label="עד מסגרת" />
        <button className="btn small" data-testid="kb-range" onClick={(e) => { const box = (e.currentTarget.parentElement!); const a = Number((box.querySelector('[data-testid=kb-from]') as HTMLInputElement).value) - 1, b = Number((box.querySelector('[data-testid=kb-to]') as HTMLInputElement).value) - 1; setFrames((i) => i >= Math.min(a, b) && i <= Math.max(a, b)); }}>רק בטווח</button>
        <span className="sep" />
        <button className="btn small" data-testid="kb-ends" onClick={() => setFrames((i) => i === 0 || i === frames.length - 1)}>מסגרות הקצה</button>
        <button className="btn small" data-testid="kb-all" onClick={() => setFrames(() => true)}>כל המסגרות</button>
      </div>
      <div className="hint">לכל עמוד שני צדדים (גם צד הקונזולה). לחיצה על אלכסון בתא — הדלקה/כיבוי במסגרת הזו · על שם העמוד — שני צדדיו בכל המסגרות · על מספר מסגרת — כל המסגרת.</div>
      <div className="schem" data-testid="kb-grid">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="אלכסוני עמוד-קורה — תוכנית לפי עמודים" style={{ maxWidth: `${Math.round(W * 3)}px`, margin: '0 auto', display: 'block' }}>
          {cols.map((q, c) => {
            const a = X0 + c * cw, xm = a + cw / 2;
            return <g key={q.i}>
              <text x={xm} y={9} className="sm-lbl-s kb-hd" textAnchor="middle" data-testid={`kb-col-${q.i}`} onClick={() => toggleKeys(keysOf(q))} style={{ cursor: 'pointer' }}>{lines[q.i]?.label ?? ''}</text>
              {frames.map((f, r) => {
                const y = Y0 + r * rh, tr = truss.has(f.id);
                const dia = (k: string | undefined, leftSide: boolean) => {
                  if (!k) return null;
                  const on = isOn(f.id, k);
                  const xA = leftSide ? xm - 2 : xm + 2, xB = leftSide ? a + cw * 0.12 : a + cw * 0.88;
                  return <g className="bay-cell" data-testid={`kb-cell-${r}-${k}`} onClick={() => !tr && toggle(f.id, k)}>
                    <rect x={leftSide ? a : xm} y={y} width={cw / 2} height={rh} fill="transparent" />
                    <line x1={xA} y1={y + rh - 2} x2={xB} y2={y + 2.5} className={on ? 'kb-on' : 'kb-off'} />
                  </g>;
                };
                return <g key={f.id}>
                  <rect x={a} y={y} width={cw} height={rh} className={tr ? 'bay' : 'bay on'} />
                  <line x1={a + 1} y1={y + 2} x2={a + cw - 1} y2={y + 2} className="sm-main" strokeWidth={0.8} />
                  <line x1={xm} y1={y + 2} x2={xm} y2={y + rh} className="sm-main" strokeWidth={1.4} />
                  {tr ? <text x={xm} y={y + rh / 2 + 2} className="sm-lbl-s" textAnchor="middle">מסבך</text> : <>{dia(q.left, true)}{dia(q.right, false)}</>}
                </g>;
              })}
            </g>;
          })}
          {frames.map((f, r) => <text key={f.id} x={X0 - 4} y={Y0 + r * rh + rh / 2 + 2} className="sm-lbl-s" textAnchor="end" data-testid={`kb-frame-${r}`} onClick={() => toggleFrame(f.id)} style={{ cursor: 'pointer' }}>{r + 1}</text>)}
        </svg>
      </div>
      <Adv id="kb-spans" label="ערך שונה לכל מפתח / קונזולה (ירידה, זווית, אורך)">
      <table className="mini-table"><thead><tr><th>מפתח</th><th>ירידה</th><th>{angleMode ? 'זווית' : 'מרחק'}</th><th>אורך</th><th /></tr></thead>
        <tbody>{spans.map((q) => {
          const k0 = (q.left ?? q.right)!, ov = kb.sides?.[k0] ?? {}, t = spanTid(q);
          const Ls = keysOf(q).map(lenOf).filter((x): x is number => x !== null);
          const custom = keysOf(q).some((k) => { const o = kb.sides?.[k]; return o && Object.keys(o).some((x) => x !== 'on'); });
          return (
            <tr key={q.i} data-testid={`kb-spanrow-${t}`}>
              <td>{spanLabel(q)}</td>
              <td><NumField testId={`kb-span-drop-${t}`} value={ov.drop ?? kb.drop} suffix="" onCommit={(v) => setSpan(q, { drop: v })} /></td>
              <td>{angleMode
                ? <NumField testId={`kb-span-angle-${t}`} value={ov.angle ?? kb.angle ?? 45} suffix="°" onCommit={(v) => setSpan(q, { angle: Math.max(15, Math.min(75, v)) })} />
                : <NumField testId={`kb-span-reach-${t}`} value={ov.reach ?? kb.reach} suffix="" onCommit={(v) => setSpan(q, { reach: v })} />}</td>
              <td className="num">{Ls.length ? [...new Set(Ls)].join('/') : '—'}</td>
              <td>{custom && <button className="btn small" title="חזרה להגדרה הכללית" onClick={() => setSpan(q, null)}>↺</button>}</td>
            </tr>
          );
        })}</tbody></table>
      </Adv>
    </div>
  );
}

/** תצוגה מקדימה של החתך: צירים, עמודים ומישורי גג. */
export function SectionPreview({ section, small }: { section: CustomSection; small?: boolean }) {
  const W = small ? 120 : 300, H = small ? 60 : 130, pad = small ? 6 : 14;
  const xs = [...section.lines.map((l) => l.x), ...section.planes.flatMap((p) => [p.x0, p.x1])];
  const zs = [0, ...section.planes.flatMap((p) => [p.z0, p.z1])];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z1 = Math.max(...zs);
  const k = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (z1 || 1));
  const X = (x: number) => pad + (x - x0) * k, Y = (z: number) => H - pad - z * k;
  const topAt = (x: number) => Math.max(0, ...section.planes.filter((p) => p.x0 - 1 <= x && x <= p.x1 + 1).map((p) => p.z0 + ((p.z1 - p.z0) * (x - p.x0)) / (p.x1 - p.x0)));
  const lines = [...section.lines].sort((a, b) => a.x - b.x);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`sec-svg${small ? ' small' : ''}`} role="img" aria-label="חתך המסגרת">
      <line x1={0} y1={Y(0)} x2={W} y2={Y(0)} className="g" />
      {lines.map((l, i) => <g key={l.id}><line x1={X(l.x)} y1={Y(0)} x2={X(l.x)} y2={Y(topAt(l.x))} className="c" />{!small && <text x={X(l.x)} y={H - 2} className="t">{lineLabel(i)}</text>}</g>)}
      {section.planes.map((p) => <line key={p.id} x1={X(p.x0)} y1={Y(p.z0)} x2={X(p.x1)} y2={Y(p.z1)} className="r" />)}
    </svg>
  );
}

/**
 * עורך חתך אינטראקטיבי: גרירת צירים (הצמדה ל-100 מ"מ, Shift = 10 מ"מ), מידות בין צירים, קונזולות וגבהים —
 * לחיצה על מידה פותחת שדה להקלדה. שינוי נשמר כפקודה אחת (ביטול אחד).
 */
export function InteractiveSection({ sec, apply, calcOf = () => 'top', setCalc = () => undefined, together, base, onBase }: {
  sec: CustomSection; apply: (s: CustomSection, label?: string) => void;
  calcOf?: (planeId: string) => TriCalc; setCalc?: (planeId: string, c: TriCalc) => void; together?: boolean;
  /** מפלס בסיס (מ"מ) — מידה לחיצה בקו הקרקע */
  base?: number; onBase?: (v: number) => void;
}) {
  const showZ = useContext(SecHeightsCtx);
  const W = 300, H = 170, padX = 18, padTop = 26, padBot = 40;
  // מפלס ייחוס לגבהים (תצוגה והזנה): המודל שומר פני עליון קורת הגג; כאן מוסיפים/מפחיתים את שכבות הגג או הקורה והפלטות
  const proj = useStore((s) => s.project);
  const der = useStore((s) => s.derived);
  const datum = proj.settings.heightDatum ?? 'tos';
  const datumOff = (planeId: string) => {
    if (datum === 'tos') return 0;
    const pl = sec.planes.find((q) => q.id === planeId);
    const kk = pl ? Math.sqrt(1 + ((pl.z1 - pl.z0) / ((pl.x1 - pl.x0) || 1)) ** 2) : 1;
    if (datum === 'col') {
      const e = proj.connectionDefaults.eave;
      return -((tryProfile(proj.building.rafterProfile)?.props.h ?? 0) * kk + (e.t ?? 12) * (e.split === false ? 1 : 2));
    }
    const pm = der.members.find((m) => m.purlin?.side === planeId) ?? der.members.find((m) => m.purlin);
    const ph = (pm ? tryProfile(pm.profile)?.props.h : undefined) ?? 0;
    const rc = proj.building.cladding?.roof;
    return ph * kk + (datum === 'roof' && rc?.enabled ? (rc.thickness ?? 0) : 0);
  };
  const [drag, setDrag] = useState<{ id: string; x: number } | null>(null);
  const [selPl, setSelPl] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ kind: 'span' | 'ovl' | 'ovr' | 'z' | 'base'; key: string; at: { x: number; y: number }; value: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lines0 = [...sec.lines].sort((a, b) => a.x - b.x);
  const lines = lines0.map((l) => (drag && l.id === drag.id ? { ...l, x: drag.x } : l));
  const xs = [...lines.map((l) => l.x), ...sec.planes.flatMap((p) => [p.x0, p.x1])];
  const zs = [0, ...sec.planes.flatMap((p) => [p.z0, p.z1])];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z1 = Math.max(...zs);
  const k = Math.min((W - 2 * padX) / (x1 - x0 || 1), (H - padTop - padBot) / (z1 || 1));
  const X = (x: number) => padX + (x - x0) * k, Y = (z: number) => H - padBot - z * k;
  const toModelX = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return x0 + ((clientX - r.left) * (W / r.width) - padX) / k;
  };
  const topAt = (x: number) => Math.max(0, ...sec.planes.filter((p) => p.x0 - 1 <= x && x <= p.x1 + 1).map((p) => p.z0 + ((p.z1 - p.z0) * (x - p.x0)) / (p.x1 - p.x0)));
  const commitLines = (nl: { id: string; x: number }[], label: string) => apply(moveLines(sec, new Map(nl.map((q) => [q.id, q.x]))), label);
  const onDown = (id: string) => (e: React.PointerEvent) => { (e.target as Element).setPointerCapture(e.pointerId); setDrag({ id, x: lines0.find((l) => l.id === id)!.x }); };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const step = e.shiftKey ? 10 : 100;
    setDrag({ ...drag, x: Math.round(toModelX(e.clientX) / step) * step });
  };
  const onUp = () => {
    if (!drag) return;
    const orig = lines0.find((l) => l.id === drag.id)!;
    if (Math.abs(orig.x - drag.x) > 0.5) commitLines([{ id: drag.id, x: drag.x }], 'הזזת ציר');
    setDrag(null);
  };
  const svgPt = (sx: number, sy: number) => ({ x: (sx / W) * 100, y: (sy / H) * 100 });
  const openEdit = (kind: 'span' | 'ovl' | 'ovr' | 'z' | 'base', key: string, sx: number, sy: number, value: number) => setEdit({ kind, key, at: svgPt(sx, sy), value });
  const commitEdit = (v: number) => {
    if (!edit) return;
    if (edit.kind === 'base') { onBase?.(v); setEdit(null); return; }
    if (edit.kind === 'span') {
      // מרווח בין ציר i לציר i+1: מזיז את כל הצירים שמימין
      const i = Number(edit.key);
      const delta = v - (lines0[i + 1].x - lines0[i].x);
      commitLines(lines0.map((l, j) => ({ id: l.id, x: j > i ? l.x + delta : l.x })), 'שינוי מרווח צירים');
    } else if (edit.kind === 'ovl' || edit.kind === 'ovr') {
      const pl = edit.kind === 'ovl' ? sec.planes.reduce((p, q) => (q.x0 < p.x0 ? q : p)) : sec.planes.reduce((p, q) => (q.x1 > p.x1 ? q : p));
      const s = (pl.z1 - pl.z0) / (pl.x1 - pl.x0);
      const patch = edit.kind === 'ovl' ? { x0: lines0[0].x - v, z0: pl.z1 - s * (pl.x1 - (lines0[0].x - v)) } : { x1: lines0[lines0.length - 1].x + v, z1: pl.z0 + s * (lines0[lines0.length - 1].x + v - pl.x0) };
      apply({ ...sec, template: undefined, planes: sec.planes.map((q) => (q.id === pl.id ? { ...q, ...patch } : q)) }, 'שינוי קונזולה');
    } else {
      const [pid, end] = edit.key.split(':');
      const vz = v - datumOff(pid);
      apply({ ...sec, template: undefined, planes: sec.planes.map((q) => (q.id === pid ? { ...q, [end === 'x0' ? 'z0' : 'z1']: vz } : q)) }, 'שינוי גובה');
    }
    setEdit(null);
  };
  const m = (v: number) => (v / 1000).toFixed(2);
  const yDim = H - padBot + 16, yOv = H - padBot + 30;
  return (
    <div className="isec" data-testid="isec">
      {!showZ && <div className="hint isec-zlink" data-testid="isec-zlink">גבהים ושיפועים — בחתך המסגרת: <button className="wz-link" onClick={() => document.querySelector<HTMLButtonElement>('[data-testid="ks-sec-geo"]')?.click()}>2 גיאומטריה ←</button></div>}
      {showZ && <div className="isec-datum">
        <label htmlFor="isec-datum">הגבהים בשרטוט מתייחסים ל:</label>
        <select id="isec-datum" className="inp" data-testid="isec-datum" value={datum} onChange={(e) => store.exec(setSettings({ heightDatum: e.target.value as 'tos' | 'col' | 'purlin' | 'roof' }))}>
          <option value="tos">פני עליון קורת הגג (פלדה)</option>
          <option value="col">ראש העמוד (מתחת לקורה ולפלטות)</option>
          <option value="purlin">פני עליון הפטות</option>
          <option value="roof">פני הגג הגמור (פטה + פנל)</option>
        </select>
      </div>}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="sec-svg isec-svg" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} role="img" aria-label="עורך חתך">
        <line x1={0} y1={Y(0)} x2={W} y2={Y(0)} className="g" />
        {sec.planes.map((p) => (
          <g key={p.id} className={`isec-pl${selPl === p.id ? ' on' : ''}`} onClick={() => setSelPl(selPl === p.id ? null : p.id)} data-testid={`isec-pl-${p.id}`}>
            <line x1={X(p.x0)} y1={Y(p.z0)} x2={X(p.x1)} y2={Y(p.z1)} className="r" />
            <line x1={X(p.x0)} y1={Y(p.z0)} x2={X(p.x1)} y2={Y(p.z1)} className="hit" />
          </g>
        ))}
        {lines.map((l, i) => (
          <g key={l.id} className={`isec-ax${drag?.id === l.id ? ' on' : ''}`} onPointerDown={onDown(l.id)} data-testid={`isec-ax-${i}`}>
            <line x1={X(l.x)} y1={Y(0)} x2={X(l.x)} y2={Y(topAt(l.x))} className="c" />
            <line x1={X(l.x)} y1={Y(0) + 3} x2={X(l.x)} y2={Y(topAt(l.x)) - 2} className="hit" />
            <circle cx={X(l.x)} cy={Y(0) + 9} r={6} className="bub" /><text x={X(l.x)} y={Y(0) + 12} className="t b">{store.state.project.building.lineLabels?.[l.id] || lineLabel(i)}</text>
          </g>
        ))}
        {lines.slice(1).map((l, i) => {
          const a = X(lines[i].x), b = X(l.x);
          return (
            <g key={`d${l.id}`} className="isec-dim" onClick={() => openEdit('span', String(i), (a + b) / 2, yDim, l.x - lines[i].x)} data-testid={`isec-span-${i}`}>
              <line x1={a} y1={yDim} x2={b} y2={yDim} /><text x={(a + b) / 2} y={yDim - 2} className="t">{m(l.x - lines[i].x)}</text>
            </g>
          );
        })}
        {(() => {
          const L0 = Math.min(...sec.planes.map((p) => p.x0)), R1 = Math.max(...sec.planes.map((p) => p.x1));
          const a = lines[0].x, b = lines[lines.length - 1].x;
          return <>
            <g className="isec-dim" onClick={() => openEdit('ovl', '', (X(L0) + X(a)) / 2, yOv, a - L0)} data-testid="isec-ovl"><line x1={X(L0)} y1={yOv} x2={X(a)} y2={yOv} /><text x={(X(L0) + X(a)) / 2} y={yOv - 2} className="t">{m(a - L0)}</text></g>
            <g className="isec-dim" onClick={() => openEdit('ovr', '', (X(b) + X(R1)) / 2, yOv, R1 - b)} data-testid="isec-ovr"><line x1={X(b)} y1={yOv} x2={X(R1)} y2={yOv} /><text x={(X(b) + X(R1)) / 2} y={yOv - 2} className="t">{m(R1 - b)}</text></g>
          </>;
        })()}
        {showZ && sec.planes.flatMap((p, pi) => (['x0', 'x1'] as const).map((e) => {
          const x = p[e], z = e === 'x0' ? p.z0 : p.z1;
          // רכס/צומת משותף לשני מישורים באותו גובה: תווית אחת (שתיים היו נכתבות זו על זו)
          const dup = sec.planes.some((q, qi) => qi < pi && ((Math.abs(q.x0 - x) < 1 && Math.abs(q.z0 - z) < 1) || (Math.abs(q.x1 - x) < 1 && Math.abs(q.z1 - z) < 1)));
          if (dup) return null;
          return (
            <g key={`${p.id}${e}`} className="isec-dim z" onClick={() => openEdit('z', `${p.id}:${e}`, X(x), Y(z) - 10, z + datumOff(p.id))} data-testid={`isec-z-${p.id}-${e}`}>
              <text x={X(x) + (e === 'x0' ? 2 : -2)} y={Y(z) - 5} className={`t ${e === 'x0' ? 'st' : 'en'}`}>{m(z + datumOff(p.id))}</text>
            </g>
          );
        }))}
        {onBase && <g className="isec-dim" onClick={() => openEdit('base', '', 12, Y(0) - 6, base ?? 0)} data-testid="isec-base">
          <text x={4} y={Y(0) - 3} className="t en">{`מפלס ${(base ?? 0) >= 0 ? '+' : ''}${m(base ?? 0)}`}</text></g>}
        {(() => { const L0 = Math.min(...sec.planes.map((p) => p.x0)); return <text x={(X(L0) + X(lines[0].x)) / 2} y={yOv + 8} className="t sm">קונזולה</text>; })()}
        {(() => { const R1 = Math.max(...sec.planes.map((p) => p.x1)); return <text x={(X(R1) + X(lines[lines.length - 1].x)) / 2} y={yOv + 8} className="t sm">קונזולה</text>; })()}
        {drag && <text x={X(drag.x)} y={padTop - 10} className="t b">{m(drag.x)}</text>}
      </svg>
      {edit && (
        <input className="inp num isec-inp" autoFocus defaultValue={(edit.value / 1000).toFixed(3)} style={{ left: `${edit.at.x}%`, top: `${edit.at.y}%` }} data-testid="isec-input" title="מטר" placeholder="מ'"
          onKeyDown={(e) => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value.replace(',', '.')); if (Number.isFinite(v)) commitEdit(v * 1000); else setEdit(null); } if (e.key === 'Escape') setEdit(null); }}
          onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v) && Math.abs(v * 1000 - edit.value) > 0.5) commitEdit(v * 1000); else setEdit(null); }} />
      )}
      {selPl && (() => {
        const pl = sec.planes.find((q) => q.id === selPl);
        const pd = pl && planeDims(sec, pl.id);
        if (!pl || !pd) return null;
        const i = sec.planes.indexOf(pl);
        const pair = together ? gablePair(sec) : null;
        return (
          <div className="pl-card" data-testid="pl-card">
            <div className="pl-card-h"><b>{pair ? 'גג דו-שיפועי (שני הצדדים)' : `מישור גג ${i + 1}`}</b><button className="icon-btn" onClick={() => setSelPl(null)}>✕</button></div>
            <TriDims testId="plc" unit="m" col={pd.zLow} top={pd.zHigh} run={pd.run} calc={calcOf(pl.id)} onCalc={(c) => setCalc(pl.id, c)}
              labels={pair ? { col: 'גובה עמודים (צירים קיצוניים)', top: 'גובה רכס' } : planeLabels(pd)}
              onCommit={(v) => apply(pair ? setPlaneDims(setPlaneDims(sec, pair.a, v.col, v.top), pair.b, v.col, v.top) : setPlaneDims(sec, pl.id, v.col, v.top), 'מידות גג')} />
          </div>
        );
      })()}
      <div className="hint" style={{ margin: '2px 4px' }}>לחץ על קו גג לשינוי גובה עמוד / רכס / שיפוע · גרור ציר להזזה (Shift = דיוק 10 מ"מ) · לחץ על מידה כדי להקליד ערך — בחתך הזה במטר (בשאר השרטוטים במ"מ)</div>
    </div>
  );
}
