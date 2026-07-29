// Seeded, deterministic synthetic market model. Isomorphic — no DOM.
//
// Two domain-plausibility invariants are asserted at bootstrap, exactly as
// identifier uniqueness is (spec §5.1):
//   1. every instrument id is unique;
//   2. every anchor mid falls inside a domain-plausible range for its symbol.
// Both throw rather than warn, because aliased state and impossible prices are
// the first two things a domain reader notices.

import type { FeedConfig, Instrument, PriceFormat } from '../domain/types.ts';

// ── PRNG ─────────────────────────────────────────────────────────────────────

/** mulberry32 — small, fast, deterministic across platforms. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function roundToTick(price: number, tick: number): number {
  return Math.round(price / tick) * tick;
}

function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

// ── Futures symbology, derived from the simulated clock ──────────────────────

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];

/** Quarterly cycle H/M/U/Z — next contract month at or after the current one. */
function quarterlyCode(month0: number, year: number): string {
  const cyc = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec (0-indexed)
  let m = cyc.find((x) => x >= month0);
  let y = year;
  if (m === undefined) {
    m = cyc[0]!;
    y += 1;
  }
  return MONTH_CODES[m]! + String(y % 10);
}

/** Monthly cycle — the next delivery month. */
function monthlyCode(month0: number, year: number): string {
  let m = month0 + 1;
  let y = year;
  if (m > 11) {
    m = 0;
    y += 1;
  }
  return MONTH_CODES[m]! + String(y % 10);
}

/** Gold cycle Feb/Apr/Jun/Aug/Oct/Dec — next active month strictly after now. */
function goldCode(month0: number, year: number): string {
  const cyc = [1, 3, 5, 7, 9, 11];
  let m = cyc.find((x) => x >= month0);
  let y = year;
  if (m === undefined) {
    m = cyc[0]!;
    y += 1;
  }
  return MONTH_CODES[m]! + String(y % 10);
}

// ── Anchor ranges (domain-plausible; verify order of magnitude, not live) ────

interface FutureDef {
  root: string;
  name: string;
  min: number;
  max: number;
  tick: number;
  fmt: PriceFormat;
  vol: number;
  cycle: 'quarterly' | 'monthly' | 'gold';
  spreadTicks: number;
}

const FX_DEFS: Array<{
  symbol: string;
  name: string;
  min: number;
  max: number;
  tick: number;
  vol: number;
}> = [
  { symbol: 'EURUSD', name: 'Euro / US Dollar', min: 1.0, max: 1.2, tick: 0.00001, vol: 0.07 },
  { symbol: 'GBPUSD', name: 'Sterling / US Dollar', min: 1.2, max: 1.4, tick: 0.00001, vol: 0.08 },
  { symbol: 'USDJPY', name: 'US Dollar / Yen', min: 130, max: 160, tick: 0.001, vol: 0.09 },
  { symbol: 'AUDUSD', name: 'Aussie / US Dollar', min: 0.6, max: 0.75, tick: 0.00001, vol: 0.09 },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian', min: 1.3, max: 1.45, tick: 0.00001, vol: 0.07 },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', min: 0.85, max: 1.0, tick: 0.00001, vol: 0.07 },
];

const FUTURE_DEFS: FutureDef[] = [
  { root: 'ES', name: 'E-mini S&P 500', min: 5500, max: 7000, tick: 0.25, fmt: 'decimal', vol: 0.16, cycle: 'quarterly', spreadTicks: 1 },
  { root: 'NQ', name: 'E-mini Nasdaq 100', min: 20000, max: 26000, tick: 0.25, fmt: 'decimal', vol: 0.22, cycle: 'quarterly', spreadTicks: 1 },
  { root: 'CL', name: 'WTI Crude Oil', min: 55, max: 95, tick: 0.01, fmt: 'decimal', vol: 0.35, cycle: 'monthly', spreadTicks: 1 },
  { root: 'GC', name: 'Gold', min: 2300, max: 3500, tick: 0.1, fmt: 'decimal', vol: 0.15, cycle: 'gold', spreadTicks: 1 },
  { root: 'ZN', name: '10-Year T-Note', min: 108, max: 116, tick: 1 / 64, fmt: '32nds', vol: 0.06, cycle: 'quarterly', spreadTicks: 1 },
  { root: 'ZB', name: '30-Year T-Bond', min: 118, max: 130, tick: 1 / 32, fmt: '32nds', vol: 0.1, cycle: 'quarterly', spreadTicks: 1 },
];

