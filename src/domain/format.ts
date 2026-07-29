// Every number formatter, centralised. Precision rules are one decision here
// rather than scattered across components (spec §6.3).
//
// The typographic minus (U+2212) is used consistently for negative money and
// change — never the hyphen-minus — so decimals align under tabular figures.

const MINUS = '−';

/** Decimal places implied by a tick size. 0.25 → 2, 0.00001 → 5, 1 → 0. */
export function decimalsForTick(tickSize: number): number {
  const s = tickSize.toString();
  const dot = s.indexOf('.');
  if (dot < 0) return 0;
  return s.length - dot - 1;
}

/** Plain decimal price rounded to the instrument's tick grid. */
export function formatDecimalPrice(price: number, tickSize: number): string {
  const d = decimalsForTick(tickSize);
  const neg = price < 0;
  const s = Math.abs(price).toFixed(d);
  return (neg ? MINUS : '') + s;
}

/**
 * Treasury-futures 32nds display, e.g. 110.515625 → `110'165`.
 * The handle is followed by whole 32nds (two digits); when the tick is finer
 * than 1/32 a trailing digit carries the fraction of a 32nd (0 / 5 for halves).
 */
export function format32nds(price: number, tickSize: number): string {
  const neg = price < 0;
  const p = Math.abs(price);
  const whole = Math.floor(p);
  const ticks32 = (p - whole) * 32;
  const fullTicks = Math.floor(ticks32 + 1e-9);
  const frac = ticks32 - fullTicks;
  let out = `${neg ? MINUS : ''}${whole}'${String(fullTicks).padStart(2, '0')}`;
  if (tickSize < 1 / 32 - 1e-9) {
    out += String(Math.round(frac * 10)); // 0.5 → 5, 0.25 → 3, 0.75 → 8
  }
  return out;
}

/** Dispatch on the instrument's declared price format. */
export function formatPrice(
  price: number,
  tickSize: number,
  fmt: 'decimal' | '32nds',
): string {
  return fmt === '32nds'
    ? format32nds(price, tickSize)
    : formatDecimalPrice(price, tickSize);
}

/** Signed change on the tick grid, always carrying an explicit sign glyph. */
export function formatChange(
  change: number,
  tickSize: number,
  fmt: 'decimal' | '32nds',
): string {
  const glyph = change > 0 ? '+' : change < 0 ? MINUS : '·';
  if (fmt === '32nds') {
    // Express the change itself in 32nds magnitude.
    const p = Math.abs(change);
    const whole = Math.floor(p);
    const ticks32 = (p - whole) * 32;
    const full = Math.floor(ticks32 + 1e-9);
    return `${glyph}${whole > 0 ? whole + "'" : ''}${full}`;
  }
  const d = decimalsForTick(tickSize);
  return `${glyph}${Math.abs(change).toFixed(d)}`;
}

/** Percent change with an explicit sign, clamped for display sanity elsewhere. */
export function formatPercent(pct: number, decimals = 2): string {
  const glyph = pct > 0 ? '+' : pct < 0 ? MINUS : '·';
  return `${glyph}${Math.abs(pct).toFixed(decimals)}%`;
}

const moneyFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const moneyFmt2 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Money with a currency symbol and a typographic minus. */
export function formatMoney(v: number, decimals: 0 | 2 = 0): string {
  const neg = v < 0;
  const fmt = decimals === 2 ? moneyFmt2 : moneyFmt;
  return (neg ? MINUS : '') + '$' + fmt.format(Math.abs(v));
}

/** Signed money (leading + or −) for P&L columns. The sign is decided after
 * rounding, so a sub-unit value never renders as "−$0". */
export function formatSignedMoney(v: number, decimals: 0 | 2 = 0): string {
  const fmt = decimals === 2 ? moneyFmt2 : moneyFmt;
  const magnitude = fmt.format(Math.abs(v));
  const isZero = Number(magnitude.replace(/,/g, '')) === 0;
  const glyph = isZero ? '·' : v > 0 ? '+' : MINUS;
  return `${glyph}$${magnitude}`;
}

const compactFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Compact size notation for order/quote sizes: 1200 → 1.2K. */
export function formatSize(v: number): string {
  if (Math.abs(v) < 1000) return String(Math.round(v));
  return compactFmt.format(v);
}

const intFmt = new Intl.NumberFormat('en-US');

/** Grouped integer for volume and counters. */
export function formatInt(v: number): string {
  return intFmt.format(Math.round(v));
}

/** Signed integer quantity with a typographic minus. */
export function formatQty(v: number): string {
  const neg = v < 0;
  return (neg ? MINUS : '') + intFmt.format(Math.abs(v));
}

/** Colour class for a signed money value, consistent with formatSignedMoney:
 * the sign — and therefore the colour — is decided after rounding, so a value
 * that displays as zero is never tinted. */
export function signClassMoney(v: number): string {
  if (Math.abs(v) < 0.5) return '';
  return v > 0 ? 'pos' : 'neg';
}

/** Data-age for the status bar. */
export function formatAge(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
