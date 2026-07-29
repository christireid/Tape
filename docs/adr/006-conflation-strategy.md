# ADR 006 — Conflation strategy (last-value-wins)

**Status:** accepted · **Date:** 2026-07-28

## Context

At 50,000 messages per second the feed produces far more updates than any display can show or any
human can read. A blotter that re-rendered every message would spend its whole budget rendering
prices that are overwritten before a human eye moves. The question is not whether to conflate but
how, and how to prove the conflation is honest.

## Decision

The worker conflates **last-value-wins per instrument, per window**. Within a conflation window,
repeated updates to the same instrument collapse to that instrument's latest state; one flush per
window emits each changed instrument once. The window is runtime-configurable: off (raw) / 16 ms /
50 ms / 100 ms.

- **msgs/sec in** counts the raw stream before conflation.
- **rows/sec out** counts distinct instruments emitted after conflation.
- **conflation ratio** is `msgs-in / rows-out`, derived from exactly those two displayed counters
  and rendered to one decimal.

## Why last-value-wins

For a blotter, only the current price matters — intermediate prints between two frames have no
display value, so keeping the newest and dropping the rest loses nothing a user could perceive.
This differs from a tape or a VWAP calc, where every print matters; those consume the raw stream,
which is why the raw stream is still counted and still available (conflation off).

## Bounded production

The message budget is derived from the *nominal* window, not the measured frame time. Using
measured `dt` compounds: a slow frame produces a larger next frame, which is slower still, which
overshot an 8,000/sec target to ~12,345/sec in the reference build until the clamp was added:

```ts
const window = Math.min(measuredDt, Math.max(conflateMs, 8) * 1.5);
const want   = Math.max(1, Math.round((targetMsgsPerSec * window) / 1000));
```

## Honesty check

Because the thesis of the project is that its numbers can be trusted, the displayed conflation
ratio is recomputed from the displayed counters in `bench/conformance.mjs` and the build fails on
a mismatch beyond rounding. One visibly wrong derived number would cost more than the feature is
worth.
