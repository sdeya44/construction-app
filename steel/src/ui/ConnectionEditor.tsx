import { useState } from 'react';
import {
  applyIssueFixes, applyTemplate, resetCleat, resetConnection, saveTemplate, setCleat, setCleatAll, setConnection, setConnectionDefault,
} from '../commands/commands';
import { effCleat } from '../geometry/connections';
import type { Vec3 } from '../core/vec';
import type { ApprovalStatus, CleatParams, Connection, PlateConnParams, ValidationIssue } from '../model/types';
import { store, useStore } from '../store';
import { cachedSolid } from '../view/scene';
import { LenField, NumField } from './fields';
import { Icon } from './icons';

const STATUS: Record<ApprovalStatus, string> = { 'not-verified': 'לא מאומת', 'for-review': 'לבדיקה', approved: 'מאושר' };
export const CONN_TYPE: Record<Connection['type'], string> = { eave: 'עמוד-קורה (שתי פלטות מוברגות)', ridge: 'רכס (פלטות קצה)', base: 'פלטת בסיס', 'purlin-cleat': 'פטה-קורה (זוויתן L)', brace: 'קושרות', 'brace-end': 'פח חיבור קושרת', 'brace-cross': 'הצטלבות קושרות', 'purlin-splice': 'חיבור המשך פטה', 'rafter-side': 'קורה לצד עמוד (פלטת קצה)', knee: 'אלכסון עמוד-קורה', 'ridge-tie': 'פרופיל חיזוק אופקי ברכס', 'beam-splice': 'חיבור המשך קורה (פלטות קצה)', 'tb-support': 'קורה נושאת ↔ עמוד', 'tb-seat': 'קורת גג על קורה נושאת' };
const BOLT_D = [10, 12, 16, 20, 24];

/** רשימת החיבורים של אלמנט + כפתור פתיחת עורך. */
export function MemberConnections({ memberId }: { memberId: string }) {
  const d = useStore((s) => s.derived);
  const m = d.byId.get(memberId);
  const conns = d.connections.filter((c) => c.members.includes(memberId) || c.parts.includes(memberId) || (m?.connId === c.id));
  if (!conns.length) return null;
  const shown = conns.slice(0, 12);
  return (
    <>
      <div className="panel-title">חיבורים <span className="badge">{conns.length}</span></div>
      {shown.map((c) => (
        <div key={c.id} className="row" style={{ marginBottom: 4 }}>
          <button className="btn small" style={{ flex: 1, justifyContent: 'space-between' }} data-testid={`open-conn-${c.id}`} onClick={() => store.set({ activeConn: c.id })}>
            <span>{CONN_TYPE[c.type]}</span><span className={`badge ${c.status === 'approved' ? 'ok' : 'warn'}`}>{STATUS[c.status]}</span>
          </button>
        </div>
      ))}
      {conns.length > shown.length && <div className="hint">ועוד {conns.length - shown.length} חיבורים (בחר תומך כדי לפתוח את החיבור שלו).</div>}
    </>
  );
}

