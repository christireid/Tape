# ADR 007 — Binary over JSON encoding

**Status:** accepted · **Date:** 2026-07-29

## Context

Two boundaries carry market data, and both are hot:

1. **Worker → main thread**, up to once per conflation window, carrying every changed row.
2. **Feed server → worker** (the WebSocket transport, §5.2), carrying raw ticks at up to
   50,000/sec.

The default encoding on both boundaries would be JSON. At these rates JSON is not a neutral
choice: every message pays string allocation on the sender, parsing on the receiver, and garbage
collection on both — costs that land on the exact threads the architecture exists to protect.

## Decision

Both boundaries are binary.

**Worker → main:** columnar typed arrays (`Int32Array` ids + `Float64Array` values), posted with
their `ArrayBuffer`s in the transfer list. Transfer moves ownership — no copy, no serialisation,
no GC pressure proportional to message size. The layout is defined once in
`src/domain/types.ts` (`FRAME_FIELDS`) and read by index on the main thread.

**Wire (server ↔ worker):** a fixed-layout frame defined in `src/worker/codec.ts` and imported
verbatim by both the feed server and the worker — one codec, two consumers, which is what makes
the transports interchangeable:

```
u32 magic 'TPE1' · u32 count · count × (u32 index · u32 seq · 9 × f64 fields)
```

80 bytes per tick, one `DataView` pass to decode, zero intermediate strings. The magic word
rejects foreign frames cheaply, and `decodeTicks` returns `null` on truncated or corrupt buffers
rather than throwing — a transport must survive garbage without taking the worker down.

**Identity never crosses the wire.** Both ends derive the instrument universe deterministically
from the handshake's `(seed, universe, nowMs)` — the same seeded model, run twice. So the wire
carries numeric indices, not symbols. That determinism is what keeps a tick at 80 bytes; a JSON
tick carrying `"symbol":"EURUSD"` and field names would run 3–4× the size before parse cost.

## What JSON is still for

Control messages: the handshake and rate changes, a few per session, where debuggability beats
throughput. The rule is rate-based, not dogma — binary where messages are proportional to ticks,
JSON where they are proportional to user actions.

## Consequences

- The codec is property-tested for bit-exact round-trips (`src/worker/codec.test.ts`, seeded
  batches across many seeds) — a wire format without round-trip tests is a corruption bug waiting
  for a schema change.
- Field order is load-bearing. Adding a field means bumping the magic word; the decoder's length
  check makes a mismatched peer fail loudly (frames rejected) rather than silently misread.
- The worker's sequencing, conflation and recovery code cannot tell the transports apart — the
  simulator writes quotes directly, the wire decodes into the same quote objects, and everything
  downstream (`checkSequence`, the conflation set, the flush) is shared. That sharing was the
  acceptance test for the transport seam (§5.2), and the disconnect-fault path proves it: a
  dropped socket surfaces as `down`, reconnects with sequence baselines resynced, and the gap
  counter stays at 0.
