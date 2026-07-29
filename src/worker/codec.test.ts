import { describe, expect, it } from 'vitest';
import { decodeTicks, encodeTicks, WIRE_MAGIC, type WireTick } from './codec.ts';
import { mulberry32 } from '../sim/model.ts';

function tick(index: number, seq: number, rng: () => number): WireTick {
  return {
    index,
    seq,
    mid: 1 + rng() * 5000,
    bid: 1 + rng() * 5000,
    ask: 1 + rng() * 5000,
    bidSize: Math.round(rng() * 40000),
    askSize: Math.round(rng() * 40000),
    last: 1 + rng() * 5000,
    high: 1 + rng() * 6000,
    low: rng() * 1000,
    volume: Math.round(rng() * 1e7),
  };
}

describe('wire codec', () => {
  it('round-trips an empty frame', () => {
    const buf = encodeTicks([]);
    expect(buf.byteLength).toBe(8);
    expect(decodeTicks(buf)).toEqual([]);
  });

  it('round-trips ticks bit-exactly', () => {
    const rng = mulberry32(7);
    const ticks = Array.from({ length: 257 }, (_, i) => tick(i * 3, i + 1, rng));
    const decoded = decodeTicks(encodeTicks(ticks));
    expect(decoded).toEqual(ticks); // f64 fields must survive exactly
  });

  // Property: any seeded batch survives the wire unchanged.
  it('property: random batches round-trip for many seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = mulberry32(seed);
      const n = Math.floor(rng() * 64);
      const ticks = Array.from({ length: n }, () =>
        tick(Math.floor(rng() * 5000), Math.floor(rng() * 1e6), rng),
      );
      expect(decodeTicks(encodeTicks(ticks))).toEqual(ticks);
    }
  });

  it('rejects foreign magic, truncation and short buffers without throwing', () => {
    const good = encodeTicks([tick(1, 1, mulberry32(1))]);
    const bad = good.slice(0);
    new DataView(bad).setUint32(0, 0xdeadbeef, true);
    expect(decodeTicks(bad)).toBeNull();
    expect(decodeTicks(good.slice(0, good.byteLength - 1))).toBeNull();
    expect(decodeTicks(new ArrayBuffer(4))).toBeNull();
    expect(new DataView(good).getUint32(0, true)).toBe(WIRE_MAGIC);
  });
});
