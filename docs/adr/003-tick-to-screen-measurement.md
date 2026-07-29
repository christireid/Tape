# ADR 003 — How tick-to-screen latency is measured

**Status:** accepted · **Date:** 2026-07-28

## Context

The deliverable of this project is not the blotter; it is the measurement. A tick-to-screen
distribution is only worth publishing if it is measured correctly, and there are three specific
ways to get it wrong — each was wrong in the first pass of the reference build.

## Decision

Tick-to-screen is the wall-clock interval from when a message is produced to when the pixel it
changes has painted. It is captured as follows.

1. **One absolute clock across the worker boundary.** A worker and a window do not share a time
   origin, so comparing `performance.now()` across the boundary is meaningless (it produced a p50
   of hundreds of ms that measured nothing). Each frame is stamped with
   `performance.timeOrigin + performance.now()` — an absolute epoch — and the loop is closed on the
   same absolute clock on the main thread.

2. **Close at the grid flush plus one paint, not the next animation frame.** AG Grid's async
   transaction queue defers DOM work by up to `asyncTransactionWaitMillis`. The measurement closes
   in `onAsyncTransactionsFlushed`, then one `requestAnimationFrame` — the first moment the number
   means what it claims. The hand-built engine closes after its span writes plus one frame.

3. **Sample both ends of the batch.** Ticks inside one conflation flush have a spread of ages: the
   oldest waited the whole window, the newest almost none. Reporting only the newest understates
   latency; only the oldest overstates it. Both ends of every batch are pushed, so the published
   percentiles bracket the real distribution.

## Warm-up discard

The first **3 seconds** are discarded — they cover module evaluation, grid construction and font
loading. Discarding this silently would be dishonest; including it would mislead. The discard is
stated here and in `docs/performance-methodology.md`, and the bench harness re-arms it between
matrix cells.

## Consequence

The AG Grid latencies therefore include the conflation window (16 ms default) plus up to 32 ms of
async transaction wait — configured delay chosen to protect the main thread, not raw rendering
overhead. That decomposition is stated wherever the numbers appear, because 68 ms unexplained
reads as slow while 68 ms decomposed reads as configured.
