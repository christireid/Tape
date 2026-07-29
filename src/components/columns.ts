// Shared column model. Both engines — AG Grid and the hand-built virtualizer —
// render from this single definition, so the comparison is honest: same
// columns, same formatters, same data.

import type { BlotterRow } from '../domain/types.ts';
import {
  formatChange,
  formatInt,
  formatPercent,
  formatPrice,
  formatSize,
} from '../domain/format.ts';

export type Sign = 'up' | 'down' | 'flat';

export function signOf(v: number): Sign {
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
}

export interface ColSpec {
  id: string;
  label: string;
  width: number;
  numeric: boolean;
  pinned?: boolean;
  text: (r: BlotterRow) => string;
  /** semantic sign for colour + glyph, if the column carries direction. */
  sign?: (r: BlotterRow) => Sign;
}

export const COLUMNS: ColSpec[] = [
  { id: 'symbol', label: 'Symbol', width: 92, numeric: false, pinned: true, text: (r) => r.symbol },
  { id: 'name', label: 'Description', width: 196, numeric: false, pinned: true, text: (r) => r.name },
  { id: 'bid', label: 'Bid', width: 104, numeric: true, text: (r) => formatPrice(r.bid, r.tickSize, r.priceFormat) },
  { id: 'bidSize', label: 'BSz', width: 72, numeric: true, text: (r) => formatSize(r.bidSize) },
  { id: 'ask', label: 'Ask', width: 104, numeric: true, text: (r) => formatPrice(r.ask, r.tickSize, r.priceFormat) },
  { id: 'askSize', label: 'ASz', width: 72, numeric: true, text: (r) => formatSize(r.askSize) },
  {
    id: 'last',
    label: 'Last',
    width: 104,
    numeric: true,
    text: (r) => formatPrice(r.last, r.tickSize, r.priceFormat),
    sign: (r) => signOf(r.change),
  },
  {
    id: 'change',
    label: 'Chg',
    width: 104,
    numeric: true,
    text: (r) => formatChange(r.change, r.tickSize, r.priceFormat),
    sign: (r) => signOf(r.change),
  },
  {
    id: 'changePct',
    label: 'Chg %',
    width: 84,
    numeric: true,
    text: (r) => formatPercent(r.changePct),
    sign: (r) => signOf(r.changePct),
  },
  { id: 'changebar', label: 'Δ', width: 84, numeric: true, text: () => '' },
  { id: 'spread', label: 'Spread', width: 96, numeric: true, text: (r) => formatPrice(r.spread, r.tickSize, r.priceFormat) },
  { id: 'high', label: 'High', width: 104, numeric: true, text: (r) => formatPrice(r.high, r.tickSize, r.priceFormat) },
  { id: 'low', label: 'Low', width: 104, numeric: true, text: (r) => formatPrice(r.low, r.tickSize, r.priceFormat) },
  { id: 'volume', label: 'Volume', width: 92, numeric: true, text: (r) => formatInt(r.volume) },
  { id: 'sector', label: 'Sector', width: 118, numeric: false, text: (r) => r.sector },
];

/** Percent change clamped to ±4% so ordinary moves stay readable (§5.3). */
export const CHG_CLAMP = 4;

export function changeBarWidthPct(changePct: number): number {
  const clamped = Math.max(-CHG_CLAMP, Math.min(CHG_CLAMP, changePct));
  return (Math.abs(clamped) / CHG_CLAMP) * 50;
}
