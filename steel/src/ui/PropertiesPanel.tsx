import { resetOverrides, setMemberProps } from '../commands/commands';
import { fromMm, kgPerMeter } from '../core/units';
import { dist } from '../core/vec';
import { cutLength } from '../geometry/solid';
import { tryProfile } from '../profiles/library';
import { getMaterial, MATERIALS } from '../profiles/materials';
import { store, useStore } from '../store';
import { NumField, TextField } from './fields';
import { KIND_LABEL } from './TreePanel';

const f1 = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export function PropertiesPanel() {
  const sel = useStore((s) => s.selection);
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const u = p.displayUnit;
  const L = (mm: number) => (u === 'm' ? `${fromMm(mm, 'm').toFixed(3)} מ'` : `${mm.toFixed(1)} מ"מ`);
  const ms = sel.map((id) => d.byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m);

  if (!ms.length) {
    return (
      <div className="panel-body" data-testid="props-empty">
        <div className="panel-title">מאפיינים</div>
        <div className="hint">לא נבחר אלמנט. לחיצה על אלמנט בתצוגה בוחרת אותו; לחיצה חוזרת באותה נקודה בוחרת את האלמנט שמאחוריו. Ctrl מוסיף/מסיר מהבחירה.</div>
        <div className="panel-title">סיכום מודל</div>
        <ModelSummary />
      </div>
    );
  }

  if (ms.length > 1) {
    const profiles = [...new Set(ms.map((m) => m.profile))];
    const weight = ms.reduce((s, m) => {
      const pr = tryProfile(m.profile);
      return s + (pr ? kgPerMeter(pr.props.area, getMaterial(m.material).density) * cutLength(m).max / 1000 : 0);
    }, 0);
    return (
      <div className="panel-body" data-testid="props-multi">
        <div className="panel-title">בחירה מרובה</div>
        <dl className="kv"><dt>אלמנטים</dt><dd data-testid="sel-count">{ms.length}</dd><dt>חתכים</dt><dd>{profiles.join(', ')}</dd><dt>משקל (גיאומטרי)</dt><dd>{f1(weight)} ק"ג</dd></dl>
        <div className="panel-title">עריכה משותפת</div>
        <div className="field"><label>חתך</label><TextField ltr list="profiles" value={profiles.length === 1 ? profiles[0] : ''} onCommit={(v) => store.exec(setMemberProps(sel, { profile: v.toUpperCase().replace(/\s/g, '') }))} /></div>
        <div className="field"><label>חומר</label>
          <select className="inp" value="" onChange={(e) => e.target.value && store.exec(setMemberProps(sel, { material: e.target.value }))}>
            <option value="">—</option>{MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <button className="btn" onClick={() => store.exec(resetOverrides(sel))}>איפוס התאמות ידניות</button>
      </div>
    );
  }

  const m = ms[0];
  const pr = tryProfile(m.profile);
  const mat = getMaterial(m.material);
  const cl = cutLength(m);
  const kgm = pr ? kgPerMeter(pr.props.area, mat.density) : 0;
  const ov = p.memberOverrides[m.id];
  const stale = d.issues.some((i) => i.code === 'STALE_OVERRIDE' && i.elementId === m.id);
  const frameNo = m.frameId ? p.building.frames.findIndex((f) => f.id === m.frameId) + 1 : 0;
  return (
    <div className="panel-body" data-testid="props-single">
      <div className="panel-title">{KIND_LABEL[m.kind]} <span className={`badge ${m.source === 'manual' ? 'warn' : 'blue'}`}>{m.source === 'manual' ? 'ידני' : 'פרמטרי'}</span></div>
      <dl className="kv">
        <dt>מזהה אלמנט</dt><dd data-testid="prop-id">{m.id}</dd>
        <dt>תיאור</dt><dd style={{ direction: 'rtl', textAlign: 'right', fontFamily: 'var(--font)' }}>{m.label}</dd>
        {frameNo > 0 && <><dt>מסגרת</dt><dd>{frameNo} ({m.frameId})</dd></>}
        <dt>סימון חלק</dt><dd style={{ direction: 'rtl', textAlign: 'right' }}><span className="badge">טרם הוקצה (שלב M5)</span></dd>
      </dl>
      {m.manualPlacement && m.source === 'generated' && (
        <div className={`issue ${stale ? 'warning' : ''}`} style={{ marginTop: 6 }}>
          <span className="ic">!</span>
          <div>{stale ? 'מיקום ידני שאינו תקף עוד לאחר שינוי פרמטרי.' : 'האלמנט הוזז ידנית ואינו עוקב אחר הפרמטרים.'}
            <div><button className="btn small" style={{ marginTop: 4 }} onClick={() => store.exec(resetOverrides([m.id]))}>החזר לפרמטרי</button></div></div>
        </div>
      )}
      <div className="panel-title">חתך וחומר</div>
      <div className="field"><label>חתך</label><TextField ltr list="profiles" testId="prop-profile" value={m.profile} onCommit={(v) => store.exec(setMemberProps([m.id], { profile: v.toUpperCase().replace(/\s/g, '') }))} /></div>
      <div className="field"><label>חומר</label>
        <select className="inp" value={m.material} onChange={(e) => store.exec(setMemberProps([m.id], { material: e.target.value }))}>
          {MATERIALS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <div className="field"><label>סיבוב סביב הציר</label><NumField value={m.rollDeg} suffix="°" onCommit={(v) => store.exec(setMemberProps([m.id], { rollDeg: v }))} /></div>
      <div className="field"><label>היפוך חתך</label>
        <select className="inp" value={m.mirror ? '1' : '0'} onChange={(e) => store.exec(setMemberProps([m.id], { mirror: e.target.value === '1' }))}>
          <option value="0">רגיל</option><option value="1">הפוך</option>
        </select>
      </div>
      {ov && (ov.profile || ov.material || ov.rollDeg !== undefined || ov.mirror !== undefined) && m.source === 'generated' && (
        <div className="row"><span className="badge warn">ערכים ששונו ידנית</span><button className="btn small" onClick={() => store.exec(resetOverrides([m.id]))}>איפוס</button></div>
      )}
      <div className="panel-title">גיאומטריה</div>
      <dl className="kv">
        <dt>אורך קו ייחוס</dt><dd data-testid="prop-len">{L(dist(m.start, m.end))}</dd>
        <dt>אורך חיתוך מרבי</dt><dd>{L(cl.max)}</dd>
        <dt>אורך חיתוך מזערי</dt><dd>{L(cl.min)}</dd>
        <dt>התחלה (X,Y,Z)</dt><dd>{[m.start.x, m.start.y, m.start.z].map((v) => v.toFixed(1)).join(', ')}</dd>
        <dt>סוף (X,Y,Z)</dt><dd>{[m.end.x, m.end.y, m.end.z].map((v) => v.toFixed(1)).join(', ')}</dd>
        <dt>חיתוך התחלה</dt><dd>{m.startCut ? 'מישורי' : 'ניצב'}</dd>
        <dt>חיתוך סוף</dt><dd>{m.endCut ? 'מישורי' : 'ניצב'}</dd>
        <dt>משקל</dt><dd data-testid="prop-weight">{f1((kgm * cl.max) / 1000)} ק"ג</dd>
      </dl>
      {pr && <>
        <div className="panel-title">תכונות חתך <span className="badge warn" title={pr.source}>לא מאומת</span></div>
        <dl className="kv">
          <dt>h × b</dt><dd>{f1(pr.props.h)} × {f1(pr.props.b)} מ"מ</dd>
          <dt>A</dt><dd>{f1(pr.props.area / 100, 2)} ס"מ²</dd>
          <dt>משקל למטר</dt><dd data-testid="prop-kgm">{f1(kgm, 2)} ק"ג/מ'</dd>
          <dt>Iy</dt><dd>{f1(pr.props.Iy / 1e4)} ס"מ⁴</dd>
          <dt>Iz</dt><dd>{f1(pr.props.Iz / 1e4)} ס"מ⁴</dd>
          <dt>Wy / Wz</dt><dd>{f1(pr.props.Wy / 1e3)} / {f1(pr.props.Wz / 1e3)} ס"מ³</dd>
          <dt>iy / iz</dt><dd>{f1(pr.props.iy / 10, 2)} / {f1(pr.props.iz / 10, 2)} ס"מ</dd>
        </dl>
        <div className="hint">מחושב מגיאומטריית החתך. {pr.note ?? ''} אסור לשימוש בחישובי חוזק עד ייבוא קטלוג מאומת.</div>
      </>}
    </div>
  );
}

function ModelSummary() {
  const d = useStore((s) => s.derived);
  const counts = new Map<string, { n: number; len: number; kg: number }>();
  for (const m of d.members) {
    const pr = tryProfile(m.profile);
    if (!pr) continue;
    const l = cutLength(m).max;
    const e = counts.get(m.profile) ?? { n: 0, len: 0, kg: 0 };
    e.n++; e.len += l; e.kg += (kgPerMeter(pr.props.area, getMaterial(m.material).density) * l) / 1000;
    counts.set(m.profile, e);
  }
  const tot = [...counts.values()].reduce((s, e) => s + e.kg, 0);
  return (
    <table className="tbl" data-testid="summary">
      <thead><tr><th>חתך</th><th>יח'</th><th>אורך (מ')</th><th>ק"ג</th></tr></thead>
      <tbody>
        {[...counts.entries()].map(([k, e]) => (
          <tr key={k}><td style={{ direction: 'ltr', textAlign: 'right' }}>{k}</td><td>{e.n}</td><td>{f1(e.len / 1000, 2)}</td><td>{f1(e.kg, 0)}</td></tr>
        ))}
        <tr><td><b>סה"כ</b></td><td /><td /><td><b>{f1(tot, 0)}</b></td></tr>
      </tbody>
    </table>
  );
}
