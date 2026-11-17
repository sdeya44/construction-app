import { useState } from 'react';
import { lex, tryExpr, type Vars } from '../core/expr';
import type { CustomDetail } from '../model/types';

/**
 * בונה נוסחאות בלחצנים — בלי לכתוב קוד: בוחרים פונקציה (הגדול מבין / הקטן מבין / עיגול), לוחצים על מידה
 * בתלת-ממד או ברשימה, ומוסיפים מספרים ופעולות. הנוסחה מוצגת כמשפט בעברית עם הערך המחושב.
 */
export const VAR_HE: Record<string, string> = {
  mh: 'גובה חתך האלמנט', mb: 'רוחב חתך האלמנט', mt: 'עובי דופן האלמנט', mtf: 'עובי אגף האלמנט',
  hh: 'גובה חתך המארח', hb: 'רוחב המארח', htf: 'עובי אגף המארח', htw: 'עובי ווב המארח', hd: 'עומק המארח',
  ang: 'זווית האלמנט למארח', send: 'מרחק קצה האלמנט מהמארח',
};
const FIELD_HE: Record<string, string> = {
  w: 'רוחב', h: 'גובה', t: 'עובי', px: 'מרווח לרוחב', py: 'מרווח לאורך', d0: 'קוטר חור', d: 'קוטר בורג', at: 'מרחק', L: 'אורך',
  along: 'מיקום לאורך', across: 'מיקום לרוחב', spin: 'סיבוב', off: 'היסט', ch: 'קיטום', rows: 'שורות', cols: 'עמודות', a: 'גרון ריתוך', dx: 'היסט', dy: 'היסט',
};
export const FN_HE: Record<string, string> = {
  max: 'הגדול מבין', min: 'הקטן מבין', r5: 'עגל למעלה ל-5', round: 'עגל', ceil: 'עגל למעלה', floor: 'עגל למטה', abs: 'ערך מוחלט', sqrt: 'שורש',
  sin: 'סינוס', cos: 'קוסינוס', tan: 'טנגנס', if: 'אם',
};

/** שם קריא למשתנה */
export function varLabel(name: string, det?: CustomDetail): string {
  const lo = name.toLowerCase();
  if (VAR_HE[lo]) return VAR_HE[lo];
  const m = /^([A-Za-z]+\d+)\.(\w+)$/.exec(name);
  if (m) return `${FIELD_HE[m[2]] ?? m[2]} ${m[1].toUpperCase()}`;
  const v = det?.vars.find((x) => x.name.toLowerCase() === lo);
  if (v) return v.note ? `${v.note} (${v.name})` : v.name;
  return name;
}

