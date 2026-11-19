import { Fragment, useEffect, useMemo, useState } from 'react';
import { store, useStore } from '../store';
import { generate } from '../geometry/generate';
import { siteKey } from '../geometry/detail';
import { uid } from '../core/ids';
import { applyDetail, candidates, detailById, readCurrent, situationOf, type ConnFamily, type ConnPreset, type Params } from '../model/connRegistry';
import type { Project } from '../model/types';
import { Dialog } from './Dialogs';
import { PIC } from './DetailPicker';
import { pickFile } from '../persist/files';

/** בדיקה חיה של פרט מועמד: בונים את המודל עם הפרט ובודקים התנגשויות ושגיאות (גיאומטריה בלבד) */
function evalCandidate(p: Project, next: Project, family: ConnFamily) {
  const PRE: Record<ConnFamily, RegExp> = { knee: /^C\.KB\.|^KB\./, strut: /^C\.RS\d|^RS\d/, base: /^C\.BASE\./, eave: /^C\.EAVE\./, ridge: /^C\.RIDGE/, side: /^C\.SIDE/, roofx: /^(C\.)?BR\.R/, wallx: /^(C\.)?BR\.W/, portal: /^(C\.)?BB\./, cleat: /^C\.PC\.|^CL\./, psplice: /^C\.PS|^PL\./, bsplice: /SPL|splice/i };
  const pre = PRE[family];
  const d = generate(next);
  const rel = d.issues.filter((i) => (i.severity !== 'info') && (pre.test(i.elementId ?? '') || /אלכסון|תמוכה|בסיס|בורג|שפה|התנגשות/.test(i.message)) && (i.code !== 'CLASH' || pre.test(i.elementId ?? '') || pre.test(i.message.split(' ')[1] ?? '')));
  const clash = d.issues.filter((i) => i.code === 'CLASH' && (pre.test(i.message.split(' ')[1] ?? '') || pre.test(i.message.split(' ')[3] ?? '') || pre.test(i.elementId ?? ''))).length;
  void p;
  return { clash, warn: rel.filter((i) => i.code !== 'CLASH'), errors: d.issues.filter((i) => i.severity === 'error').length };
}

/**
 * אשף החיבורים (1.42): נפתח מכל כפתור "פרט ✎". מצב שזוהה ← פרטים מוצעים (מדורגים, עם סיבה ובדיקה) ← פרמטרים והחלה
 * (החיבור הזה / כל החיבורים באותו מצב). שמירה לספריית החיבורים של הפרויקט הפתוח; פתיחה בסטודיו.
 */
export function ConnWizard() {
  const connId = useStore((s) => s.connWizard ?? null);
  if (!connId) return null;
  return <WizardBody key={connId} connId={connId} />;
}