const SECTORS = [
  'Technology',
  'Financials',
  'Healthcare',
  'Energy',
  'Industrials',
  'Consumer',
  'Materials',
  'Utilities',
  'Real Estate',
  'Communications',
];

// Invented four-letter roots. Deliberately not real NYSE/Nasdaq single-name
// tickers, so a finance reader never mistakes the synthetic universe for real
// names (the 1.0 build collided with EVR / ARC / CDX / DYN — spec §5.1).
const EQUITY_ROOTS = [
  'QVEX', 'ZYRA', 'VELM', 'TORQ', 'KANE', 'PLYX', 'BRYN', 'DWEL',
  'FYNT', 'GLOV', 'HXCO', 'JORB', 'KRYP', 'LUME', 'MVRK', 'NXOR',
  'OVYD', 'PQST', 'RYGL', 'SVEN', 'TWYN', 'UVAX', 'VYNE', 'WQRL',
  'XYLO', 'YBRN', 'ZQAD', 'BLYT', 'CRYV', 'DYNL', 'EQNX', 'FROV',
  'GYRE', 'HULM', 'IVRO', 'JWLT', 'KYND', 'LORV', 'MYPT', 'NRVL',
  'OQLY', 'PVYR', 'QLYN', 'RVND', 'SYLK', 'TVYX', 'UBLY', 'VQOR',
  'WYND', 'XRYT', 'YQVL', 'ZBRN', 'CVEK', 'DFLY', 'GWYN', 'HRVX',
  'JYPT', 'KVLN', 'LWYX', 'MQRA', 'NYLD', 'PBRK', 'RQVN', 'SWYT',
];

const NAME_SUFFIX = [
  'Systems', 'Holdings', 'Dynamics', 'Labs', 'Industries', 'Group',
  'Networks', 'Partners', 'Technologies', 'Capital', 'Materials', 'Works',
];