export function toTokens(src: string): string[] {
  if (!src.trim()) return [];
  try { return lex(src).map((t) => (t.k === 'n' ? String(t.v) : t.v)); } catch { return [src]; }
}
export const fromTokens = (t: string[]) => t.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ,/g, ',').replace(/\b(max|min|r5|round|ceil|floor|abs|sqrt|sin|cos|tan|if) \(/gi, '$1(');

/** הנוסחה כמשפט בעברית */
export function readable(src: string, det?: CustomDetail): string {
  const t = toTokens(src);
  return t.map((x, i) => {
    const lo = x.toLowerCase();
    if (FN_HE[lo] && t[i + 1] === '(') return FN_HE[lo];
    if (x === ',') return ' ובין ';
    if (x === '*') return ' × ';
    if (x === '/') return ' ÷ ';
    if (x === '+' || x === '-') return ` ${x === '-' ? '−' : '+'} `;
    if (/^[A-Za-z_]/.test(x)) return varLabel(x, det);
    return x;
  }).join('').replace(/\s+/g, ' ').trim();
}

const OPS = ['+', '-', '*', '/'];
/** הוספת ערך: אם קודם לו ערך — מוסיפים "ובין" (בתוך פונקציה) או "+" */
export function appendValue(tokens: string[], v: string): string[] {
  const last = tokens[tokens.length - 1];
  const opens = tokens.filter((x) => x === '(').length - tokens.filter((x) => x === ')').length;
  const needOp = last !== undefined && last !== '(' && last !== ',' && !OPS.includes(last);
  return needOp ? [...tokens, opens > 0 ? ',' : '+', v] : [...tokens, v];
}

export interface FxTarget { title: string; value: string; apply: (v: string) => void }

export function FormulaBuilder({ target, tokens, setTokens, vars, det, groups, onClose }: {
  target: FxTarget; tokens: string[]; setTokens: (t: string[]) => void; vars: Vars; det: CustomDetail;
  groups: { title: string; items: string[] }[]; onClose: () => void;
}) {
  const [num, setNum] = useState('');
  const [text, setText] = useState(false);
  const opens = tokens.filter((x) => x === '(').length - tokens.filter((x) => x === ')').length;
  const src = fromTokens([...tokens, ...Array(Math.max(0, opens)).fill(')')]);
  const r = src ? tryExpr(src, vars) : { v: 0, err: 'הנוסחה ריקה' };
  const push = (...x: string[]) => setTokens([...tokens, ...x]);
  const last = tokens[tokens.length - 1];
  const needOp = last !== undefined && last !== '(' && last !== ',' && !['+', '-', '*', '/'].includes(last);
  const addValue = (v: string) => setTokens(appendValue(tokens, v));
  const addNum = () => { const x = num.trim().replace(',', '.'); if (!x || !Number.isFinite(Number(x))) return; addValue(x); setNum(''); };
  const ok = () => { target.apply(src); onClose(); };
  return (
    <section className="ss-card fxb" data-testid="fx-builder">
      <h4>בניית נוסחה — {target.title}</h4>
      {text ? (
        <input className="inp mono" value={fromTokens(tokens)} onChange={(e) => setTokens(toTokens(e.target.value))} aria-label="נוסחה כטקסט" />
      ) : (
        <div className="fx-chips" data-testid="fx-chips">
          {tokens.length === 0 && <span className="muted">בחרו פונקציה, מידה מהמודל או מספר</span>}
          {tokens.map((x, i) => {
            const lo = x.toLowerCase();
            const isFn = FN_HE[lo] && tokens[i + 1] === '(';
            const isVar = !isFn && /^[A-Za-z_]/.test(x);
            const cls = isFn ? 'fn' : isVar ? 'var' : /^[0-9.]/.test(x) ? 'num' : 'op';
            const lbl = isFn ? FN_HE[lo] : isVar ? varLabel(x, det) : x === ',' ? 'ובין' : x === '*' ? '×' : x === '/' ? '÷' : x === '-' ? '−' : x;
            return <span key={i} className={`fx-chip ${cls}`} title={x}>{lbl}{isVar && <small className="mono">{vars[x] !== undefined ? ` ${Math.round(vars[x] * 10) / 10}` : ''}</small>}</span>;
          })}
          {opens > 0 && <span className="fx-chip op ghost">{')'.repeat(opens)}</span>}
        </div>
      )}
      <div className={`fx-res${r.err ? ' bad' : ''}`} data-testid="fx-res">{r.err ? (tokens.length ? `לא שלם: ${r.err}` : '') : `= ${Math.round(r.v * 10) / 10}`}</div>
      <div className="fx-pad">
        <button className="btn small fn" onClick={() => push(...(needOp ? [opens > 0 ? ',' : '+'] : []), 'max', '(')} data-testid="fx-max" title="max — הערך הגדול מבין כמה ערכים">הגדול מבין</button>
        <button className="btn small fn" onClick={() => push(...(needOp ? [opens > 0 ? ',' : '+'] : []), 'min', '(')} data-testid="fx-min" title="min — הערך הקטן מבין כמה ערכים">הקטן מבין</button>
        <button className="btn small fn" onClick={() => push(...(needOp ? [opens > 0 ? ',' : '+'] : []), 'r5', '(')} title="r5 — עיגול כלפי מעלה לכפולה של 5 מ״מ">עגל ל-5</button>
        <button className="btn small" onClick={() => push(',')} disabled={opens <= 0} title="ערך נוסף בתוך הפונקציה" data-testid="fx-comma">ובין</button>
        <button className="btn small" onClick={() => push(')')} disabled={opens <= 0}>סגור )</button>
        <button className="btn small" onClick={() => push('(')}>(</button>
      </div>
      <div className="fx-pad">
        {([['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷']] as const).map(([o, l]) => <button key={o} className="btn small op" onClick={() => push(o)} data-testid={`fx-op-${o}`}>{l}</button>)}
        <input className="inp num" style={{ width: 70 }} value={num} placeholder="מספר" onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNum(); }} data-testid="fx-num" />
        <button className="btn small" onClick={addNum} data-testid="fx-num-add">הוסף</button>
        <button className="btn small" onClick={() => setTokens(tokens.slice(0, -1))} title="מחיקת החלק האחרון" data-testid="fx-back">⌫</button>
        <button className="btn small" onClick={() => setTokens([])}>נקה</button>
      </div>
      <div className="hint" style={{ margin: 0 }}>לחצו על מידה בשרטוט (התגיות הירוקות) או ברשימה:</div>
      <div className="fx-vars">
        {groups.filter((g) => g.items.length).map((g) => (
          <div key={g.title} className="fx-grp"><span className="fx-gt">{g.title}</span>
            {g.items.map((n) => <button key={n} className="fx-var" onClick={() => addValue(n)} data-testid={`fx-var-${n}`} title={n}>{varLabel(n, det)} <small className="mono">{vars[n] !== undefined ? Math.round(vars[n] * 10) / 10 : ''}</small></button>)}
          </div>
        ))}
      </div>
      <div className="ss-row">
        <button className="btn primary" onClick={ok} disabled={!!r.err && tokens.length > 0} data-testid="fx-ok">אישור</button>
        <button className="btn" onClick={onClose}>ביטול</button>
        <button className="btn small" onClick={() => setText(!text)}>{text ? 'תצוגת לחצנים' : 'עריכה כטקסט'}</button>
      </div>
      {!r.err && <div className="hint" style={{ margin: 0 }}>{readable(src, det)}</div>}
    </section>
  );
}
