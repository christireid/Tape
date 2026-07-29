import { describe, expect, it } from 'vitest';
import {
  anchorRangeFor,
  assertPlausibleAnchors,
  assertUniqueIds,
  buildUniverse,
  initQuote,
  mulberry32,
  stepQuote,
} from './model.ts';
import type { FeedConfig } from '../domain/types.ts';

// July 2026 — front months are U6 (Sep) for the quarterly cycle and Q6 (Aug)
// for gold.
const JULY_2026 = Date.UTC(2026, 6, 15);

function cfg(universe: 500 | 1200 | 5000): FeedConfig {
  return {
    universe,
    rate: 8000,
    conflateMs: 16,
    transport: 'simulator',
    seed: 0x9e3779b9,
    nowMs: JULY_2026,
  };
}

describe('PRNG', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('buildUniverse', () => {
  it('has unique ids and plausible anchors at 5000', () => {
    const u = buildUniverse(cfg(5000));
    expect(u.length).toBe(5000);
    expect(() => assertUniqueIds(u)).not.toThrow();
    expect(() => assertPlausibleAnchors(u)).not.toThrow();
  });

  it('composes 6 FX, 6 futures, remainder equities', () => {
    const u = buildUniverse(cfg(1200));
    expect(u.filter((i) => i.assetClass === 'fx').length).toBe(6);
    expect(u.filter((i) => i.assetClass === 'future').length).toBe(6);
    expect(u.filter((i) => i.assetClass === 'equity').length).toBe(1200 - 12);
  });

  it('derives front-month futures codes from the simulated clock', () => {
    const u = buildUniverse(cfg(1200));
    const es = u.find((i) => i.symbol.startsWith('ES'));
    const gc = u.find((i) => i.symbol.startsWith('GC'));
    expect(es?.symbol).toBe('ESU6'); // Sep 2026
    expect(gc?.symbol).toBe('GCQ6'); // Aug 2026
  });

  it('keeps AUDUSD below parity and treasuries in 32nds', () => {
    const u = buildUniverse(cfg(1200));
    const aud = u.find((i) => i.symbol === 'AUDUSD')!;
    expect(aud.anchorMid).toBeLessThan(0.75);
    const [, max] = anchorRangeFor(aud);
    expect(max).toBeLessThan(1);
    const zn = u.find((i) => i.symbol.startsWith('ZN'))!;
    expect(zn.priceFormat).toBe('32nds');
    expect(zn.anchorMid).toBeGreaterThan(100);
  });

  it('generates every price on the tick grid', () => {
    const u = buildUniverse(cfg(500));
    for (const inst of u) {
      const q = initQuote(inst);
      const n = q.mid / inst.tickSize;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
    }
  });

  it('throws on a duplicate id', () => {
    const u = buildUniverse(cfg(500));
    expect(() => assertUniqueIds([u[0]!, u[0]!])).toThrow(/duplicate/);
  });
});

describe('stepQuote', () => {
  it('advances sequence and stays on the tick grid', () => {
    const u = buildUniverse(cfg(500));
    const inst = u[20]!;
    const q = initQuote(inst);
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) stepQuote(inst, q, 16, rng);
    expect(q.seq).toBe(500);
    const n = q.mid / inst.tickSize;
    expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
    expect(q.high).toBeGreaterThanOrEqual(q.low);
  });
});