/** עורך חיבורים: פרמטרים, ברגים, ריתוכים, חתך, סטטוס ותבניות. השינויים נשמרים לחיבור הבודד. */
export function ConnectionEditor() {
  const id = useStore((s) => s.activeConn);
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  const [tplName, setTplName] = useState('');
  if (!id) return null;
  const c = d.connById.get(id);
  if (!c) return (
    <div className="panel-body"><div className="hint">החיבור {id} אינו קיים במודל הנוכחי.</div><button className="btn" onClick={() => store.set({ activeConn: null })}>סגירה</button></div>
  );
  const issues = d.issues.filter((i) => i.elementId === id || c.parts.includes(i.elementId ?? '') || (i.code === 'CLASH' && c.parts.some((x) => i.message.includes(x))));
  const isCleat = c.type === 'purlin-cleat';
  const cleatId = isCleat ? c.parts[0] : '';
  const side = isCleat ? (d.byId.get(c.members[0])?.purlin?.paramKey ?? (d.byId.get(c.members[0])?.purlin?.side === 'R' ? 'right' : 'left')) : 'left';
  const plateType = c.type === 'eave' || c.type === 'ridge' || c.type === 'base' ? c.type : null;
  const eff: PlateConnParams | null = plateType ? { ...p.connectionDefaults[plateType], ...(p.connectionOverrides[id] ?? {}), bolt: { ...p.connectionDefaults[plateType].bolt, ...(p.connectionOverrides[id]?.bolt ?? {}) } } as PlateConnParams : null;
  const cl: CleatParams | null = isCleat ? effCleat(p, side, cleatId) : null;
  const setP = (patch: Partial<PlateConnParams>) => store.exec(setConnection(id, patch));
  const setC = (patch: Partial<CleatParams>) => store.exec(setCleat(side, patch, cleatId));
  const sameType = d.connections.filter((x) => x.type === c.type).map((x) => x.id);

  return (
    <div className="panel-body" data-testid="conn-editor">
      <div className="panel-title">עורך חיבור
        <button className="icon-btn" title="סגירת העורך" onClick={() => store.set({ activeConn: null })}><Icon name="x" /></button>
      </div>
      <dl className="kv">
        <dt>סוג</dt><dd style={{ direction: 'rtl', textAlign: 'right', fontFamily: 'var(--font)' }} data-testid="conn-type">{CONN_TYPE[c.type]}</dd>
        <dt>מזהה</dt><dd data-testid="conn-id">{c.id}</dd>
        <dt>מחבר</dt><dd>{c.members.join(' ↔ ')}</dd>
      </dl>
      <div className="row" style={{ margin: '6px 0' }}>
        <button className="btn small" data-testid="conn-show3d" onClick={() => {
          store.set({ isolated: [...c.members, ...c.parts.flatMap((x) => [x, `${x}.H`, `${x}.S`, `${x}.N`])], selection: [c.parts[0]] });
          // תומך פטה: מבט מצד הזוויתן ומעט מלמעלה, כך שהפטה אינה מסתירה אותו
          const dir = viewDirFor(c);
          setTimeout(() => (dir ? window.__ksp?.viewport?.fitSelectionFrom(dir) : window.__ksp?.viewport?.fitSelection()), 30);
        }}><Icon name="isolate" />הצג בתלת־ממד</button>
        {store.state.isolated && <button className="btn small" onClick={() => store.set({ isolated: null })}>הצג הכל</button>}
      </div>
      <SectionSvg c={c} />
      <div className="field"><label>סטטוס</label>
        <select className="inp" data-testid="conn-status" value={c.status} onChange={(e) => {
          const st = e.target.value as ApprovalStatus;
          if (st === 'approved' && !confirm('סימון "מאושר" הוא החלטה הנדסית של המשתמש. התוכנה לא ביצעה בדיקת חוזק. להמשיך?')) return;
          store.exec(setConnection(id, { status: st }));
        }}>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {!isCleat && (
        <div className="field"><label>קביעות (מאפיין מבני)</label>
          <select className="inp" value={c.fixity} onChange={(e) => store.exec(setConnection(id, { fixity: e.target.value as Connection['fixity'] }))}>
            <option value="rigid">קשיח</option><option value="semi">חצי-קשיח</option><option value="pinned">פרקי</option>
          </select>
        </div>
      )}

      {c.type === 'eave' && eff?.split !== false && <div className="hint">שתי הפלטות מרותכות במסגריה (לעמוד ולתחתית הקורה) ומוברגות זו לזו בשטח. הברגים בפינות: מחוץ לרוחב אגף הקורה ומחוץ להיטל העמוד, לגישת מפתח.</div>}
      {c.type === 'brace' && <div className="issue warning"><span className="ic">!</span>{c.label}. החלקים: {c.parts.join(', ')}.</div>}
      {eff && c.type === 'base' && (
        <div className="field"><label>סוג פרט</label>
          <select className="inp" data-testid="cp-mode" value={eff.mode ?? 'embedded'} onChange={(e) => setP({ mode: e.target.value as 'embedded' | 'bolted' })}>
            <option value="embedded">פלטה מבוטנת, ריתוך עמוד בשטח</option><option value="bolted">פלטה מרותכת לעמוד, ברגי עיגון</option>
          </select>
        </div>
      )}
      {eff && c.type === 'eave' && eff.split !== false && <button className="btn small" data-testid="eave-check-open" onClick={() => store.set({ eaveCheck: id })}>בדיקת פלטה והצעת מידות</button>}
      {eff && c.type === 'eave' && (
        <div className="field"><label>סוג פרט</label>
          <select className="inp" data-testid="cp-split" value={eff.split === false ? '0' : '1'} onChange={(e) => setP({ split: e.target.value === '1' })}>
            <option value="1">פלטה על העמוד + פלטה על הקורה</option><option value="0">פלטה אחת, ברגים דרך אגף הקורה</option>
          </select>
        </div>
      )}
      {eff && <>
        <div className="panel-title">{c.type === 'eave' && eff.split !== false ? 'פלטות (עמוד וקורה — אותן מידות)' : 'פלטה'}</div>
        <div className="field"><label>עובי</label><LenField testId="cp-t" mm={eff.t} unit="mm" onCommit={(v) => setP({ t: v })} /></div>
        <div className="field"><label>רוחב</label><LenField testId="cp-w" mm={eff.w} unit="mm" onCommit={(v) => setP({ w: v })} /></div>
        <div className="field"><label>{c.type === 'ridge' ? 'הארכה מתחת לקורה' : 'אורך'}</label><LenField testId="cp-l" mm={eff.l} unit="mm" onCommit={(v) => setP({ l: v })} /></div>
        <div className="panel-title">{c.type === 'base' && (eff.mode ?? 'embedded') === 'embedded' ? 'מוטות עיגון (בהיקף הרשת)' : 'ברגים'}</div>
        <div className="field"><label>קוטר</label>
          <select className="inp" data-testid="cp-d" value={eff.bolt.d} onChange={(e) => setP({ bolt: { ...eff.bolt, d: Number(e.target.value) } })}>
            {BOLT_D.map((x) => <option key={x} value={x}>M{x}</option>)}
          </select>
        </div>
        <div className="field"><label>דרגה</label>
          <select className="inp" value={eff.bolt.grade} onChange={(e) => setP({ bolt: { ...eff.bolt, grade: e.target.value } })}>
            {['4.6', '5.6', '8.8', '10.9'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="field"><label>עמודות × שורות</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}><NumField testId="cp-cols" value={eff.cols} onCommit={(v) => setP({ cols: Math.round(v) })} /><NumField testId="cp-rows" value={eff.rows} onCommit={(v) => setP({ rows: Math.round(v) })} /></div>
        </div>
        <div className="field"><label>מרחק בין עמודות</label><LenField mm={eff.gauge} unit="mm" onCommit={(v) => setP({ gauge: v })} /></div>
        {c.type !== 'ridge' && <div className="field"><label>מרחק בין שורות</label><LenField testId="cp-pitch" mm={eff.pitch} unit="mm" onCommit={(v) => setP({ pitch: v })} /></div>}
        {c.type === 'base' && <div className="field"><label>עיגון מתחת לפלטה</label><LenField mm={eff.anchorLength ?? 500} unit="mm" onCommit={(v) => setP({ anchorLength: v })} /></div>}
        <div className="field"><label>חור (תוספת לקוטר)</label><LenField mm={eff.bolt.clearance} unit="mm" onCommit={(v) => setP({ bolt: { ...eff.bolt, clearance: v } })} /></div>
        <div className="field"><label>ריתוך פינתי a</label><LenField mm={eff.weldSize} unit="mm" onCommit={(v) => setP({ weldSize: v })} /></div>
      </>}

      {cl && <>
        <div className="panel-title">זוויתן</div>
        <CleatFace cl={cl} H={Math.round(heightOf(cleatId))} issues={d.issues.filter((i) => i.elementId === cleatId)} />
        <div className="field"><label>גובה (ריק = אוטומטי)</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <LenField testId="cl-h" mm={cl.height ?? (d.byId.get(cleatId) ? Math.round(heightOf(cleatId)) : 0)} unit="mm" onCommit={(v) => setC({ height: v })} />
            {cl.height !== null && <button className="btn small" title="חזרה לגובה הפטה" onClick={() => setC({ height: null })}>אוטו׳</button>}
          </div>
        </div>
        <div className="field"><label>רגל בסיס</label><LenField testId="cl-base" mm={cl.base} unit="mm" onCommit={(v) => setC({ base: v })} /></div>
        <div className="field"><label>עובי</label><LenField testId="cl-t" mm={cl.thickness} unit="mm" onCommit={(v) => setC({ thickness: v })} /></div>
        <div className="field"><label>רוחב (לאורך הפטה)</label><LenField mm={cl.width} unit="mm" onCommit={(v) => setC({ width: v })} /></div>
        <div className="panel-title">ברגים</div>
        <div className="field"><label>קוטר</label>
          <select className="inp" data-testid="cl-d" value={cl.bolt.d} onChange={(e) => setC({ bolt: { ...cl.bolt, d: Number(e.target.value) } })}>
            {BOLT_D.map((x) => <option key={x} value={x}>M{x}</option>)}
          </select>
        </div>
        <div className="field"><label>שורות × ברגים בשורה</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}><NumField value={cl.rows} onCommit={(v) => setC({ rows: Math.round(v) })} /><NumField testId="cl-perRow" value={cl.perRow} onCommit={(v) => setC({ perRow: Math.round(v) })} /></div>
        </div>
        <div className="field"><label>מרווח בשורה</label><LenField mm={cl.pitch} unit="mm" onCommit={(v) => setC({ pitch: v })} /></div>
        <div className="field"><label>מרווח בין שורות</label><LenField mm={cl.rowPitch} unit="mm" onCommit={(v) => setC({ rowPitch: v })} /></div>
        <div className="field"><label>גובה חורים (ריק = אמצע)</label><LenField mm={cl.holeHeight ?? 0} unit="mm" onCommit={(v) => setC({ holeHeight: v > 0 ? v : null })} /></div>
        <div className="field"><label>ריתוך לקורה a</label><LenField mm={cl.weldSize} unit="mm" onCommit={(v) => setC({ weldSize: v })} /></div>
        <div className="hint">השינויים כאן חלים על תומך זה בלבד.</div>
        <div className="row">
          <button className="btn primary small" data-testid="cl-apply-all" onClick={() => confirm('להחיל את מידות התומך הזה על כל תומכי הפטות בכל השיפועים? התאמות בודדות יבוטלו.') && store.exec(setCleatAll(cl))}>החל על כל התומכים ({d.connections.filter((x) => x.type === 'purlin-cleat').length})</button>
        </div>
      </>}

      <div className="panel-title">ברגים ({c.bolts.length})</div>
      <table className="tbl" data-testid="conn-bolts">
        <thead><tr><th>בורג</th><th>חור</th><th>אחיזה</th><th>מקום</th></tr></thead>
        <tbody>{aggregate(c).map((r) => (
          <tr key={r.k}><td style={{ direction: 'ltr', textAlign: 'right' }}>{r.n}× M{r.d}×{r.len} {r.grade}</td><td>Ø{r.hole}</td><td>{r.grip}</td><td>{r.loc === 'site' ? 'שטח' : 'מסגריה'}</td></tr>
        ))}</tbody>
      </table>
      <div className="panel-title">ריתוכים</div>
      <table className="tbl">
        <thead><tr><th>סוג</th><th>a</th><th>אורך</th><th>מקום</th></tr></thead>
        <tbody>{c.welds.map((w) => (
          <tr key={w.id}><td>פינתי</td><td>{w.a}</td><td>{Math.round(w.length)}</td><td><span className={`badge ${w.location === 'shop' ? 'ok' : 'err'}`}>{w.location === 'shop' ? 'מסגריה' : 'שטח'}</span></td></tr>
        ))}</tbody>
      </table>
      <div className="hint">עיקרון: ריתוך במסגריה, גלוון, הרכבה בשטח בברגים בלבד.</div>

      <div className="panel-title">בדיקות ({issues.length})</div>
      {issues.length ? issues.map((i, k) => <div key={k} className={`issue ${i.severity}`}><span className="ic">{i.severity === 'error' ? '✕' : '!'}</span>{i.message}</div>)
        : <div className="hint" data-testid="conn-no-issues">לא נמצאו התנגשויות או חריגות מרחקי קצה. זו בדיקה גיאומטרית בלבד — אין בדיקת חוזק.</div>}

      <div className="panel-title">ניהול</div>
      <div className="row">
        <button className="btn small" disabled={!c.overridden} onClick={() => store.exec(isCleat ? resetCleat(cleatId) : resetConnection(id))}>איפוס לברירת מחדל</button>
        {eff && plateType && <button className="btn small" data-testid="conn-apply-default" onClick={() => {
          if (confirm(`להפוך את ערכי חיבור זה לברירת המחדל לכל חיבורי "${CONN_TYPE[c.type]}" שלא שונו ידנית?`)) store.exec(setConnectionDefault(plateType, (({ enabled: _e, ...r }) => r)(eff)));
        }}>קבע כברירת מחדל</button>}
      </div>
      {eff && plateType && <>
        <div className="panel-title">ספריית תבניות</div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="inp" placeholder="שם תבנית" value={tplName} onChange={(e) => setTplName(e.target.value)} data-testid="tpl-name" />
          <button className="btn small" data-testid="tpl-save" onClick={() => { if (store.exec(saveTemplate(tplName, id, eff))) setTplName(''); }}>שמירה</button>
        </div>
        {p.connectionTemplates.filter((t) => t.type === plateType).map((t) => (
          <div className="row" key={t.id} style={{ marginTop: 4 }}>
            <span style={{ flex: 1 }}>{t.name}</span>
            <button className="btn small" onClick={() => store.exec(applyTemplate(t.id, [id]))}>החל כאן</button>
            <button className="btn small" onClick={() => { if (confirm(`להחיל את "${t.name}" על ${sameType.length} חיבורים?`)) store.exec(applyTemplate(t.id, sameType)); }}>על כולם</button>
          </div>
        ))}
      </>}
    </div>
  );
}

