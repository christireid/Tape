// Position accounting, pure and testable. Floating point in position keeping is
// where the real bugs live (spec §8), so this is isolated from the worker and
// exercised directly by unit + property tests.

import type { Side } from './types.ts';

export interface Book {
  netQty: number;
  avgCost: number;
  realizedPnl: number;
}

export function emptyBook(): Book {
  return { netQty: 0, avgCost: 0, realizedPnl: 0 };
}

/**
 * Apply a fill. Same-direction fills update weighted average cost; opposing
 * fills realise P&L on the closing quantity and reduce (flipping through zero
 * opens a new position at the fill price).
 */
export function applyFill(b: Book, side: Side, qty: number, price: number): Book {
  const signed = side === 'BUY' ? qty : -qty;
  const next: Book = { ...b };
  if (b.netQty === 0 || Math.sign(b.netQty) === Math.sign(signed)) {
    const newQty = b.netQty + signed;
    next.avgCost =
      (b.avgCost * Math.abs(b.netQty) + price * Math.abs(signed)) / Math.abs(newQty);
    next.netQty = newQty;
  } else {
    const closing = Math.min(Math.abs(signed), Math.abs(b.netQty));
    next.realizedPnl = b.realizedPnl + closing * (price - b.avgCost) * Math.sign(b.netQty);
    const newQty = b.netQty + signed;
    if (newQty !== 0 && Math.sign(newQty) !== Math.sign(b.netQty)) {
      next.avgCost = price;
    }
    next.netQty = newQty;
    if (next.netQty === 0) next.avgCost = 0;
  }
  return next;
}

/** Unrealised P&L at a mark. */
export function unrealised(b: Book, mark: number): number {
  return b.netQty * (mark - b.avgCost);
}
