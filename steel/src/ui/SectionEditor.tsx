import { useRef, useState } from 'react';
import { setBuilding, setKneeBraces, setSection } from '../commands/commands';
import { defaultKneeBraces } from '../geometry/knee';
import { defaultHaunch } from '../geometry/haunch';
import { lineLabel, moveLines, setAxisCount, setPlaneEndZ, setPlaneSlope, SECTION_TEMPLATES, toCustomSection, type CustomSection, type RoofPlaneDef } from '../model/section';
import { store, useStore } from '../store';
import { Adv, LenField, NumField, ProfilePicker } from './fields';
import { Icon } from './icons';
import type { KneeSideOverride } from '../model/types';
import { KneeSchematic } from './schematics';

/**
 * בונה החתך המודולרי (החלטת משתמש 15.11.2026): תבניות + טבלת צירי עמודים + טבלת מישורי גג, עם תצוגה מקדימה.
 * כל שינוי חל מיד על המודל (פקודה אחת, ביטול אחד).
 */
export function SectionEditor() {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  const b = p.building;
  const sec = b.section;
  const u = p.displayUnit;
  const apply = (s2: CustomSection | undefined, label?: string) => store.exec(setSection(s2, label));
  return (
    <>
      <div className="panel-title">צורת הסככה — בחר תבנית, ושנה כל מידה בשרטוט</div>
      <div className="tpl-grid">
        {SECTION_TEMPLATES.map((t) => (
          <button key={t.id} className={`tpl${sec?.template === t.id ? ' on' : ''}`} data-testid={`tpl-${t.id}`} title={t.desc}
            onClick={() => {
              if (sec && !confirm(`להחליף את החתך בתבנית "${t.name}"?`)) return;
              // תבנית = סככה כמו בתוכניות: כולל אלכסוני עמוד-קורה (ניתן לבטל)
              const s2 = setSection(t.make(), `תבנית חתך: ${t.name}`), k2 = setKneeBraces({ enabled: true });
              store.exec({ label: `תבנית חתך: ${t.name}`, run: (pp) => k2.run(s2.run(pp)) });
            }}>
            <SectionPreview section={t.make()} small /><span>{t.name}</span>
          </button>
        ))}
      </div>
      {/* אין "קלאסי" נפרד: מבנה של 2 צירים מוצג ונערך באותו עורך (העריכה הראשונה שומרת אותו כחתך) */}
      <ModularTables sec={sec ?? toCustomSection(b, d.roof)} unit={u} apply={apply} />
      <button className="btn small link-nav" data-testid="goto-knee" onClick={() => window.dispatchEvent(new CustomEvent('ksp-nav', { detail: 'b:knee' }))}>אלכסוני עמוד-קורה, חיזוק רכס וקושרות ← חיזוקים וקשיחות</button>
    </>
  );
}

