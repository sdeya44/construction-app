import { setKneeBraces, setSection } from '../commands/commands';
import { defaultKneeBraces } from '../geometry/knee';
import { lineLabel, SECTION_TEMPLATES, toCustomSection, type CustomSection, type RoofPlaneDef } from '../model/section';
import { store, useStore } from '../store';
import { LenField, NumField, TextField } from './fields';
import { Icon } from './icons';

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
  const toModular = () => apply(toCustomSection(b, d.roof), 'מעבר לחתך מודולרי');
  return (
    <>
      <div className="panel-title">צורת החתך</div>
      <div className="seg" style={{ width: '100%', marginBottom: 6 }}>
        <button className={`tbtn${!sec ? ' on' : ''}`} style={{ flex: 1 }} data-testid="sec-classic" onClick={() => sec && confirm('לחזור לחתך הקלאסי (שני צירים)? הגדרות הצירים והמישורים יימחקו.') && apply(undefined, 'חזרה לחתך קלאסי')}>קלאסי (2 צירים)</button>
        <button className={`tbtn${sec ? ' on' : ''}`} style={{ flex: 1 }} data-testid="sec-modular" onClick={() => !sec && toModular()}>מודולרי</button>
      </div>
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
      {sec && <ModularTables sec={sec} unit={u} apply={apply} />}
      <KneeEditor />
    </>
  );
}

function ModularTables({ sec, unit: u, apply }: { sec: CustomSection; unit: 'm' | 'mm'; apply: (s: CustomSection, label?: string) => void }) {
  const lines = [...sec.lines].sort((a, b) => a.x - b.x);
  const setLine = (id: string, x: number) => apply({ ...sec, template: undefined, lines: sec.lines.map((l) => (l.id === id ? { ...l, x } : l)) });
  const setPlane = (id: string, patch: Partial<RoofPlaneDef>) => apply({ ...sec, template: undefined, planes: sec.planes.map((pl) => (pl.id === id ? { ...pl, ...patch } : pl)) });
  const newId = (pre: string, used: string[]) => { let i = 1; while (used.includes(`${pre}${i}`)) i++; return `${pre}${i}`; };
  const slope = (pl: RoofPlaneDef) => ((pl.z1 - pl.z0) / (pl.x1 - pl.x0)) * 100;
  return (
    <>
      <div className="sec-prev"><SectionPreview section={sec} /></div>
      <div className="panel-title">צירי עמודים ({lines.length})
        <button className="btn small" data-testid="sec-add-line" onClick={() => {
          const last = lines[lines.length - 1];
          apply({ ...sec, lines: [...sec.lines, { id: newId('C', sec.lines.map((l) => l.id)), x: last.x + 6000 }] }, 'הוספת ציר');
        }}><Icon name="plus" />ציר</button>
      </div>
      <table className="tbl" data-testid="sec-lines">
        <thead><tr><th>ציר</th><th>מיקום X</th><th>מפתח</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id}>
              <td><b>{lineLabel(i)}</b></td>
              <td><LenField mm={l.x} unit={u} testId={`sec-x-${i}`} onCommit={(v) => setLine(l.id, v)} /></td>
              <td>{i > 0 ? <LenField mm={l.x - lines[i - 1].x} unit={u} min={500} onCommit={(v) => {
                const delta = v - (l.x - lines[i - 1].x);
                apply({ ...sec, template: undefined, lines: sec.lines.map((q) => (q.x >= l.x ? { ...q, x: q.x + delta } : q)) });
              }} /> : <span className="hint">—</span>}</td>
              <td>{lines.length > 1 && <button className="icon-btn" title="מחיקת ציר" onClick={() => apply({ ...sec, lines: sec.lines.filter((q) => q.id !== l.id) }, 'מחיקת ציר')}><Icon name="x" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
            <div style={{ width: 90 }}><NumField value={+slope(pl).toFixed(3)} suffix="%" onCommit={(v) => setPlane(pl.id, pl.start === 'x1' ? { z0: pl.z1 - (v / 100) * (pl.x1 - pl.x0) } : { z1: pl.z0 + (v / 100) * (pl.x1 - pl.x0) })} /></div>
            <span className="hint" style={{ margin: 0 }}>פטות מתחילות</span>
            <div className="seg">
              <button className={`tbtn${pl.start === 'x0' ? ' on' : ''}`} onClick={() => setPlane(pl.id, { start: 'x0' })}>משמאל</button>
              <button className={`tbtn${pl.start === 'x1' ? ' on' : ''}`} onClick={() => setPlane(pl.id, { start: 'x1' })}>מימין</button>
            </div>
          </div>
        </div>
      ))}
      <div className="hint">גבהים = פני עליון של קורת הגג. מישור שעובר מעל עמוד יושב עליו (ראש עמוד); מישור שמסתיים בעמוד שממשיך למעלה מתחבר לצדו; שני קצוות באותה נקודה ללא עמוד = רכס. שינוי שיפוע שומר על הגובה בקצה ההתחלה של הפטות.</div>
    </>
  );
}

function KneeEditor() {
  const kb = useStore((s) => s.project.building.kneeBraces) ?? defaultKneeBraces();
  const n = useStore((s) => s.derived.connections.filter((c) => c.type === 'knee').length);
  const set = (patch: Parameters<typeof setKneeBraces>[0]) => store.exec(setKneeBraces(patch));
  return (
    <>
      <div className="panel-title">אלכסוני עמוד-קורה
        <label className="badge" style={{ cursor: 'pointer' }}><input type="checkbox" data-testid="kb-on" checked={kb.enabled} onChange={(e) => set({ enabled: e.target.checked })} />פעיל {kb.enabled ? `(${n})` : ''}</label>
      </div>
      {kb.enabled && <>
        <div className="field"><label>חתך</label><TextField ltr list="profiles" testId="kb-profile" value={kb.profile} onCommit={(v) => set({ profile: v.toUpperCase().replace(/\s/g, '') })} /></div>
        <div className="field"><label>ירידה על העמוד</label><NumField testId="kb-drop" value={kb.drop} suffix='מ"מ' onCommit={(v) => set({ drop: v })} /></div>
        <div className="field"><label>מרחק על הקורה (אופקי)</label><NumField testId="kb-reach" value={kb.reach} suffix='מ"מ' onCommit={(v) => set({ reach: v })} /></div>
        <div className="field"><label>פלטת קצה (עובי×רוחב×אורך)</label><span className="readonly">{kb.plateT}×{kb.plateW}×{kb.plateL}</span></div>
        <div className="field"><label>ברגים</label><span className="readonly">4×M{kb.bolt.d} · {kb.gauge}/{kb.pitch}</span></div>
        <div className="hint">בכל מפגש עמוד-קורה, לכל צד שבו הקורה ממשיכה. פלטת קצה מרותכת לאלכסון ומוברגת לאגף העמוד/הקורה (האום בתוך הפרופיל). לפי פרט התוכנית: RHS80/80/4, פלטה 180×280×14, 4×M16. אין בדיקת חוזק.</div>
      </>}
    </>
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
