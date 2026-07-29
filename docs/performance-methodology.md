# Performance methodology

How every number this project publishes is produced. If a claim is not reproducible by the steps
here, it is a bug in this document.

## Machine

Headless Chromium (the revision Playwright pins), viewport 1600×940, in a containerized runner.
Absolute numbers move with the host — a CPU-limited machine is slower and widens the engine gap;
the comparison between engines is what the numbers are for. The machine is restated wherever
numbers appear.

## Reproduce

```bash
npm run bench          # full matrix, both engines → bench/results/<ISO-timestamp>.json
npm run verify         # axe across 6 theme×density combinations + 60s soak
npm run audit          # interaction pass, a11y, keyboard, performance
npm run conformance    # design conformance
```

CI runs `verify`, `audit`, `conformance` and `e2e` on every push and `bench` nightly, committing
each bench run to `bench/results/`. The README's table is generated from the most recent committed
run.

## Tick-to-screen

The full derivation is [ADR 003](adr/003-tick-to-screen-measurement.md). In one paragraph: each
worker frame is stamped with an absolute epoch clock (`performance.timeOrigin + performance.now()`)
at both the oldest and newest tick in the batch; the main thread closes the interval after the
grid's async transaction queue flushes (`onAsyncTransactionsFlushed`) plus one
`requestAnimationFrame`, for the AG Grid engine, and after the span writes plus one frame for the
hand-built engine. Both ends of every batch are recorded, so the published p50/p95/p99 bracket the
real spread rather than reporting only the best or worst case. The first **3 seconds** are
discarded as warm-up (module evaluation, grid construction, font loading), and the bench harness
re-arms that discard between matrix cells.

**Reading the AG Grid latencies.** Every AG Grid figure includes the conflation window (16 ms at
the bench setting) plus up to 32 ms of `asyncTransactionWaitMillis` — roughly 48 ms of *chosen*
delay to protect the main thread, not raw rendering overhead. Stated, the p50 reads as configured;
unstated, it would read as slow.

## Frames per second

Sampled from `requestAnimationFrame` on the main thread over a 500 ms sliding window — **not**
inferred from the feed flush rate. FPS is reported per engine alongside the "sustains load"
criterion, not gated by it: "sustains" means correct and stable under load, and the published FPS
says how gracefully each engine holds up.

## Throughput and conflation ratio

`msgs/sec in` counts the raw stream before conflation; `rows/sec out` counts distinct instruments
emitted after conflation. The conflation ratio shown in the UI is `msgs-in / rows-out`, computed
from exactly those two displayed counters and rendered to one decimal. `bench/conformance.mjs`
recomputes it from the displayed counters and fails on a mismatch beyond rounding.

## Heap

`performance.memory.usedJSHeapSize` (Chromium-only; labelled `n/a` elsewhere), sampled **every
second** across the 60 s soak, reporting min / max / slope rather than only the two ends. Two-end
sampling can hide a sawtooth that a GC happens to reset at second 59; a slope over 60 samples
cannot. The soak asserts bounded growth.

## Long tasks

Counted via a `PerformanceObserver` on `longtask`. Where the entry type is unavailable the counter
reports `n/a` rather than fabricating a zero.

## What is not yet measured

First paint on a cold cache (target: under 2 s — unmeasured), and the performance-trend page that
would chart `bench/results/` history over time. Both are named in the README's "Not yet built"
list rather than implied to exist.