function ModularTables({ sec, unit: u, apply }: { sec: CustomSection; unit: 'm' | 'mm'; apply: (s: CustomSection, label?: string) => void }) {
  const lines = [...sec.lines].sort((a, b) => a.x - b.x);
  const lineBase = useStore((st) => st.project.building.lineBase) ?? {};
  const baseEl = useStore((st) => st.project.building.baseElevation);
  const setLine = (id: string, x: number) => apply(moveLines(sec, new Map([[id, x]])), 'הזזת ציר');
  const setPlane = (id: string, patch: Partial<RoofPlaneDef>) => apply({ ...sec, template: undefined, planes: sec.planes.map((pl) => (pl.id === id ? { ...pl, ...patch } : pl)) });
  const newId = (pre: string, used: string[]) => { let i = 1; while (used.includes(`${pre}${i}`)) i++; return `${pre}${i}`; };
  const slope = (pl: RoofPlaneDef) => ((pl.z1 - pl.z0) / (pl.x1 - pl.x0)) * 100;
  return (
    <>
      <div className="axis-count" data-testid="axis-count">
        <div className="field"><label>מספר צירי עמודים</label><NumField testId="axis-n" value={sec.lines.length} onCommit={(v) => apply(setAxisCount(sec, v), 'מספר צירים')} /></div>
        <div className="field"><label>רוחב בין הצירים הקיצוניים</label><LenField testId="axis-w" mm={Math.max(...sec.lines.map((l) => l.x)) - Math.min(...sec.lines.map((l) => l.x))} unit={u} onCommit={(v) => apply(setAxisCount(sec, sec.lines.length, v), 'רוחב כולל')} /></div>
        <div className="hint" style={{ margin: 0 }}>הצירים מחולקים שווה; אחר כך אפשר לשנות כל מפתח בשרטוט (לחיצה על המידה) או לגרור ציר.</div>
      </div>
      <div className="sec-prev"><InteractiveSection sec={sec} apply={apply} /></div>
      <div className="panel-title">צירי עמודים ({lines.length})
        <button className="btn small" data-testid="sec-add-line" onClick={() => {
          const last = lines[lines.length - 1];
          apply({ ...sec, lines: [...sec.lines, { id: newId('C', sec.lines.map((l) => l.id)), x: last.x + 6000 }] }, 'הוספת ציר');
        }}><Icon name="plus" />ציר</button>
      </div>
      <table className="tbl" data-testid="sec-lines">
        <thead><tr><th>ציר</th><th>מיקום X</th><th>מפתח</th><th title="מפלס תחתית העמוד: פני חגורה / יסוד, ביחס ל-±0.00">תחתית עמוד</th><th title="קיר קיים: אין עמוד — הקורות מעוגנות לקיר">קיר</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id}>
              <td><b>{lineLabel(i)}</b></td>
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
      {Object.values(lineBase).some((z) => Math.abs(z - baseEl) > 1) && <div className="hint">תחתית עמוד מעל ±0.00 (חגורה / יסוד מוגבה): העמוד בציר מתקצר, גובה הגג לא משתנה. במסגרות ובתוכנית העיגון מופיע מפלס לכל ציר.</div>}
      <Overhangs sec={sec} unit={u} apply={apply} />
      <div className="panel-title">מישורי גג ({sec.planes.length})
        <button className="btn small" data-testid="sec-add-plane" onClick={() => {
          const xs = lines.map((l) => l.x);
          const x0 = Math.min(...xs), x1 = Math.max(...xs);
          apply({ ...sec, planes: [...sec.planes, { id: newId('P', sec.planes.map((q) => q.id)), x0, z0: 6000, x1, z1: 6000 + 0.1 * (x1 - x0), start: 'x1' }] }, 'הוספת מישור');
        }}><Icon name="plus" />מישור</button>
      </div>
      {sec.planes.map((pl, i) => (
        <div className="plane-card" key={pl.id} data-testid={`sec-plane-${i}`}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>שיפוע {i + 1} <span className="mono muted">{pl.id}</span></b>
            <span className="badge">{slope(pl).toFixed(1)}%</span>
            {sec.planes.length > 1 && <button className="icon-btn" title="מחיקת מישור" onClick={() => apply({ ...sec, planes: sec.planes.filter((q) => q.id !== pl.id) }, 'מחיקת מישור')}><Icon name="x" /></button>}
          </div>
          <div className="grid-4">
            <label>X שמאל<LenField mm={pl.x0} unit={u} testId={`pl-x0-${i}`} onCommit={(v) => setPlane(pl.id, { x0: v })} /></label>
            <label>גובה שמאל<LenField mm={pl.z0} unit={u} testId={`pl-z0-${i}`} onCommit={(v) => setPlane(pl.id, { z0: v })} /></label>
            <label>X ימין<LenField mm={pl.x1} unit={u} testId={`pl-x1-${i}`} onCommit={(v) => setPlane(pl.id, { x1: v })} /></label>
            <label>גובה ימין<LenField mm={pl.z1} unit={u} testId={`pl-z1-${i}`} onCommit={(v) => setPlane(pl.id, { z1: v })} /></label>
          </div>
          <div className="row">
            <span className="hint" style={{ margin: 0 }}>שיפוע</span>
            <div style={{ width: 90 }}><NumField testId={`pl-slope-${i}`} value={+slope(pl).toFixed(3)} suffix="%" onCommit={(v) => setPlane(pl.id, (pl.fixed ?? pl.start) === 'x1' ? { z0: pl.z1 - (v / 100) * (pl.x1 - pl.x0) } : { z1: pl.z0 + (v / 100) * (pl.x1 - pl.x0) })} /></div>
            <span className="hint" style={{ margin: 0 }}>גובה קבוע</span>
            <div className="seg">
              <button className={`tbtn${(pl.fixed ?? pl.start) === 'x0' ? ' on' : ''}`} data-testid={`pl-fix0-${i}`} onClick={() => setPlane(pl.id, { fixed: 'x0' })}>שמאל</button>
              <button className={`tbtn${(pl.fixed ?? pl.start) === 'x1' ? ' on' : ''}`} data-testid={`pl-fix1-${i}`} onClick={() => setPlane(pl.id, { fixed: 'x1' })}>ימין</button>
            </div>
          </div>
        </div>
      ))}
      <div className="hint">גבהים = פני עליון של קורת הגג. מישור שעובר מעל עמוד יושב עליו (ראש עמוד); מישור שמסתיים בעמוד שממשיך למעלה מתחבר לצדו; שני קצוות באותה נקודה ללא עמוד = רכס. שינוי שיפוע שומר על הגובה בצד הקבוע. צד התחלת הפטות — בגג ופטות.</div>
    </>
  );
}