function viewDirFor(c: Connection): Vec3 | null {
  if (c.type !== 'purlin-cleat') return null;
  const d = store.state.derived;
  const cl = d.byId.get(c.parts[0]), pu = d.byId.get(c.members[0]);
  if (!cl || !pu) return null;
  const s = cachedSolid(cl);
  const all = [...s.startRing, ...s.endRing];
  const cx = all.reduce((a, q) => a + q.x, 0) / all.length;
  const side = Math.sign(cx - pu.start.x) || 1;
  return { x: side * 1, y: -0.9, z: 0.8 };
}

function heightOf(id: string) {
  const m = store.state.derived.byId.get(id);
  if (!m) return 0;
  const s = cachedSolid(m);
  const zs = [...s.startRing].map((q) => q.z);
  return Math.max(...zs) - Math.min(...zs);
}

function aggregate(c: Connection) {
  const m = new Map<string, { k: string; n: number; d: number; len: number; grade: string; hole: number; grip: number; loc: string }>();
  for (const b of c.bolts) {
    const k = `${b.d}|${b.length}|${b.grade}|${b.hole}|${b.grip}|${b.location}`;
    const e = m.get(k) ?? { k, n: 0, d: b.d, len: b.length, grade: b.grade, hole: b.hole, grip: b.grip, loc: b.location };
    e.n++; m.set(k, e);
  }
  return [...m.values()];
}

