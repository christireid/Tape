import { describe, expect, it } from 'vitest';
import { applyFill, emptyBook, unrealised, type Book } from './pnl.ts';
import { mulberry32 } from '../sim/model.ts';

describe('applyFill', () => {
  it('opens a position at the fill price', () => {
    const b = applyFill(emptyBook(), 'BUY', 100, 10);
    expect(b.netQty).toBe(100);
    expect(b.avgCost).toBe(10);
    expect(b.realizedPnl).toBe(0);
  });

  it('averages same-direction fills', () => {
    let b = applyFill(emptyBook(), 'BUY', 100, 10);
    b = applyFill(b, 'BUY', 100, 20);
    expect(b.netQty).toBe(200);
    expect(b.avgCost).toBe(15);
  });

  it('realises P&L on a closing fill', () => {
    let b = applyFill(emptyBook(), 'BUY', 100, 10);
    b = applyFill(b, 'SELL', 60, 15);
    expect(b.netQty).toBe(40);
    expect(b.avgCost).toBe(10);
    expect(b.realizedPnl).toBeCloseTo(60 * 5, 9);
  });

  it('flips through zero to a new short at the fill price', () => {
    let b = applyFill(emptyBook(), 'BUY', 100, 10);
    b = applyFill(b, 'SELL', 150, 12);
    expect(b.netQty).toBe(-50);
    expect(b.avgCost).toBe(12);
    expect(b.realizedPnl).toBeCloseTo(100 * 2, 9);
  });

  it('unrealised marks against the current price', () => {
    const b: Book = { netQty: -50, avgCost: 12, realizedPnl: 0 };
    expect(unrealised(b, 11)).toBeCloseTo(50, 9);
  });

  // Property: a round trip that returns to flat realises exactly (exit-entry)*qty
  // and leaves no residual position, for random sequences.
  it('property: closing to flat conserves realised P&L', () => {
    const rng = mulberry32(42);
    for (let t = 0; t < 200; t++) {
      const qty = 1 + Math.floor(rng() * 100);
      const entry = 1 + rng() * 100;
      const exit = 1 + rng() * 100;
      let b = applyFill(emptyBook(), 'BUY', qty, entry);
      b = applyFill(b, 'SELL', qty, exit);
      expect(b.netQty).toBe(0);
      expect(b.realizedPnl).toBeCloseTo(qty * (exit - entry), 6);
    }
  });
});
