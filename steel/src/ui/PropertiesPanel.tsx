import { Fragment, useState } from 'react';
import { resetOverrides, setMemberProps } from '../commands/commands';
import { useFab } from '../fab/useFab';
import { fromMm } from '../core/units';
import { dist } from '../core/vec';
import { cutLength } from '../geometry/solid';
import { massPerMeter, tryProfile } from '../profiles/library';
import { getMaterial, MATERIALS } from '../profiles/materials';
import { store, useStore } from '../store';
import { NumField, ProfilePicker } from './fields';
import { KIND_LABEL } from './TreePanel';
import { SpliceEditor } from './SpliceEditor';
import { ConnectionEditor, MemberConnections } from './ConnectionEditor';

const f1 = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export function PropertiesPanel() {
  const active = useStore((s) => s.activeConn);
  if (active) return <ConnectionEditor />;
  return <PropertiesInner />;
}

let lastTab: 'basic' | 'conns' | 'adv' = 'basic';
function PropertiesInner() {
  const [ptab, setPtabS] = useState(lastTab);
  const setPtab = (t: typeof lastTab) => { lastTab = t; setPtabS(t); };
  const fab = useFab().fab;
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
    const ed = ms.filter((x) => x.kind !== 'bolt');
    const ids = ed.map((x) => x.id);
    const profiles = [...new Set(ed.map((m) => m.profile))];
    const mats = [...new Set(ed.map((m) => m.material))];
    const rolls = [...new Set(ed.map((m) => m.rollDeg))];
    const weight = ms.reduce((s, m) => {
      const pr = tryProfile(m.profile);
      return s + (pr ? massPerMeter(pr, getMaterial(m.material).density) * cutLength(m).max / 1000 : 0);
    }, 0);
    const byKind = new Map<string, string[]>();
    for (const m of ms) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m.id]);
    const byMat = new Map<string, string[]>();
    for (const m of ed) byMat.set(m.material, [...(byMat.get(m.material) ?? []), m.id]);
    return (
      <div className="panel-body" data-testid="props-multi">
        <div className="el-head"><div className="k">מאפיינים משותפים</div><div className="t"><b><span data-testid="sel-count">{ms.length}</span> אלמנטים</b></div></div>
        <div className="field prof"><label>חתך</label><ProfilePicker testId="multi-profile" placeholder={profiles.length > 1 ? 'משתנה' : undefined} varies={profiles.length > 1} value={profiles.length === 1 ? profiles[0] : ''} onCommit={(v) => store.exec(setMemberProps(ids, { profile: v }))} /></div>
        <div className="field"><label>חומר</label>
          <select className={`inp${mats.length > 1 ? ' varies' : ''}`} value={mats.length === 1 ? mats[0] : ''} data-testid="multi-material" onChange={(e) => e.target.value && store.exec(setMemberProps(ids, { material: e.target.value }))}>
            {mats.length > 1 && <option value="">משתנה</option>}{MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="field"><label>סיבוב סביב הציר</label><NumField value={rolls.length === 1 ? rolls[0] : NaN} suffix="°" placeholder="משתנה" onCommit={(v) => store.exec(setMemberProps(ids, { rollDeg: v }))} /></div>
        <div className="hint varies-note">שדה "משתנה" אינו משנה דבר עד שמקלידים בו ערך. ערך חדש חל על כל {ed.length} האלמנטים בפקודה אחת — ביטול אחד מחזיר הכול.</div>
        <div className="panel-title">הרכב הבחירה</div>
        <dl className="kv">
          {[...byKind].map(([k, v]) => <Fragment key={k}><dt>{KIND_LABEL[k as keyof typeof KIND_LABEL]}</dt><dd>{v.length} <button className="link-btn" onClick={() => store.select(v)}>בחר רק אותם</button></dd></Fragment>)}
          {byMat.size > 1 && [...byMat].map(([k, v]) => <Fragment key={`m${k}`}><dt>{k}</dt><dd>{v.length} <button className="link-btn" onClick={() => store.select(v)}>בחר רק {k}</button></dd></Fragment>)}
          <dt>חתכים</dt><dd>{profiles.join(', ')}</dd>
          <dt>משקל (גיאומטרי)</dt><dd>{f1(weight)} ק"ג</dd>
        </dl>
        <button className="btn" onClick={() => store.exec(resetOverrides(sel))}>איפוס התאמות ידניות</button>
      </div>
    );
  }

  const m = ms[0];
  const pr = tryProfile(m.profile);
  const mat = getMaterial(m.material);
  const cl = cutLength(m);
  const kgm = pr ? massPerMeter(pr, mat.density) : 0;
  const ov = p.memberOverrides[m.id];
  const stale = d.issues.some((i) => i.code === 'STALE_OVERRIDE' && i.elementId === m.id);
  const frameNo = m.frameId ? p.building.frames.findIndex((f) => f.id === m.frameId) + 1 : 0;
  const conns = d.connections.filter((c) => c.members.includes(m.id) || c.parts.includes(m.id)).length;
  const mark = fab.parts.find((x) => x.memberId === m.id)?.mark;
  return (
    <div className="panel-body" data-testid="props-single">
      <div className="el-head">
        <div className="k">{KIND_LABEL[m.kind]}{frameNo > 0 ? ` · מסגרת ${frameNo}` : ''}{m.side ? ` · ${m.side === 'L' ? 'שמאל' : 'ימין'}` : ''} <span className={`badge ${m.source === 'manual' ? 'warn' : 'blue'}`}>{m.source === 'manual' ? 'ידני' : 'פרמטרי'}</span></div>
        <div className="t"><b>{mark ?? m.label}</b><span className="mono" data-testid="prop-id">{m.id}</span></div>
      </div>
      <div className="ptabs" role="tablist">
        <button role="tab" className={ptab === 'basic' ? 'on' : ''} onClick={() => setPtab('basic')} data-testid="ptab-basic">בסיסי</button>
        <button role="tab" className={ptab === 'conns' ? 'on' : ''} onClick={() => setPtab('conns')} data-testid="ptab-conns">חיבורים{conns ? ` ${conns}` : ''}</button>
        <button role="tab" className={ptab === 'adv' ? 'on' : ''} onClick={() => setPtab('adv')} data-testid="ptab-adv">מתקדם</button>
      </div>
      {ptab === 'basic' && <>
        {pr && (
          <div className="sec-card">
            <SectionShape outline={pr.outline.outer} />
            <div style={{ minWidth: 0 }}>
              <div className="nm">{m.profile}</div>
              <div className="dm">h {f1(pr.props.h)} · b {f1(pr.props.b)}</div>
              {pr.verified ? <span className="badge ok" title={pr.source} data-testid="prof-verified">✓ מאומת מקטלוג</span> : <span className="badge warn" title={pr.source}>לא מאומת</span>}
            </div>
          </div>
        )}
        {m.partDesc && <div className="hint" style={{ marginTop: 0 }}>{m.partDesc}</div>}
        {m.manualPlacement && m.source === 'generated' && (
          <div className={`issue ${stale ? 'warning' : ''}`} style={{ marginTop: 6 }}>
            <span className="ic">!</span>
            <div>{stale ? 'מיקום ידני שאינו תקף עוד לאחר שינוי פרמטרי.' : 'האלמנט הוזז ידנית ואינו עוקב אחר הפרמטרים.'}
              <div><button className="btn small" style={{ marginTop: 4 }} onClick={() => store.exec(resetOverrides([m.id]))}>החזר לפרמטרי</button></div></div>
          </div>
        )}
        <div className="field prof"><label>חתך</label><ProfilePicker testId="prop-profile" value={m.profile} onCommit={(v) => store.exec(setMemberProps([m.id], { profile: v }))} /></div>
        <div className="field"><label>חומר</label>
          <select className="inp" value={m.material} onChange={(e) => store.exec(setMemberProps([m.id], { material: e.target.value }))}>
            {MATERIALS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        {m.purlin ? (
          <div className="field"><label>היפוך חתך (פטה זו)</label>
            <select className="inp" data-testid="prop-flip" value={p.memberOverrides[m.id]?.mirror ? '1' : '0'} onChange={(e) => store.exec(setMemberProps([m.id], { mirror: e.target.value === '1' }))}>
              <option value="0">לפי הגדרת הצד</option><option value="1">הפוך מהגדרת הצד</option>
            </select>
          </div>
        ) : (
          <div className="field"><label>היפוך חתך</label>
            <select className="inp" value={m.mirror ? '1' : '0'} onChange={(e) => store.exec(setMemberProps([m.id], { mirror: e.target.value === '1' }))}>
              <option value="0">רגיל</option><option value="1">הפוך</option>
            </select>
          </div>
        )}
        {ov && (ov.profile || ov.material || ov.rollDeg !== undefined || ov.mirror !== undefined) && m.source === 'generated' && (
          <div className="row"><span className="badge warn">ערכים ששונו ידנית</span><button className="btn small" onClick={() => store.exec(resetOverrides([m.id]))}>איפוס</button></div>
        )}
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>אורך קו ייחוס</dt><dd data-testid="prop-len">{L(dist(m.start, m.end))}</dd>
          <dt>אורך חיתוך מרבי</dt><dd>{L(cl.max)}</dd>
          <dt>משקל</dt><dd data-testid="prop-weight">{f1((kgm * cl.max) / 1000)} ק"ג</dd>
          <dt>סימון חלק</dt><dd>{mark ?? '—'}</dd>
        </dl>
        {m.purlin && <PurlinInfoBlock id={m.id} />}
        <div className="hint">שינוי חל מיד · Ctrl+Z לביטול</div>
      </>}
      {ptab === 'conns' && <>
        <MemberConnections memberId={m.id} />
        {!conns && <div className="hint">אין חיבורים לאלמנט זה.</div>}
        {m.kind !== 'bolt' && <SpliceEditor m={m} />}
      </>}
      {ptab === 'adv' && <>
        <div className="field"><label>סיבוב סביב הציר</label><NumField value={m.rollDeg} suffix="°" onCommit={(v) => store.exec(setMemberProps([m.id], { rollDeg: v }))} /></div>
        <div className="panel-title">גיאומטריה</div>
        <dl className="kv">
          <dt>תיאור</dt><dd style={{ direction: 'rtl', textAlign: 'right', fontFamily: 'var(--font)' }}>{m.label}</dd>
          <dt>אורך חיתוך מזערי</dt><dd>{L(cl.min)}</dd>
          <dt>התחלה (X,Y,Z)</dt><dd>{[m.start.x, m.start.y, m.start.z].map((v) => v.toFixed(1)).join(', ')}</dd>
          <dt>סוף (X,Y,Z)</dt><dd>{[m.end.x, m.end.y, m.end.z].map((v) => v.toFixed(1)).join(', ')}</dd>
          <dt>חיתוך התחלה</dt><dd>{m.startCut ? 'מישורי' : 'ניצב'}</dd>
          <dt>חיתוך סוף</dt><dd>{m.endCut ? 'מישורי' : 'ניצב'}</dd>
        </dl>
        {pr && <>
          <div className="panel-title">תכונות חתך {pr.verified ? <span className="badge ok" title={pr.source} data-testid="prof-verified">מאומת</span> : <span className="badge warn" title={pr.source}>לא מאומת</span>}</div>
          <dl className="kv">
            <dt>h × b</dt><dd>{f1(pr.props.h)} × {f1(pr.props.b)} מ"מ</dd>
            <dt>A</dt><dd>{f1(pr.props.area / 100, 2)} ס"מ²</dd>
            <dt>משקל למטר</dt><dd data-testid="prop-kgm">{f1(kgm, 2)} ק"ג/מ'</dd>
            <dt>Iy</dt><dd>{f1(pr.props.Iy / 1e4)} ס"מ⁴</dd>
            <dt>Iz</dt><dd>{f1(pr.props.Iz / 1e4)} ס"מ⁴</dd>
            <dt>Wy / Wz</dt><dd>{f1(pr.props.Wy / 1e3)} / {f1(pr.props.Wz / 1e3)} ס"מ³</dd>
            <dt>iy / iz</dt><dd>{f1(pr.props.iy / 10, 2)} / {f1(pr.props.iz / 10, 2)} ס"מ</dd>
          </dl>
          <div className="hint">{pr.verified ? `מקור: ${pr.source}.` : `מחושב מגיאומטריית החתך. ${pr.note ?? ''} אסור לשימוש בחישובי חוזק עד ייבוא קטלוג מאומת.`}</div>
        </>}
      </>}
    </div>
  );
}