function WizardBody({ connId }: { connId: string }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const close = () => store.set({ connWizard: null });
  const sit = useMemo(() => situationOf(p, d, connId), [p, d, connId]);
  const cur = sit ? readCurrent(p, sit) : null;
  const cands = useMemo(() => (sit ? candidates(p, sit) : []), [p, sit]);
  const [showAll, setShowAll] = useState(false);
  const [sel, setSel] = useState<string>(() => cands.find((c) => c.detail === cur?.detail && !c.preset)?.id ?? cands[0]?.id);
  const pick = cands.find((c) => c.id === sel) ?? cands[0];
  const [params, setParams] = useState<Params>(() => ({ ...(cur?.params ?? {}) }));
  const [scope, setScope] = useState<'all' | 'one'>(cur?.local && sit?.oneLabel !== null ? 'one' : 'all');
  const [check, setCheck] = useState<ReturnType<typeof evalCandidate> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (pick?.preset) setParams({ ...(cur?.params ?? {}), ...pick.preset.params }); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = useMemo(() => (sit && pick && pick.fit.status !== 'no' ? applyDetail(p, sit, pick.detail, params, scope) : null), [p, sit, pick, params, scope]);
  useEffect(() => {
    if (!next || !sit) { setCheck(null); return; }
    setBusy(true);
    const t = setTimeout(() => { try { setCheck(evalCandidate(p, next, sit.family)); } finally { setBusy(false); } }, 30);
    return () => clearTimeout(t);
  }, [next]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sit || !cur) return <Dialog title="אשף חיבורים" onClose={close}><div className="hint">לסוג החיבור הזה אין עדיין סוגי פרט באשף — פתחו את עורך החיבור.</div></Dialog>;
  const dt = detailById(pick?.detail ?? '');
  const vis = showAll ? cands : cands.filter((c) => c.fit.status !== 'no');
  const apply = () => { if (!next) return; store.exec({ label: `אשף חיבורים: ${pick!.title}${scope === 'one' ? ' (מיקום זה)' : ''}`, run: () => next }); close(); };
  const save = () => {
    const name = prompt('שם להגדרה בספרייה', `${dt?.title ?? ''} — ${Object.entries(params).filter(([k]) => dt?.params.some((q) => q.key === k)).map(([, v]) => v).join(' / ')}`);
    if (!name) return;
    const pr: ConnPreset = { id: uid('CP'), family: sit.family, detail: pick!.detail, name, params: Object.fromEntries(Object.entries(params).filter(([k]) => dt?.params.some((q) => q.key === k))) };
    store.exec({ label: `ספריית חיבורים: ${name}`, run: (pp) => ({ ...pp, connLibrary: [...(pp.connLibrary ?? []), pr] }) });
  };
  const brace = sit.family === 'knee' ? d.connById.get(connId)?.parts[0] : sit.family === 'strut' ? d.connById.get(connId)?.members[1] : d.connById.get(connId)?.members[0];
  const TAG: Record<string, string> = { ok: 'מתאים', warn: 'עם הערה', no: 'לא מתאים' };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog wiz" role="dialog" aria-label="אשף חיבורים" data-testid="conn-wizard">
        <header><h2>אשף חיבורים <small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 13 }}>· {sit.title}</small></h2>
          <button className="btn small" data-testid="wiz-library" onClick={() => store.set({ connWizard: null, connLibraryOpen: true })}>ספריית חיבורים</button>
          <button className="icon-btn" onClick={close} aria-label="סגירה">✕</button></header>
        <div className="wiz-body">
          <section className="wiz-col">
            <h3>המצב שזוהה אוטומטית</h3>
            <dl className="kv">{sit.facts.map((f) => <Fragment key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></Fragment>)}</dl>
            <div className="sum-pills"><span className="sum-pill muted" data-testid="wiz-same">אותו מצב בפרויקט: {sit.sameCount} חיבורים</span>{cur.local && <span className="sum-pill warn">למיקום הזה יש חריג</span>}</div>
            <div className="hint">המצב נקבע מהמודל: סוג המארח, האלמנט והזווית — לא בוחרים סוג חיבור ידנית.</div>
          </section>
          <section className="wiz-col mid">
            <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>פרטים מוצעים</h3>
              <div className="seg"><button className={`tbtn${!showAll ? ' on' : ''}`} onClick={() => setShowAll(false)}>מתאימים ({cands.filter((c) => c.fit.status !== 'no').length})</button><button className={`tbtn${showAll ? ' on' : ''}`} data-testid="wiz-all" onClick={() => setShowAll(true)}>הכל ({cands.length})</button></div></div>
            {vis.map((c) => (
              <button key={c.id} className={`wiz-card${c.id === pick?.id ? ' on' : ''}${c.fit.status === 'no' ? ' no' : ''}`} data-testid={`wiz-c-${c.id}`} onClick={() => c.fit.status !== 'no' && setSel(c.id)}>
                <span className="wiz-pic">{PIC[c.pic as keyof typeof PIC]}</span>
                <span className="wiz-txt"><b>{c.title} {c.preset ? <span className="sum-pill">{c.isDefault ? 'ברירת מחדל ★' : 'שמור'}</span> : <span className="sum-pill muted">מובנה</span>}{c.detail === cur.detail && !c.preset && <span className="sum-pill">נוכחי</span>}</b>
                  <small>{c.desc}</small><small className={`fit-${c.fit.status}`}>{c.fit.status === 'ok' ? '✓' : c.fit.status === 'warn' ? '⚠' : '✗'} {c.fit.reason}</small></span>
                <span className={`sum-pill ${c.fit.status === 'ok' ? '' : c.fit.status === 'warn' ? 'warn' : 'bad'}`}>{TAG[c.fit.status]}</span>
              </button>
            ))}
          </section>
          <section className="wiz-col">
            <h3>{pick?.title ?? ''} — פרמטרים ובדיקה</h3>
            {dt && dt.params.map((q) => (
              <div className="field" key={q.key}><label>{q.label}</label>
                {q.options
                  ? <select className="inp" data-testid={`wiz-p-${q.key}`} value={String(params[q.key] ?? '')} onChange={(e) => setParams({ ...params, [q.key]: Number(e.target.value) })}>{q.options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
                  : <input className="inp num" data-testid={`wiz-p-${q.key}`} type="number" defaultValue={String(params[q.key] ?? '')} key={`${sel}-${q.key}`} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setParams({ ...params, [q.key]: Math.max(q.min ?? -Infinity, v) }); }} />}
              </div>))}
            {dt && !dt.params.length && <div className="hint">לפרט הזה אין פרמטרים.</div>}
            <div className="wiz-check" data-testid="wiz-check">
              {busy ? <div className="hint">בודק…</div> : check && <>
                <div className={check.clash ? 'fit-no' : 'fit-ok'}>● התנגשויות: {check.clash}</div>
                <div className={check.errors ? 'fit-no' : 'fit-ok'}>● שגיאות במודל: {check.errors}</div>
                {check.warn.slice(0, 3).map((w, i) => <div key={i} className="fit-warn">● {w.message}</div>)}
              </>}
              <div className="hint">● בדיקת חוזק — אינה מבוצעת (גיאומטריה בלבד)</div>
            </div>
          </section>
        </div>
        <footer>
          <b>החל על:</b>
          {sit.oneLabel !== null && <label className="ss-radio"><input type="radio" data-testid="wiz-scope-one" checked={scope === 'one'} onChange={() => setScope('one')} />{sit.family === 'knee' ? 'המיקום הזה (כל המסגרות)' : sit.family === 'strut' ? 'שורת התמוכות הזו' : sit.oneLabel ?? 'החיבור הזה'}</label>}
          <label className="ss-radio"><input type="radio" data-testid="wiz-scope-all" checked={scope === 'all'} onChange={() => setScope('all')} />כל החיבורים באותו מצב ({sit.sameCount})</label>
          <span className="hint" style={{ margin: 0 }}>{scope === 'all' ? 'חריגים קיימים נשמרים' : ''}</span>
          <span style={{ marginInlineStart: 'auto' }} />
          <button className="btn" data-testid="wiz-save" disabled={!pick || pick.fit.status === 'no'} onClick={save}>שמור כהגדרה בספרייה</button>
          {brace && <button className="btn" data-testid="wiz-studio" onClick={() => { store.set({ connWizard: null, detailStudio: siteKey(brace, 'start') }); }}>פתח בסטודיו ✎</button>}
          <button className="btn primary" data-testid="wiz-apply" disabled={!next} onClick={apply}>החל</button>
        </footer>
      </div>
    </div>
  );
}

