import { describe, expect, it } from 'vitest';
import {
  decimalsForTick,
  format32nds,
  formatChange,
  formatInt,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQty,
  formatSignedMoney,
  formatSize,
} from './format.ts';

describe('decimalsForTick', () => {
  it('derives decimals from the tick size', () => {
    expect(decimalsForTick(0.25)).toBe(2);
    expect(decimalsForTick(0.00001)).toBe(5);
    expect(decimalsForTick(0.01)).toBe(2);
    expect(decimalsForTick(0.1)).toBe(1);
    expect(decimalsForTick(1)).toBe(0);
  });
});

describe('format32nds', () => {
  it('renders whole 32nds', () => {
    // 110 + 16/32 = 110.5
    expect(format32nds(110.5, 1 / 32)).toBe("110'16");
  });
  it('renders half 32nds with a trailing 5 for the 1/64 tick', () => {
    // 110 + 16.5/32 = 110.515625
    expect(format32nds(110.515625, 1 / 64)).toBe("110'165");
  });
  it('carries a typographic minus', () => {
    expect(format32nds(-110.5, 1 / 32)).toBe("−110'16");
  });
});

describe('formatPrice', () => {
  it('rounds decimals to tick precision', () => {
    expect(formatPrice(1.234567, 0.00001, 'decimal')).toBe('1.23457');
    expect(formatPrice(5732.25, 0.25, 'decimal')).toBe('5732.25');
  });
});

describe('grouping and compact notation', () => {
  it('groups thousands', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1000)).toBe('1,000');
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(-1234567)).toBe('−1,234,567');
    expect(formatQty(-1500)).toBe('−1,500');
  });

  it('renders compact sizes the way a blotter does', () => {
    expect(formatSize(0)).toBe('0');
    expect(formatSize(900)).toBe('900');
    expect(formatSize(1000)).toBe('1K');
    expect(formatSize(1200)).toBe('1.2K');
    expect(formatSize(12000)).toBe('12K');
    expect(formatSize(125800)).toBe('126K');
    expect(formatSize(1234567)).toBe('1.2M');
    expect(formatSize(-2500)).toBe('-2.5K');
  });

  // Regression: these formatters were once built on Intl.NumberFormat at module
  // scope, which throws "Incorrect locale information provided" on runtimes with
  // reduced ICU data — taking the whole app down at module evaluation. Output
  // must depend on nothing but the input.
  it('produces identical output regardless of host locale data', () => {
    expect(formatMoney(1234567)).toBe('$1,234,567');
    expect(formatMoney(1234.5, 2)).toBe('$1,234.50');
    expect(formatSignedMoney(-9876543)).toBe('−$9,876,543');
  });
});

describe('signed formatters', () => {
  it('uses an explicit sign glyph and a typographic minus', () => {
    expect(formatPercent(0.06)).toBe('+0.06%');
    expect(formatPercent(-0.06)).toBe('−0.06%');
    expect(formatPercent(0)).toBe('·0.00%');
    expect(formatMoney(-262)).toBe('−$262');
    expect(formatSignedMoney(23561)).toBe('+$23,561');
    // sign decided after rounding — a sub-unit value never renders as −$0
    expect(formatSignedMoney(-0.3)).toBe('·$0');
    expect(formatSignedMoney(-0.3, 2)).toBe('−$0.30');
    expect(formatChange(0.00053, 0.00001, 'decimal')).toBe('+0.00053');
  });
});