/** שרטוט חתך מוקטן מקו המתאר של הפרופיל. */
function SectionShape({ outline }: { outline: { u: number; v: number }[] }) {
  const us = outline.map((q) => q.u), vs = outline.map((q) => q.v);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const w = u1 - u0 || 1, h = v1 - v0 || 1, k = Math.min(36 / w, 50 / h);
  const pts = outline.map((q) => `${(20 + (q.u - (u0 + u1) / 2) * k).toFixed(2)},${(27 - (q.v - (v0 + v1) / 2) * k).toFixed(2)}`).join(' ');
  return <svg viewBox="0 0 40 54" role="img" aria-label="חתך"><polygon points={pts} fill="#1f5a3f" /></svg>;
}

function ModelSummary() {
  const d = useStore((s) => s.derived);
  const counts = new Map<string, { n: number; len: number; kg: number }>();
  for (const x of d.parts) {
    const pr = tryProfile(x.profile);
    if (!pr) continue;
    const e = counts.get(x.profile) ?? { n: 0, len: 0, kg: 0 };
    e.n++; e.len += x.length; e.kg += (massPerMeter(pr, getMaterial(x.material).density) * x.length) / 1000;
    counts.set(x.profile, e);
  }
  const tot = [...counts.values()].reduce((s, e) => s + e.kg, 0);
  return (
    <>
      <table className="tbl" data-testid="summary">
        <thead><tr><th>חתך</th><th>חלקים</th><th>אורך (מ')</th><th>ק"ג</th></tr></thead>
        <tbody>
          {[...counts.entries()].map(([k, e]) => (
            <tr key={k}><td style={{ direction: 'ltr', textAlign: 'right' }}>{k}</td><td>{e.n}</td><td>{f1(e.len / 1000, 2)}</td><td>{f1(e.kg, 0)}</td></tr>
          ))}
          <tr><td><b>סה"כ</b></td><td /><td /><td><b>{f1(tot, 0)}</b></td></tr>
        </tbody>
      </table>
      <dl className="kv"><dt>נקודות תמיכה לפטות</dt><dd>{d.supports.length}</dd><dt>חיבורי המשך</dt><dd>{d.splices.length} ({d.splices.filter((x) => x.status === 'bolted').length} מוברגים)</dd></dl>
      <div className="hint">משקל גיאומטרי מחתכים לא מאומתים. רשימת חיתוך ו-BOM מלאים — במצב "ייצור".</div>
    </>
  );
}

function PurlinInfoBlock({ id }: { id: string }) {
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const m = d.byId.get(id)!;
  const pi = m.purlin!;
  const u = p.displayUnit;
  const L = (mm: number) => (u === 'm' ? `${fromMm(mm, 'm').toFixed(3)} מ'` : `${mm.toFixed(1)} מ"מ`);
  const sup = d.supports.filter((s) => s.purlinId === id);
  const b = p.building;
  const sideName = { L: 'שמאל', R: 'ימין', M: 'גג חד־שיפועי' }[pi.side];
  return (
    <>
      <div className="panel-title">מיקום הפטה</div>
      <dl className="kv" data-testid="purlin-info">
        <dt>צד גג</dt><dd style={{ direction: 'rtl', textAlign: 'right', fontFamily: 'var(--font)' }}>{sideName}</dd>
        <dt>מספר בצד</dt><dd>{pi.index} / {pi.count}</dd>
        <dt>{pi.side === 'M' ? 'מרחק מקצה ההתחלה' : 'מרחק מהרכס'} (שיפוע)</dt><dd data-testid="purlin-s">{L(pi.sSlope)}</dd>
        <dt>מרחק בהיטל אופקי</dt><dd>{L(pi.sHoriz)}</dd>
        <dt>מרווח מהקודמת</dt><dd>{pi.index > 1 ? L(pi.spanBefore) : '—'}{pi.isLast && pi.index > 1 ? ' (אחרונה)' : ''}</dd>
        <dt>פתיחת החתך</dt><dd style={{ direction: 'rtl', textAlign: 'right', fontFamily: 'var(--font)' }}>{pi.opening === 'up' ? 'לכיוון הרכס / הצד הגבוה' : 'לכיוון המרזב'}</dd>
        <dt>אורך קו</dt><dd>{L(dist(m.start, m.end))}</dd>
        <dt>קונזולות (Y)</dt><dd>{L(b.purlinOverhangStart)} / {L(b.purlinOverhangEnd)}</dd>
        <dt>נקודות תמיכה</dt><dd data-testid="purlin-supports">{sup.length}</dd>
      </dl>
      <div className="hint">מגע עם האגף העליון של קורת הגג: 0 מ"מ. גובה החתך ניצב למישור הגג. מגע גיאומטרי אינו אישור ביצוע.</div>
    </>
  );
}
