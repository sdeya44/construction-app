import { Fragment, useMemo, useState } from 'react';
import { resetDetailParams, setDetailParam, setDetailTemplateVar } from '../../commands/commands';
import { detailParamValues } from '../../geometry/detail';
import { customParamDefs } from '../../model/connRegistry';
import { store, useStore } from '../../store';

/**
 * אשף דינמי לפרט מהספרייה / מהסטודיו (מתכון v2): השדות נבנים מ-`CustomDetail.params`.
 * ערך נשמר למופע (`project.detailParams[siteKey]`) — "רק כאן", או כברירת מחדל של התבנית — "עדכן תבנית" (כל הקצוות שאין להם ערך משלהם).
 * השינוי חי: כל ערך נשלח כפקודה ומוצג מיד במודל (ובטרנזקציית האשף, אם פתוחה).
 */
export function DetailParamsForm({ siteKey, testId = 'dpf' }: { siteKey: string; testId?: string }) {
  const p = useStore((s) => s.project), d = useStore((s) => s.derived);
  const detId = p.detailAssign?.[siteKey];
  const det = detId ? (p.customDetails ?? []).find((x) => x.id === detId) : undefined;
  const own = p.detailParams?.[siteKey];
  const defs = useMemo(() => (det ? customParamDefs(det) : []), [det]);
  const info = useMemo(() => (det ? detailParamValues(d.members, siteKey, det, own) : null), [d, det, siteKey, own]);
  const [scope, setScope] = useState<'one' | 'template'>('one');
  if (!det || !defs.length) return null;
  const sameCount = Object.values(p.detailAssign ?? {}).filter((v) => v === det.id).length;
  const commit = (name: string, v: number) => {
    if (!Number.isFinite(v)) return;
    const def = defs.find((q) => q.key === name)!;
    const x = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, v));
    if (scope === 'template') {
      store.exec({ label: `עדכון תבנית: ${det.name} — ${def.label}`, run: (pp) => setDetailParam([siteKey], name, null).run(setDetailTemplateVar(det.id, name, x).run(pp)) });
    } else if (info && Math.abs(info.defaults[name] - x) < 1e-9) store.exec(setDetailParam([siteKey], name, null));
    else store.exec(setDetailParam([siteKey], name, x));
  };
  const groups = [...new Set(defs.map((q) => q.group ?? ''))];
  return (
    <div className="dpf" data-testid={testId}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>פרמטרים של הפרט — {det.name}</b>
        {own && Object.keys(own).length > 0 && <button className="btn small" data-testid={`${testId}-reset`} onClick={() => store.exec(resetDetailParams([siteKey]))}>איפוס לברירות מחדל</button>}
      </div>
      <div className="seg scope-seg" role="radiogroup" aria-label="היקף השינוי">
        <button className={`tbtn${scope === 'one' ? ' on' : ''}`} data-testid={`${testId}-scope-one`} onClick={() => setScope('one')}>רק בקצה הזה</button>
        <button className={`tbtn${scope === 'template' ? ' on' : ''}`} data-testid={`${testId}-scope-tpl`} onClick={() => setScope('template')}>עדכן תבנית ({sameCount === 1 ? 'קצה אחד' : `${sameCount} קצוות`})</button>
      </div>
      {groups.map((g) => (
        <Fragment key={g}>
          {g && <div className="hub-set-h">{g}</div>}
          {defs.filter((q) => (q.group ?? '') === g).map((q) => {
            const val = info?.values[q.key] ?? 0;
            const overridden = !!own && q.key in own;
            return (
              <div className="field" key={q.key} data-testid={`${testId}-f-${q.key}`}>
                <label>{q.label}{q.unit ? ` (${q.unit})` : ''}{overridden && <span className="sum-pill" title="ערך שונה מברירת המחדל של הפרט" style={{ marginInlineStart: 6 }}>שונה כאן</span>}</label>
                {q.toggle
                  ? <input type="checkbox" checked={val >= 0.5} data-testid={`${testId}-${q.key}`} onChange={(e) => commit(q.key, e.target.checked ? 1 : 0)} />
                  : q.options
                    ? <select className="inp" data-testid={`${testId}-${q.key}`} value={String(val)} onChange={(e) => commit(q.key, Number(e.target.value))}>
                      {!q.options.some((o) => Number(o.v) === val) && <option value={String(val)}>{val}</option>}
                      {q.options.map((o) => <option key={o.v} value={String(o.v)}>{o.t}</option>)}
                    </select>
                    : <input className="inp num" type="number" data-testid={`${testId}-${q.key}`} min={q.min} max={q.max} defaultValue={String(round(val))} key={`${siteKey}-${q.key}-${round(val)}-${scope}`}
                      onBlur={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && v !== val) commit(q.key, v); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
                {q.hint && <small className="hint">{q.hint}</small>}
              </div>
            );
          })}
        </Fragment>
      ))}
      <div className="hint">{scope === 'one' ? 'השינוי חל על הקצה הזה בלבד; שאר הקצוות עם הפרט נשארים לפי התבנית.' : 'השינוי נשמר בתבנית בספרייה ומשפיע על כל הקצוות עם הפרט שאין להם ערך משלהם.'}</div>
    </div>
  );
}
const round = (x: number) => Math.round(x * 100) / 100;
