import { setConnection, setConnectionDefault } from '../commands/commands';
import { checkEavePlate, suggestEavePlate, type EaveCheck } from '../geometry/eavePlate';
import type { PlateConnParams } from '../model/types';
import { store, useStore } from '../store';
import { Icon } from './icons';

/**
 * חלון בדיקת פלטת ראש עמוד: מבט מלמעלה על הפלטה, היטל העמוד, אגף הקורה והברגים (אום/ראש);
 * התנגשויות באדום. מציע מידות מזעריות לפי רוחב הפרופילים — החלטת משתמש 15.11.2026.
 */
export function EaveCheckDialog() {
  const id = useStore((s) => s.eaveCheck);
  const d = useStore((s) => s.derived);
  const p = useStore((s) => s.project);
  if (!id) return null;
  const c = d.connById.get(id);
  const close = () => store.set({ eaveCheck: null });
  if (!c) return null;
  const [colId, rafId] = c.members;
  const col = d.byId.get(colId), raf = d.byId.get(rafId);
  if (!col || !raf) return null;
  const o = p.connectionOverrides[id] ?? {};
  const base = p.connectionDefaults.eave;
  const prm: PlateConnParams = { ...base, ...o, bolt: { ...base.bolt, ...(o.bolt ?? {}) } } as PlateConnParams;
  const cos = Math.abs(raf.end.x - raf.start.x) / Math.hypot(raf.end.x - raf.start.x, raf.end.z - raf.start.z) || 1;
  const cur = checkEavePlate(prm, raf.profile, col.profile, cos);
  const sug = { ...prm, ...suggestEavePlate(prm, raf.profile, col.profile, cos) };
  const sc = checkEavePlate(sug, raf.profile, col.profile, cos);
  const overridden = ['w', 'l', 'gauge', 'pitch', 'cols', 'rows'].some((k) => k in o);
  const patch = { w: sug.w, l: sug.l, gauge: sug.gauge, pitch: sug.pitch, cols: sug.cols, rows: sug.rows };
  return (
    <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog wide" role="dialog" aria-label="בדיקת פלטת ראש עמוד" data-testid="eave-check">
        <header><h2>בדיקת פלטות ראש עמוד</h2><button className="icon-btn" onClick={close} aria-label="סגירה"><Icon name="x" /></button></header>
        <div className="body">
          <div className="hint" style={{ marginTop: 0 }}>{c.label} · עמוד {col.profile} · קורה {raf.profile} · {prm.cols * prm.rows}×M{prm.bolt.d}. מבט מלמעלה; ציר X לאורך הקורה.</div>
          <div className="grid2">
            <PlatePlan title="מצב נוכחי" prm={prm} ck={cur} testId="eave-cur" />
            <PlatePlan title="הצעה" prm={sug} ck={sc} testId="eave-sug" />
          </div>
          {cur.messages.length > 0
            ? <div className="issue error">{cur.messages.map((m, i) => <div key={i}>• {m}</div>)}</div>
            : <div className="issue"><span className="ic">✓</span>הפלטה הנוכחית תקינה גיאומטרית. ההצעה היא המידה המזערית.</div>}
          <div className="hint">ההצעה: אום מחוץ לרוחב אגף הקורה, ראש בורג מחוץ להיטל העמוד, כיסוי חתך העמוד + 5 מ"מ לכל צד לריתוך, מרחק שפה ≥ 1.5·d0. גיאומטריה בלבד — אינה בדיקת חוזק.</div>
        </div>
        <footer>
          <button className="btn primary" data-testid="eave-apply-default" onClick={() => { store.exec(setConnectionDefault('eave', patch)); close(); }}>החל הצעה על כל חיבורי ראש העמוד</button>
          {overridden && <button className="btn" onClick={() => { store.exec(setConnection(id, patch)); close(); }}>החל רק על חיבור זה</button>}
          <button className="btn" data-testid="eave-keep" onClick={close}>השאר כמו שהוא</button>
        </footer>
      </div>
    </div>
  );
}

function PlatePlan({ title, prm, ck, testId }: { title: string; prm: PlateConnParams; ck: EaveCheck; testId: string }) {
  const W = 300, H = 240;
  const ext = Math.max(prm.l, ck.col.h / ck.cos, prm.w, ck.col.b) * 1.25;
  const k = Math.min(W, H) / ext;
  const X = (x: number) => W / 2 + x * k, Y = (y: number) => H / 2 - y * k;
  const rect = (w: number, h: number, cls: string) => <rect x={X(-w / 2)} y={Y(h / 2)} width={w * k} height={h * k} className={cls} />;
  return (
    <div data-testid={testId}>
      <div className="panel-title" style={{ marginTop: 6 }}>{title} <span className={`badge ${ck.ok ? 'ok' : 'err'}`}>{ck.ok ? 'תקין' : 'התנגשות'}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="plate-plan" role="img" aria-label={title}>
        {/* קורה: אגף לאורך X */}
        <rect x={0} y={Y(ck.raf.b / 2)} width={W} height={ck.raf.b * k} className="pp-raf" />
        {rect(prm.l, prm.w, 'pp-plate')}
        {rect(ck.col.h / ck.cos, ck.col.b, 'pp-col')}
        {ck.bolts.map((b, i) => (
          <g key={i}>
            <circle cx={X(b.px)} cy={Y(b.gy)} r={ck.rr * k} className={b.nutHit || b.headHit ? 'pp-nut bad' : 'pp-nut'} />
            <circle cx={X(b.px)} cy={Y(b.gy)} r={((prm.bolt.d + prm.bolt.clearance) / 2) * k} className="pp-hole" />
          </g>
        ))}
      </svg>
      <dl className="kv">
        <dt>פלטה (רוחב × אורך × עובי)</dt><dd>{prm.w} × {prm.l} × {prm.t}</dd>
        <dt>מרווח ברגים לרוחב / לאורך</dt><dd>{prm.gauge} / {prm.pitch}</dd>
      </dl>
      <div className="pp-legend"><span className="sw raf" />אגף הקורה <span className="sw col" />היטל העמוד <span className="sw bad" />אום/ראש מתנגש</div>
    </div>
  );
}