/** קיטום קטע לחלון ריבועי (Liang–Barsky). */
function clip(x0: number, y0: number, x1: number, y1: number, R: number): [number, number, number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 + R], [dx, R - x0], [-dy, y0 + R], [dy, R - y0]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

/**
 * תצוגת חתך של החיבור, נגזרת מהמודל: מבט לאורך Y במישור המסגרת.
 * אלמנטים שחוצים את מישור החתך (פטה, זוויתן) — חתך ממולא; האחרים — היטל קווי מתאר, מקוטם לחלון.
 */
export function SectionSvg({ c }: { c: Connection }) {
  const d = useStore((s) => s.derived);
  const ids = [...c.members, ...c.parts.flatMap((x) => [x, `${x}.H`, `${x}.S`, `${x}.N`])];
  const parts = ids.map((x) => d.byId.get(x)).filter((m): m is NonNullable<typeof m> => !!m);
  const pm = d.byId.get(c.parts[0]);
  if (!pm) return null;
  const s0 = cachedSolid(pm);
  const ring = [...s0.startRing, ...s0.endRing];
  const center: Vec3 = { x: ring.reduce((a, q) => a + q.x, 0) / ring.length, y: ring.reduce((a, q) => a + q.y, 0) / ring.length, z: ring.reduce((a, q) => a + q.z, 0) / ring.length };
  const R = c.type === 'purlin-cleat' ? 230 : c.type === 'base' ? 420 : 480;
  const P = (q: Vec3) => ({ x: q.x - center.x, y: -(q.z - center.z) });
  const out: string[] = [];
  for (const m of parts) {
    const s = cachedSolid(m);
    const cls = m.kind === 'bolt' ? 'b' : m.kind === 'cleat' ? 'c' : m.kind === 'plate' ? 'p' : m.kind === 'purlin' ? 'u' : 'm';
    const ys = [...s.startRing, ...s.endRing].map((q) => q.y);
    const crosses = Math.min(...ys) < center.y - 1e-6 && Math.max(...ys) > center.y + 1e-6 && Math.abs(s.startRing[0].y - s.endRing[0].y) > 1;
    if (crosses) {
      // חתך אמיתי: חיתוך הצלעות האורכיות במישור y = center.y
      const pts = s.startRing.map((a, i) => {
        const b = s.endRing[i];
        const t = (center.y - a.y) / (b.y - a.y);
        return P({ x: a.x + (b.x - a.x) * t, y: center.y, z: a.z + (b.z - a.z) * t });
      });
      out.push(`<polygon class="${cls} cut" points="${pts.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' ')}"/>`);
      continue;
    }
    for (let i = 0; i < s.edges.length; i += 6) {
      const a = P({ x: s.edges[i], y: s.edges[i + 1], z: s.edges[i + 2] }), b = P({ x: s.edges[i + 3], y: s.edges[i + 4], z: s.edges[i + 5] });
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.01) continue;
      const k = clip(a.x, a.y, b.x, b.y, R);
      if (k) out.push(`<line class="${cls}" x1="${k[0].toFixed(2)}" y1="${k[1].toFixed(2)}" x2="${k[2].toFixed(2)}" y2="${k[3].toFixed(2)}"/>`);
    }
  }
  return (
    <div className="conn-svg" data-testid="conn-section">
      <svg viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} dangerouslySetInnerHTML={{ __html: out.join('') }} />
      <div className="hint" style={{ margin: 0 }}>חתך במישור המסגרת (מבט לאורך Y) · נגזר מהמודל · ירוק: זוויתן · כתום: ברגים</div>
    </div>
  );
}

