// Exact decimal arithmetic. Quantities, prices and rates are decimal strings with up to 4
// fractional digits, held as BigInt scaled by 10^4. Money is integer agorot (cents).
// No floating point touches a money value.

const SCALE = 10000n;

export function fixed(value) {
  const s = String(value ?? '0').trim().replace(/,/g, '') || '0';
  if (!/^-?\d{1,13}(\.\d{0,8})?$/.test(s)) throw new Error(`מספר לא תקין: "${value}"`);
  const neg = s.startsWith('-');
  const [a, b = ''] = s.replace('-', '').split('.');
  // Round (half away from zero) beyond 4 decimals instead of truncating silently.
  const frac8 = BigInt((b + '00000000').slice(0, 8));
  let v = BigInt(a) * SCALE + frac8 / 10000n;
  if (frac8 % 10000n >= 5000n) v += 1n;
  return neg ? -v : v;
}

export function divRound(n, d) {
  if (d <= 0n) throw new Error('מכנה לא תקין');
  const neg = n < 0n;
  const q = ((neg ? -n : n) + d / 2n) / d;
  return neg ? -q : q;
}

function safe(n) {
  const v = Number(n);
  if (!Number.isSafeInteger(v) || Math.abs(v) > 1e15) throw new Error('הסכום גדול מדי לחישוב בטוח');
  return v;
}

/** Decimal string → agorot */
export const cents = (value) => safe(divRound(fixed(value), 100n));
/** qty × price × percent/100 → agorot, rounded once */
export const lineCents = (q, p, percent = '100') =>
  safe(divRound(fixed(q) * fixed(p) * fixed(percent), 10n ** 12n));
/** agorot × rate% → agorot */
export const pct = (c, rate) => safe(divRound(BigInt(c) * fixed(rate), 1000000n));
/** agorot × ratio(a/b) → agorot */
export const ratio = (c, num, den) => safe(divRound(BigInt(c) * fixed(num), fixed(den)));

export function dec(v) {
  // BigInt scaled → canonical decimal string (trailing zeros trimmed)
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(5, '0');
  let out = s.slice(0, -4) + '.' + s.slice(-4);
  out = out.replace(/\.?0+$/, '');
  return (neg && out !== '0' ? '-' : '') + out;
}
export const norm = (v) => dec(fixed(v));
export const addQ = (a, b) => dec(fixed(a) + fixed(b));
export const subQ = (a, b) => dec(fixed(a) - fixed(b));
export const cmpQ = (a, b) => (fixed(a) > fixed(b) ? 1 : fixed(a) < fixed(b) ? -1 : 0);

const nf2 = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfq = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
/** agorot → "1,234.56" */
export const money = (c) => nf2.format(Number(c) / 100 || 0);
/** decimal string → "1,234.5" */
export const qty = (v) => nfq.format(Number(v || 0));