/** קונזולות שמאל/ימין: מעבר קורות הגג מעבר לציר העמודים הקיצוני (שינוי מזיז את קצה המישור לאורך השיפוע) */
function Overhangs({ sec, unit: u, apply }: { sec: CustomSection; unit: 'm' | 'mm'; apply: (s: CustomSection, label?: string) => void }) {
  const xs = sec.lines.map((l) => l.x);
  const xa = Math.min(...xs), xb = Math.max(...xs);
  const left = sec.planes.reduce((p, q) => (q.x0 < p.x0 ? q : p));
  const right = sec.planes.reduce((p, q) => (q.x1 > p.x1 ? q : p));
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
      <div className="panel-title">קונזולות</div>
      <div className="field"><label>קונזולה שמאל (מציר {lineLabel(0)})</label><LenField testId="ovh-left" mm={Math.max(0, xa - left.x0)} unit={u} onCommit={(v) => setEnd(left, 'x0', xa - v)} /></div>
      <div className="field"><label>קונזולה ימין (מציר {lineLabel(xs.length - 1)})</label><LenField testId="ovh-right" mm={Math.max(0, right.x1 - xb)} unit={u} onCommit={(v) => setEnd(right, 'x1', xb + v)} /></div>
      {steps.map((st) => (
        <div className="field" key={`${st.pl.id}-${st.end}`}><label>זיז קורה עליונה בדירוג — ציר {lineLabel(st.li)} ({st.end === 'x0' ? 'שמאלה' : 'ימינה'}, מעבר לעמוד)</label>
          <LenField testId={`ovh-step-${st.li}`} mm={st.v} unit={u} onCommit={(v) => setEnd(st.pl, st.end, st.end === 'x0' ? st.x - Math.max(0, v) : st.x + Math.max(0, v))} /></div>
      ))}
      {steps.length > 0 && <div className="hint">זיז בדירוג: הקורה העליונה ממשיכה מעבר לעמוד מעל הגג הנמוך — מונע כניסת גשם לפתח שבין הגגות.</div>}
    </>
  );
}