/**
 * מבט על הרגל הניצבת של הזוויתן (הצד המוברג לווב הפטה) עם מידות: מרחק קצה, מרווח, מרחק שפה וגובה החורים.
 * מידה קטנה מהמינימום המקובל (1.2·d0) — באדום, עם כפתור תיקון.
 */
function CleatFace({ cl, H, issues }: { cl: CleatParams; H: number; issues: ValidationIssue[] }) {
  const d0 = cl.bolt.d + cl.bolt.clearance, minE = 1.2 * d0;
  const hh0 = cl.holeHeight ?? (H - (cl.rows - 1) * cl.rowPitch) / 2;
  const xs = Array.from({ length: cl.perRow }, (_, i) => (i - (cl.perRow - 1) / 2) * cl.pitch);
  const zs = Array.from({ length: cl.rows }, (_, r) => hh0 + r * cl.rowPitch);
  const e1 = cl.width / 2 - ((cl.perRow - 1) / 2) * cl.pitch, e2 = H - zs[zs.length - 1];
  const pad = 46, k = Math.min(220 / cl.width, 170 / H), W = cl.width * k + 2 * pad, Hs = H * k + 2 * pad - 10;
  const X = (x: number) => pad + (x + cl.width / 2) * k, Y = (z: number) => pad - 10 + (H - z) * k;
  const bad = (v: number) => v < minE - 0.01;
  const dimH = (x0: number, x1: number, y: number, v: number, warn = false) => (
    <g className={warn ? 'cf-bad' : 'cf-dim'}><line x1={X(x0)} y1={y} x2={X(x1)} y2={y} /><line x1={X(x0)} y1={y - 4} x2={X(x0)} y2={y + 4} /><line x1={X(x1)} y1={y - 4} x2={X(x1)} y2={y + 4} />
      <text x={(X(x0) + X(x1)) / 2} y={y - 4}>{Math.round(v * 10) / 10}</text></g>
  );
  const dimV = (z0: number, z1: number, x: number, v: number, warn = false) => (
    <g className={warn ? 'cf-bad' : 'cf-dim'}><line x1={x} y1={Y(z0)} x2={x} y2={Y(z1)} /><line x1={x - 4} y1={Y(z0)} x2={x + 4} y2={Y(z0)} /><line x1={x - 4} y1={Y(z1)} x2={x + 4} y2={Y(z1)} />
      <text x={x - 5} y={(Y(z0) + Y(z1)) / 2 + 3} textAnchor="end">{Math.round(v * 10) / 10}</text></g>
  );
  const fixes = issues.filter((i) => i.cleatFix);
  return (
    <div className="cleat-face" data-testid="cleat-face">
      <svg viewBox={`0 0 ${W} ${Hs}`} role="img" aria-label="מבט על רגל הזוויתן">
        <rect x={X(-cl.width / 2)} y={Y(H)} width={cl.width * k} height={H * k} className="cf-plate" />
        <rect x={X(-cl.width / 2)} y={Y(cl.thickness)} width={cl.width * k} height={cl.thickness * k} className="cf-base" />
        {zs.flatMap((z) => xs.map((x) => <circle key={`${x}.${z}`} cx={X(x)} cy={Y(z)} r={(d0 / 2) * k} className="cf-hole" />))}
        {dimH(-cl.width / 2, -cl.width / 2 + e1, Y(H) - 14, e1, bad(e1))}
        {cl.perRow > 1 && dimH(xs[0], xs[1], Y(H) - 14, cl.pitch)}
        {dimH(-cl.width / 2, cl.width / 2, Y(0) + 22, cl.width)}
        {dimV(zs[zs.length - 1], H, X(-cl.width / 2) - 8, e2, bad(e2))}
        {dimV(0, zs[0], X(-cl.width / 2) - 8, zs[0])}
        {dimV(0, H, X(cl.width / 2) + 34, H)}
      </svg>
      <div className="hint" style={{ margin: 0 }}>מבט על הרגל המוברגת לווב הפטה. חור Ø{d0} (M{cl.bolt.d}); מינימום מקובל לקצה ולשפה 1.2·d0 = {minE.toFixed(1)} מ"מ — מידה אדומה קטנה ממנו.</div>
      {fixes.map((i, n) => <button key={n} className="btn small primary" data-testid={`cf-fix-${n}`} onClick={() => store.exec(applyIssueFixes([i]))}>תיקון: {i.cleatFix!.label}</button>)}
    </div>
  );
}