/** ספריית החיבורים (פרויקט פתוח): הגדרות שמורות — שינוי שם, מחיקה, ברירת מחדל, ייצוא/ייבוא סטנדרט חברה */
export function ConnLibrary() {
  const open = useStore((s) => !!s.connLibraryOpen);
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  if (!open) return null;
  const lib = p.connLibrary ?? [];
  const close = () => store.set({ connLibraryOpen: false });
  const FAM: Record<ConnFamily, string> = { knee: 'אלכסוני עמוד-קורה', strut: 'תמוכות בין הקורות', base: 'בסיסים', eave: 'עמוד-קורה', ridge: 'רכס', side: 'קורה לצד עמוד', roofx: 'קושרות גג', wallx: 'קושרות קיר', portal: 'אגד B', cleat: 'תושבות פטה', psplice: 'חיבורי המשך פטות', bsplice: 'חיבורי המשך קורות/עמודים' };
  const setLib = (l: ConnPreset[], label: string, extra?: (pp: Project) => Project) => store.exec({ label, run: (pp) => { const n = { ...pp, connLibrary: l }; return extra ? extra(n) : n; } });
  const makeDefault = (x: ConnPreset) => {
    const firstConn = d.connections.find((c) => (x.family === 'knee' ? c.id.startsWith('C.KB.') : x.family === 'strut' ? /^C\.RS\d+\./.test(c.id) : c.type === 'base'));
    const sit = firstConn ? situationOf(p, d, firstConn.id) : null;
    store.exec({ label: `ברירת מחדל: ${x.name}`, run: (pp) => { let n: Project = { ...pp, connDefaults: { ...(pp.connDefaults ?? {}), [x.family]: x.id } }; if (sit) n = applyDetail(n, sit, x.detail, { ...readCurrent(n, sit).params, ...x.params }, 'all'); return n; } });
  };
  const exportLib = () => {
    const blob = new Blob([JSON.stringify({ kind: 'ksp-conn-library', version: 1, presets: lib }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'connection-standard.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importLib = async () => {
    const f = await pickFile('.json'); if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const add: ConnPreset[] = (j.presets ?? []).filter((x: ConnPreset) => x && detailById(x.detail));
      setLib([...lib, ...add.map((x) => ({ ...x, id: uid('CP') }))], `ייבוא ${add.length} הגדרות חיבור`);
    } catch { store.toast('error', 'קובץ לא תקין'); }
  };
  return (
    <Dialog title="ספריית חיבורים — הפרויקט הפתוח" onClose={close} wide testId="conn-library"
      footer={<><span className="hint" style={{ margin: 0 }}>שינוי בהגדרה חל על הפרויקט הפתוח בלבד. סטנדרט החברה מתעדכן רק בייצוא.</span><span style={{ marginInlineStart: 'auto' }} /><button className="btn" data-testid="lib-import" onClick={importLib}>ייבוא סטנדרט חברה</button><button className="btn" data-testid="lib-export" disabled={!lib.length} onClick={exportLib}>ייצוא סטנדרט חברה</button></>}>
      {(Object.keys(FAM) as ConnFamily[]).map((f) => {
        const items = lib.filter((x) => x.family === f);
        return <div key={f} style={{ marginBottom: 12 }}>
          <div className="sum-group">{FAM[f]} ({items.length})</div>
          {!items.length && <div className="hint">אין הגדרות שמורות — שומרים מתוך אשף החיבורים ("שמור כהגדרה בספרייה").</div>}
          {items.map((x) => { const t = detailById(x.detail)!; const isDef = p.connDefaults?.[f] === x.id; return (
            <div key={x.id} className="sum-card" data-testid={`lib-${x.id}`}>
              <div className="sum-main" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span>{PIC[t.pic as keyof typeof PIC]}</span>
                <div><input className="inp" style={{ fontWeight: 700, minWidth: 220 }} defaultValue={x.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== x.name) setLib(lib.map((q) => (q.id === x.id ? { ...q, name: v } : q)), 'שינוי שם הגדרה'); }} />
                  <div className="sum-sub">{t.title} · {Object.entries(x.params).map(([k, v]) => `${t.params.find((q) => q.key === k)?.label ?? k}: ${v}`).join(' · ') || 'ללא פרמטרים'}</div></div>
                {isDef && <span className="sum-pill">ברירת מחדל ★</span>}
              </div>
              <div className="row" style={{ gap: 4 }}>
                {!isDef && <button className="btn small" data-testid={`lib-def-${x.id}`} onClick={() => makeDefault(x)}>קבע כברירת מחדל</button>}
                <button className="btn small" onClick={() => setLib([...lib, { ...x, id: uid('CP'), name: `${x.name} (עותק)` }], 'שכפול הגדרה')}>שכפל</button>
                <button className="btn small" data-testid={`lib-del-${x.id}`} onClick={() => setLib(lib.filter((q) => q.id !== x.id), 'מחיקת הגדרה', (pp) => ({ ...pp, connDefaults: Object.fromEntries(Object.entries(pp.connDefaults ?? {}).filter(([, v]) => v !== x.id)) }))}>מחק</button>
              </div>
            </div>); })}
        </div>;
      })}
    </Dialog>
  );
}