export function HaunchEditor() {
  const b = useStore((s) => s.project.building);
  const hp = b.haunch ?? { ...defaultHaunch(), enabled: false };
  const n = useStore((s) => s.derived.connections.filter((c) => c.id.startsWith('C.HN.')).length);
  const set = (patch: Partial<typeof hp>) => store.exec(setBuilding({ haunch: { ...hp, ...patch } }));
  return (
    <>
      <div className="panel-title">מכפל בראש העמוד
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="hn-on" checked={hp.enabled} onChange={(e) => set({ enabled: e.target.checked })} />פעיל {hp.enabled ? `(${n})` : ''}</label>
      </div>
      {hp.enabled && <>
        <div className="field"><label>אורך מפני העמוד</label><NumField testId="hn-length" value={hp.length} suffix='מ"מ' onCommit={(v) => set({ length: Math.max(300, v) })} /></div>
        <div className="field"><label>עומק בפני העמוד (0 = עומק הקורה)</label><NumField testId="hn-depth" value={hp.depth} suffix='מ"מ' onCommit={(v) => set({ depth: Math.max(0, v) })} /></div>
        <div className="field"><label>עובי גוף / אגף (0 = כמו הקורה)</label><span className="row"><NumField value={hp.webT} suffix='מ"מ' onCommit={(v) => set({ webT: Math.max(0, v) })} /><NumField value={hp.flangeT} suffix='מ"מ' onCommit={(v) => set({ flangeT: Math.max(0, v) })} /></span></div>
        <div className="hint">פח גוף משולש + פח אגף משופע, מרותכים מתחת לקורת הגג במסגריה (מכלול אחד עם הקורה), בכל צד שבו הקורה ממשיכה מעבר לעמוד. מאפשר קורה קלה יותר במפתח גדול — ללא בדיקת חוזק בתוכנה.</div>
      </>}
    </>
  );
}

export function KneeEditor() {
  const kb = useStore((s) => s.project.building.kneeBraces) ?? defaultKneeBraces();
  const n = useStore((s) => s.derived.connections.filter((c) => c.type === 'knee').length);
  const set = (patch: Parameters<typeof setKneeBraces>[0]) => store.exec(setKneeBraces(patch));
  return (
    <>
      <div className="panel-title">אלכסוני עמוד-קורה
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="kb-on" checked={kb.enabled} onChange={(e) => set({ enabled: e.target.checked })} />פעיל {kb.enabled ? `(${n})` : ''}</label>
      </div>
      {kb.enabled && <>
        <KneeSchematic />
        <div className="field prof"><label>חתך</label><ProfilePicker testId="kb-profile" value={kb.profile} families={['RHS', 'SHS', 'CHS', 'L', 'UPN']} onCommit={(v) => set({ profile: v })} /></div>
        <div className="field"><label>ירידה על העמוד</label><NumField testId="kb-drop" value={kb.drop} suffix='מ"מ' onCommit={(v) => set({ drop: v })} /></div>
        <div className="field"><label>קביעת הנקודה על הקורה</label>
          <div className="seg">
            <button className={`tbtn${(kb.mode ?? 'angle') === 'angle' ? ' on' : ''}`} data-testid="kb-mode-angle" onClick={() => set({ mode: 'angle' })}>זווית</button>
            <button className={`tbtn${kb.mode === 'reach' ? ' on' : ''}`} data-testid="kb-mode-reach" onClick={() => set({ mode: 'reach' })}>מרחק אופקי</button>
          </div>
        </div>
        {(kb.mode ?? 'angle') === 'angle'
          ? <div className="field"><label>זווית מהאופק</label><NumField testId="kb-angle" value={kb.angle ?? 45} suffix="°" onCommit={(v) => set({ angle: Math.max(15, Math.min(75, v)) })} /></div>
          : <div className="field"><label>מרחק על הקורה (אופקי)</label><NumField testId="kb-reach" value={kb.reach} suffix='מ"מ' onCommit={(v) => set({ reach: v })} /></div>}
        <Adv id="kb" label="מתקדם — פרט חיבור, ברגים, עובי, הגדרה לכל צד">
        <div className="field"><label>פרט חיבור</label>
          <select className="inp" data-testid="kb-detail" value={kb.detail === 'flange' ? 'flange' : 'fin'} onChange={(e) => set({ detail: e.target.value as 'fin' | 'flange' })}>
            <option value="fin">פח מרותך + לשונית בחריץ ה-RHS (פרט הלקוח)</option><option value="flange">פלטת קצה מוברגת לאגף המארח</option>
          </select></div>
        {kb.detail !== 'flange'
          ? <div className="field"><label>ברגים בכל קצה</label>
              <select className="inp" data-testid="kb-bolts" value={kb.boltsPerEnd ?? 2} onChange={(e) => set({ boltsPerEnd: Number(e.target.value) })}>{[2, 4, 6].map((n) => <option key={n} value={n}>{n}×M{kb.bolt.d} — {n / 2} {n === 2 ? 'שורה' : 'שורות'} של 2 לרוחב</option>)}</select></div>
          : <div className="field"><label>פלטת קצה / ברגים</label><span className="readonly">{kb.plateT}×{kb.plateW}×{kb.plateL} · 4×M{kb.bolt.d}</span></div>}
        <div className="field"><label>עובי פלטות</label><NumField testId="kb-t" value={kb.plateT} suffix='מ"מ' onCommit={(v) => set({ plateT: Math.max(6, v) })} /></div>
        <KneeSides />
        </Adv>
        <div className="hint">בכל מפגש עמוד-קורה, לכל צד שבו הקורה ממשיכה. פרט הלקוח: פח מרותך לעמוד ולקורה (במישור המסגרת, מסגריה); בקצות ה-RHS חריץ ברוחב עובי הפח ולשונית מרותכת בתוכו; בשטח הלשונית צמודה לפח ומוברגת. אין בדיקת חוזק.</div>
      </>}
    </>
  );
}

