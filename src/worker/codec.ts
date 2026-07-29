// The wire codec, shared verbatim by the WebSocket feed server and the worker's
// WebSocketTransport. Binary, not JSON — at 50,000 ticks/sec a JSON codec pays
// string allocation, parsing and GC on every message; this layout is a single
// DataView pass with zero intermediate strings (ADR 007).
//
// Both ends derive the instrument universe deterministically from the same
// (seed, universe, nowMs), so the wire only ever carries numeric indices —
// identity never crosses the wire, which is what keeps a tick at 80 bytes.
//
// Frame layout (little-endian):
//   u32 magic 'TPE1'   — rejects foreign/corrupt frames cheaply
//   u32 count          — ticks in this frame
//   count × 80 bytes   — u32 index · u32 seq · f64 mid,bid,ask,bidSize,
//                        askSize,last,high,low,volume

export const WIRE_MAGIC = 0x54504531; // 'TPE1'

const HEADER_BYTES = 8;
const TICK_BYTES = 4 + 4 + 9 * 8; // 80

export interface WireTick {
  index: number;
  seq: number;
  mid: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  last: number;
  high: number;
  low: number;
  volume: number;
}

export function encodeTicks(ticks: readonly WireTick[]): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + ticks.length * TICK_BYTES);
  const view = new DataView(buf);
  view.setUint32(0, WIRE_MAGIC, true);
  view.setUint32(4, ticks.length, true);
  let o = HEADER_BYTES;
  for (const t of ticks) {
    view.setUint32(o, t.index, true);
    view.setUint32(o + 4, t.seq, true);
    view.setFloat64(o + 8, t.mid, true);
    view.setFloat64(o + 16, t.bid, true);
    view.setFloat64(o + 24, t.ask, true);
    view.setFloat64(o + 32, t.bidSize, true);
    view.setFloat64(o + 40, t.askSize, true);
    view.setFloat64(o + 48, t.last, true);
    view.setFloat64(o + 56, t.high, true);
    view.setFloat64(o + 64, t.low, true);
    view.setFloat64(o + 72, t.volume, true);
    o += TICK_BYTES;
  }
  return buf;
}

/** Decode a frame. Returns null (never throws) on a foreign or truncated
 * buffer — a transport must survive garbage without taking the worker down. */
export function decodeTicks(buf: ArrayBuffer): WireTick[] | null {
  if (buf.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== WIRE_MAGIC) return null;
  const count = view.getUint32(4, true);
  if (buf.byteLength !== HEADER_BYTES + count * TICK_BYTES) return null;
  const out: WireTick[] = new Array(count);
  let o = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    out[i] = {
      index: view.getUint32(o, true),
      seq: view.getUint32(o + 4, true),
      mid: view.getFloat64(o + 8, true),
      bid: view.getFloat64(o + 16, true),
      ask: view.getFloat64(o + 24, true),
      bidSize: view.getFloat64(o + 32, true),
      askSize: view.getFloat64(o + 40, true),
      last: view.getFloat64(o + 48, true),
      high: view.getFloat64(o + 56, true),
      low: view.getFloat64(o + 64, true),
      volume: view.getFloat64(o + 72, true),
    };
    o += TICK_BYTES;
  }
  return out;
}
