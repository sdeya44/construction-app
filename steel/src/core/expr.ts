/**
 * מחשבון נוסחאות קטן ובטוח (ללא eval) לפרטי חיבור מותאמים.
 * תומך: + − × ÷ ^, סוגריים, מספרים, משתנים (כולל נקודה: P1.w), ופונקציות:
 * min max abs sqrt round ceil floor r5 (עיגול כלפי מעלה ל-5) sin cos tan (במעלות) if(c,a,b).
 */
export type Vars = Record<string, number>;

const FN: Record<string, (...a: number[]) => number> = {
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), abs: Math.abs, sqrt: Math.sqrt,
  round: Math.round, ceil: Math.ceil, floor: Math.floor, r5: (x) => Math.ceil(x / 5 - 1e-9) * 5,
  sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180), tan: (d) => Math.tan((d * Math.PI) / 180),
  if: (c, a, b) => (c ? a : b),
};
export const EXPR_FUNCS = Object.keys(FN);

type Tok = { k: 'n'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(s.slice(i)) ?? /^[0-9]+\.?/.exec(s.slice(i))!; out.push({ k: 'n', v: Number(m[0]) }); i += m[0].length; continue; }
    if (/[A-Za-z_֐-׿]/.test(c)) { const m = /^[A-Za-z_֐-׿][A-Za-z0-9_.֐-׿]*/.exec(s.slice(i))!; out.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '==', '!='].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/^(),<>×÷'.includes(c)) { out.push({ k: 'op', v: c === '×' ? '*' : c === '÷' ? '/' : c }); i++; continue; }
    throw new Error(`תו לא מוכר "${c}"`);
  }
  return out;
}

/** מחשב נוסחה. זורק שגיאה בעברית אם הנוסחה שגויה או שמשתנה חסר. */
export function evalExpr(src: string | number, vars: Vars): number {
  if (typeof src === 'number') return src;
  const t = lex(String(src));
  let p = 0;
  const peek = () => t[p], eat = (v?: string) => { const x = t[p]; if (!x || (v && x.v !== v)) throw new Error(v ? `חסר "${v}"` : 'נוסחה לא שלמה'); p++; return x; };
  const cmp = (): number => {
    let a = sum();
    while (peek()?.k === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek()!.v as string)) {
      const o = eat().v, b = sum();
      a = o === '<' ? +(a < b) : o === '>' ? +(a > b) : o === '<=' ? +(a <= b) : o === '>=' ? +(a >= b) : o === '==' ? +(Math.abs(a - b) < 1e-9) : +(Math.abs(a - b) >= 1e-9);
    }
    return a;
  };
  const sum = (): number => { let a = prod(); while (peek()?.k === 'op' && (peek()!.v === '+' || peek()!.v === '-')) { const o = eat().v; const b = prod(); a = o === '+' ? a + b : a - b; } return a; };
  const prod = (): number => { let a = pow(); while (peek()?.k === 'op' && (peek()!.v === '*' || peek()!.v === '/')) { const o = eat().v; const b = pow(); a = o === '*' ? a * b : a / b; } return a; };
  const pow = (): number => { const a = unary(); if (peek()?.k === 'op' && peek()!.v === '^') { eat(); return a ** pow(); } return a; };
  const unary = (): number => { if (peek()?.k === 'op' && peek()!.v === '-') { eat(); return -unary(); } if (peek()?.k === 'op' && peek()!.v === '+') { eat(); return unary(); } return atom(); };
  const atom = (): number => {
    const x = eat();
    if (x.k === 'n') return x.v;
    if (x.k === 'op' && x.v === '(') { const v = cmp(); eat(')'); return v; }
    if (x.k === 'id') {
      if (peek()?.k === 'op' && peek()!.v === '(') {
        const f = FN[x.v.toLowerCase()];
        if (!f) throw new Error(`פונקציה לא מוכרת "${x.v}"`);
        eat('('); const args: number[] = [];
        if (!(peek()?.k === 'op' && peek()!.v === ')')) { args.push(cmp()); while (peek()?.k === 'op' && peek()!.v === ',') { eat(); args.push(cmp()); } }
        eat(')');
        return f(...args);
      }
      if (x.v === 'pi') return Math.PI;
      if (!(x.v in vars)) throw new Error(`משתנה לא מוכר "${x.v}"`);
      return vars[x.v];
    }
    throw new Error('נוסחה שגויה');
  };
  const v = cmp();
  if (p < t.length) throw new Error('נוסחה שגויה');
  if (!Number.isFinite(v)) throw new Error('תוצאה לא מספרית');
  return v;
}

/** חישוב בטוח: מחזיר ערך ברירת מחדל ושגיאה במקום לזרוק */
export function tryExpr(src: string | number, vars: Vars, dflt = 0): { v: number; err?: string } {
  try { return { v: evalExpr(src, vars) }; } catch (e) { return { v: dflt, err: (e as Error).message }; }
}