/** הגדרה לכל צד בנפרד: כל מפגש עמוד-קורה וצד (מפתח) — פעיל, ירידה, זווית/מרחק; ריק = לפי ההגדרה הכללית */
function KneeSides() {
  const kb = useStore((s) => s.project.building.kneeBraces) ?? defaultKneeBraces();
  const d = useStore((s) => s.derived);
  const lines = [...(d.section?.lines ?? [])].sort((a, b) => a.x - b.x);
  const keys = [...new Set([...d.connections.filter((c) => c.type === 'knee').map((c) => c.id.split('.').slice(3).join('.')), ...Object.keys(kb.sides ?? {})])]
    .sort((a, b) => lines.findIndex((l) => l.id === a.split('.')[0]) - lines.findIndex((l) => l.id === b.split('.')[0]) || a.localeCompare(b));
  if (!keys.length) return null;
  const setSide = (key: string, patch: Partial<KneeSideOverride> | null) => {
    const sides = { ...(kb.sides ?? {}) };
    if (patch === null) delete sides[key]; else sides[key] = { ...(sides[key] ?? {}), ...patch };
    store.exec(setKneeBraces({ sides }));
  };
  const lenOf = (key: string) => { const m = d.members.find((x) => x.id.startsWith('KB.') && x.id.endsWith(`.${key}`)); return m ? Math.round(Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z)) : null; };
  const angleMode = (kb.mode ?? 'angle') === 'angle';
  return (
    <div className="op-card" data-testid="kb-sides">
      <b>הגדרה לכל צד (מפתח)</b>
      <div className="hint">ריק = לפי ההגדרה הכללית. מאפשר אורכי אלכסון שונים במפתחים שונים.</div>
      <table className="mini-table"><thead><tr><th>מיקום</th><th>פעיל</th><th>ירידה</th><th>{angleMode ? 'זווית' : 'מרחק'}</th><th>אורך</th><th /></tr></thead>
        <tbody>{keys.map((key) => {
          const [lineId, , sd] = key.split('.');
          const li = lines.findIndex((l) => l.id === lineId);
          const span = sd === 'L' ? li : li + 1;
          const ov = kb.sides?.[key] ?? {};
          const L = lenOf(key);
          return (
            <tr key={key} data-testid={`kb-side-${key}`}>
              <td>ציר {lines[li]?.label ?? lineId} · {sd === 'L' ? 'שמאל' : 'ימין'} (מפתח {span})</td>
              <td><input type="checkbox" data-testid={`kb-side-on-${key}`} checked={ov.on !== false} onChange={(e) => setSide(key, { on: e.target.checked })} /></td>
              <td><NumField testId={`kb-side-drop-${key}`} value={ov.drop ?? kb.drop} suffix="" onCommit={(v) => setSide(key, { drop: v })} /></td>
              <td>{angleMode
                ? <NumField testId={`kb-side-angle-${key}`} value={ov.angle ?? kb.angle ?? 45} suffix="°" onCommit={(v) => setSide(key, { angle: Math.max(15, Math.min(75, v)) })} />
                : <NumField testId={`kb-side-reach-${key}`} value={ov.reach ?? kb.reach} suffix="" onCommit={(v) => setSide(key, { reach: v })} />}</td>
              <td className="num">{ov.on === false ? '—' : L ?? '—'}</td>
              <td>{kb.sides?.[key] && <button className="btn small" title="חזרה להגדרה הכללית" data-testid={`kb-side-reset-${key}`} onClick={() => setSide(key, null)}>↺</button>}</td>
            </tr>
          );
        })}</tbody></table>
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
export function InteractiveSection({ sec, apply }: { sec: CustomSection; apply: (s: CustomSection, label?: string) => void }) {
  const W = 300, H = 170, padX = 18, padTop = 26, padBot = 40;
  const [drag, setDrag] = useState<{ id: string; x: number } | null>(null);
  const [selPl, setSelPl] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ kind: 'span' | 'ovl' | 'ovr' | 'z'; key: string; at: { x: number; y: number }; value: number } | null>(null);
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
  const openEdit = (kind: 'span' | 'ovl' | 'ovr' | 'z', key: string, sx: number, sy: number, value: number) => setEdit({ kind, key, at: svgPt(sx, sy), value });
  const commitEdit = (v: number) => {
    if (!edit) return;
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
      apply({ ...sec, template: undefined, planes: sec.planes.map((q) => (q.id === pid ? { ...q, [end === 'x0' ? 'z0' : 'z1']: v } : q)) }, 'שינוי גובה');
    }
    setEdit(null);
  };
  const m = (v: number) => (v / 1000).toFixed(2);
  const yDim = H - padBot + 16, yOv = H - padBot + 30;
  return (
    <div className="isec" data-testid="isec">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="sec-svg isec-svg" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} role="img" aria-label="עורך חתך">
        <line x1={0} y1={Y(0)} x2={W} y2={Y(0)} className="g" />
        {sec.planes.map((p) => (
          <g key={p.id} className={`isec-pl${selPl === p.id ? ' on' : ''}`} onClick={() => setSelPl(selPl === p.id ? null : p.id)} data-testid={`isec-pl-${p.id}`}>
            <line x1={X(p.x0)} y1={Y(p.z0)} x2={X(p.x1)} y2={Y(p.z1)} className="r" />
            <line x1={X(p.x0)} y1={Y(p.z0)} x2={X(p.x1)} y2={Y(p.z1)} className="hit" />
            {/* מנעול ליד הקצה שגובהו נשמר בשינוי שיפוע */}
            <text x={X((p.fixed ?? p.start ?? 'x0') === 'x0' ? p.x0 : p.x1)} y={Y((p.fixed ?? p.start ?? 'x0') === 'x0' ? p.z0 : p.z1) + 11} className="t lock">🔒</text>
          </g>
        ))}
        {lines.map((l, i) => (
          <g key={l.id} className={`isec-ax${drag?.id === l.id ? ' on' : ''}`} onPointerDown={onDown(l.id)} data-testid={`isec-ax-${i}`}>
            <line x1={X(l.x)} y1={Y(0)} x2={X(l.x)} y2={Y(topAt(l.x))} className="c" />
            <line x1={X(l.x)} y1={Y(0) + 3} x2={X(l.x)} y2={Y(topAt(l.x)) - 2} className="hit" />
            <circle cx={X(l.x)} cy={Y(0) + 9} r={6} className="bub" /><text x={X(l.x)} y={Y(0) + 12} className="t b">{lineLabel(i)}</text>
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
        {sec.planes.flatMap((p) => (['x0', 'x1'] as const).map((e) => {
          const x = p[e], z = e === 'x0' ? p.z0 : p.z1;
          return (
            <g key={`${p.id}${e}`} className="isec-dim z" onClick={() => openEdit('z', `${p.id}:${e}`, X(x), Y(z) - 10, z)} data-testid={`isec-z-${p.id}-${e}`}>
              <text x={X(x) + (e === 'x0' ? 2 : -2)} y={Y(z) - 5} className={`t ${e === 'x0' ? 'st' : 'en'}`}>{m(z)}</text>
            </g>
          );
        }))}
        {drag && <text x={X(drag.x)} y={padTop - 10} className="t b">{m(drag.x)}</text>}
      </svg>
      {edit && (
        <input className="inp num isec-inp" autoFocus defaultValue={(edit.value / 1000).toFixed(3)} style={{ left: `${edit.at.x}%`, top: `${edit.at.y}%` }} data-testid="isec-input"
          onKeyDown={(e) => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value.replace(',', '.')); if (Number.isFinite(v)) commitEdit(v * 1000); else setEdit(null); } if (e.key === 'Escape') setEdit(null); }}
          onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v) && Math.abs(v * 1000 - edit.value) > 0.5) commitEdit(v * 1000); else setEdit(null); }} />
      )}
      {selPl && (() => {
        const pl = sec.planes.find((q) => q.id === selPl);
        if (!pl) return null;
        const i = sec.planes.indexOf(pl);
        const fixed = pl.fixed ?? pl.start ?? 'x0';
        const slope = ((pl.z1 - pl.z0) / (pl.x1 - pl.x0)) * 100;
        const setP = (patch: Partial<RoofPlaneDef>, label: string) => apply({ ...sec, template: undefined, planes: sec.planes.map((q) => (q.id === pl.id ? { ...q, ...patch } : q)) }, label);
        const setSlope = (pct: number) => apply(setPlaneSlope(sec, pl.id, pct), 'שינוי שיפוע');
        const lockBtn = (e: 'x0' | 'x1') => (
          <button className={`lock-btn${fixed === e ? ' on' : ''}`} data-testid={`pl-lock-${e}`} title={fixed === e ? 'גובה זה נשמר כשמשנים שיפוע' : 'נעילת גובה זה'} onClick={() => setP({ fixed: e }, 'נעילת גובה')}>{fixed === e ? '🔒' : '🔓'}</button>
        );
        return (
          <div className="pl-card" data-testid="pl-card">
            <div className="pl-card-h"><b>מישור גג {i + 1}</b><button className="icon-btn" onClick={() => setSelPl(null)}>✕</button></div>
            <div className="pl-row"><label>שיפוע</label><NumField testId="plc-slope" value={Math.round(slope * 100) / 100} suffix="%" onCommit={setSlope} /></div>
            <div className="pl-row"><label>גובה בצד שמאל</label><LenField testId="plc-z0" mm={pl.z0} unit="m" onCommit={(v) => apply(setPlaneEndZ(sec, pl.id, 'x0', v), 'שינוי גובה')} />{lockBtn('x0')}</div>
            <div className="pl-row"><label>גובה בצד ימין</label><LenField testId="plc-z1" mm={pl.z1} unit="m" onCommit={(v) => apply(setPlaneEndZ(sec, pl.id, 'x1', v), 'שינוי גובה')} />{lockBtn('x1')}</div>
            <div className="hint" style={{ margin: 0 }}>🔒 = הגובה שנשאר קבוע כשמשנים את השיפוע. שינוי גובה ישירות משנה את השיפוע.</div>
          </div>
        );
      })()}
      <div className="hint" style={{ margin: '2px 4px' }}>לחץ על קו גג לשינוי שיפוע וגבהים (עם מנעול) · גרור ציר להזזה (Shift = דיוק 10 מ"מ) · לחץ על מידה כדי להקליד ערך (מטר)</div>
    </div>
  );
}