/** Bijective base-26 (A=1) so distinct block indices map to distinct suffixes. */
function base26(n: number): string {
  if (n <= 0) return '';
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// ── Universe builder ─────────────────────────────────────────────────────────

export function buildUniverse(config: FeedConfig): Instrument[] {
  const rng = mulberry32(config.seed);
  const d = new Date(config.nowMs);
  const month0 = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const instruments: Instrument[] = [];
  let index = 0;

  // FX
  for (const fx of FX_DEFS) {
    const mid = roundToTick(uniform(rng, fx.min, fx.max), fx.tick);
    instruments.push({
      id: fx.symbol,
      index: index++,
      symbol: fx.symbol,
      name: fx.name,
      currency: 'USD',
      tickSize: fx.tick,
      lotSize: 1000,
      assetClass: 'fx',
      sector: 'FX',
      priceFormat: 'decimal',
      vol: fx.vol,
      jumpP: 0.004,
      spreadTicks: 2,
      activity: 1.4,
      anchorMid: mid,
      prevClose: mid,
    });
  }

  // Futures — month code derived from the simulated clock
  for (const f of FUTURE_DEFS) {
    const code =
      f.cycle === 'quarterly'
        ? quarterlyCode(month0, year)
        : f.cycle === 'monthly'
          ? monthlyCode(month0, year)
          : goldCode(month0, year);
    const mid = roundToTick(uniform(rng, f.min, f.max), f.tick);
    instruments.push({
      id: `${f.root}${code}`,
      index: index++,
      symbol: `${f.root}${code}`,
      name: `${f.name} Future`,
      currency: 'USD',
      tickSize: f.tick,
      lotSize: 1,
      assetClass: 'future',
      sector: 'Futures',
      priceFormat: f.fmt,
      vol: f.vol,
      jumpP: 0.006,
      spreadTicks: f.spreadTicks,
      activity: 1.2,
      anchorMid: mid,
      prevClose: mid,
    });
  }

  // Equities — remainder of the universe
  const equityCount = config.universe - instruments.length;
  for (let i = 0; i < equityCount; i++) {
    const root = EQUITY_ROOTS[i % EQUITY_ROOTS.length]!;
    const block = Math.floor(i / EQUITY_ROOTS.length);
    const symbol = root + base26(block);
    // Log-distributed anchor across 5–800.
    const mid = roundToTick(Math.exp(uniform(rng, Math.log(5), Math.log(800))), 0.01);
    const sector = SECTORS[i % SECTORS.length]!;
    const nameWord = NAME_SUFFIX[(i * 7) % NAME_SUFFIX.length]!;
    instruments.push({
      id: symbol,
      index: index++,
      symbol,
      name: `${root.charAt(0) + root.slice(1).toLowerCase()} ${nameWord}`,
      currency: 'USD',
      tickSize: 0.01,
      lotSize: 100,
      assetClass: 'equity',
      sector,
      priceFormat: 'decimal',
      vol: uniform(rng, 0.18, 0.6),
      jumpP: uniform(rng, 0.002, 0.02),
      spreadTicks: 1 + Math.floor(uniform(rng, 0, 4)),
      activity: uniform(rng, 0.4, 1.2),
      anchorMid: mid,
      prevClose: mid,
    });
  }

  assertUniqueIds(instruments);
  assertPlausibleAnchors(instruments);
  return instruments;
}

// ── Bootstrap assertions ─────────────────────────────────────────────────────

export function assertUniqueIds(u: Instrument[]): void {
  const seen = new Set<string>();
  for (const x of u) {
    if (seen.has(x.id)) throw new Error(`duplicate instrument id: ${x.id}`);
    seen.add(x.id);
  }
}

/** Anchor plausibility ranges, keyed by symbol (FX/futures) or asset class. */
export function anchorRangeFor(inst: Instrument): [number, number] {
  const fx = FX_DEFS.find((f) => f.symbol === inst.symbol);
  if (fx) return [fx.min, fx.max];
  const fut = FUTURE_DEFS.find((f) => inst.symbol.startsWith(f.root));
  if (fut && inst.assetClass === 'future') return [fut.min, fut.max];
  return [5, 800]; // equities
}

export function assertPlausibleAnchors(u: Instrument[]): void {
  for (const x of u) {
    const [min, max] = anchorRangeFor(x);
    if (x.anchorMid < min || x.anchorMid > max) {
      throw new Error(
        `implausible anchor for ${x.symbol}: ${x.anchorMid} outside [${min}, ${max}]`,
      );
    }
  }
}

// ── Price process ────────────────────────────────────────────────────────────
// Per instrument, per tick: geometric Brownian motion with a Poisson jump,
// discretised over the elapsed window. Every price is rounded to the tick grid
// at generation.

export interface Quote {
  mid: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  last: number;
  high: number;
  low: number;
  volume: number;
  seq: number;
  prevClose: number;
}

const YEAR_MS = 252 * 6.5 * 3600 * 1000;

export function initQuote(inst: Instrument): Quote {
  const half = (inst.spreadTicks / 2) * inst.tickSize;
  return {
    mid: inst.anchorMid,
    bid: roundToTick(inst.anchorMid - half, inst.tickSize),
    ask: roundToTick(inst.anchorMid + half, inst.tickSize),
    bidSize: 0,
    askSize: 0,
    last: inst.anchorMid,
    high: inst.anchorMid,
    low: inst.anchorMid,
    volume: 0,
    seq: 0,
    prevClose: inst.prevClose,
  };
}

/** Advance one instrument by one tick. Mutates and returns the quote. */
export function stepQuote(
  inst: Instrument,
  q: Quote,
  windowMs: number,
  rng: () => number,
): Quote {
  const dt = windowMs / YEAR_MS;
  const drift = -0.5 * inst.vol * inst.vol * dt;
  const diffuse = inst.vol * Math.sqrt(dt) * gaussian(rng);
  const jump = rng() < inst.jumpP ? (rng() - 0.5) * 0.012 : 0;
  const mid = roundToTick(q.mid * Math.exp(drift + diffuse + jump), inst.tickSize);
  const half = (inst.spreadTicks / 2) * inst.tickSize;
  q.mid = mid;
  q.bid = roundToTick(mid - half, inst.tickSize);
  q.ask = roundToTick(mid + half, inst.tickSize);
  q.bidSize = Math.round(uniform(rng, 1, 40)) * inst.lotSize;
  q.askSize = Math.round(uniform(rng, 1, 40)) * inst.lotSize;
  // Last prints at bid or ask.
  q.last = rng() < 0.5 ? q.bid : q.ask;
  q.high = Math.max(q.high, q.last);
  q.low = Math.min(q.low, q.last);
  q.volume += Math.round(uniform(rng, 1, 12)) * inst.lotSize;
  q.seq += 1;
  return q;
}
