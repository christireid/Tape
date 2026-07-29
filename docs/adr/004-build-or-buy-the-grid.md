# ADR 004 — Build or buy the grid

**Status:** accepted · **Date:** 2026-07-28

## Context

The blotter can be built on AG Grid Community or on a virtualizer plus hand-written cells. Both are
implemented here, share the same store, worker and token layer, and are switchable at runtime — so
the comparison can be measured rather than argued.

## Measurements

Headless Chromium, 1600×940, in a containerized runner (results vary with the host — this one is
comparatively generous; a CPU-limited machine widens the gap below). Reproduce with `npm run bench`;
the numbers below are the most recent committed run in `bench/results/`.

<!-- ADR_BENCH_TABLE_START -->
| Engine | Universe | Rate | msgs/sec | rows/sec | FPS | t2s p50 / p95 / p99 |
|---|---|---|---|---|---|---|
| aggrid | 1,200 | 8k | 7,920 | 7,524 | 60 | 20 / 34.8 / 37.2 ms |
| aggrid | 1,200 | 25k | 25,448 | 21,068 | 60 | 24 / 39.3 / 42.4 ms |
| aggrid | 1,200 | 50k | 49,240 | 34,394 | 60 | 26.4 / 43.6 / 47.3 ms |
| aggrid | 5,000 | 50k | 51,360 | 45,752 | 59 | 38.5 / 62.4 / 73.7 ms |
| virtual | 1,200 | 8k | 7,909 | 7,489 | 60 | 18.7 / 31.9 / 34.2 ms |
| virtual | 1,200 | 25k | 25,682 | 21,325 | 60 | 20.7 / 34.7 / 35.8 ms |
| virtual | 1,200 | 50k | 50,140 | 34,450 | 59 | 23.9 / 36 / 38.4 ms |
| virtual | 5,000 | 50k | 50,460 | 44,918 | 54 | 30.1 / 45.4 / 48.7 ms |
<!-- ADR_BENCH_TABLE_END -->

Note on reading the AG Grid latencies: every figure includes the conflation window (16 ms at the
bench setting) and up to 32 ms of `asyncTransactionWaitMillis` — configured delay chosen to protect
the main thread, not raw rendering overhead.

## Fairness

A comparison like this earns the obvious objection — *the library was misconfigured* — so the
configuration and the tunings tried are part of the record.

AG Grid options in force for every measurement (see `src/components/Blotter.tsx`):
`getRowId`; `applyTransactionAsync` with `asyncTransactionWaitMillis: 32`; `enableCellChangeFlash`
on bid/ask/last; row and column virtualisation on (default); `animateRows: false`;
`suppressScrollOnNewData: true`; single-row selection.

Ablations isolating the queue's and the flash's contribution (measured 2026-07-29 via
`npx playwright test --config bench/playwright.bench.ts ablation`; raw JSON committed in
`bench/results/ablation-*.json`):

| Variant | Universe | Rate | FPS | t2s p50 / p95 / p99 |
|---|---|---|---|---|
| Baseline (wait 32 ms, flash on) | 1,200 | 25k | 59 | 25.4 / 41.1 / 48.6 ms |
| `asyncTransactionWaitMillis: 0` | 1,200 | 25k | 60 | 21.6 / 36.8 / 38.9 ms |
| Cell flash disabled | 1,200 | 25k | 60 | 24.6 / 41.1 / 42.8 ms |

Read: removing the async queue wait recovers ~4 ms of p50 and ~10 ms of p99 — that is the queue's
contribution to the published figures, confirming the latencies are partly *configured* delay.
Disabling cell flash is nearly neutral at this load on this host; its paint cost is absorbed while
the frame budget holds. The queue, not the flash, is the tunable that matters.

**Both engines are in the axe gate** (`npm run audit` runs axe on each). The hand-built engine's
accessibility surface is hand-written, and its first dedicated audit proved the point this
paragraph used to caveat: it failed `aria-required-children` (an unlabelled sizer div between
`role="grid"` and its rows, and imperative cells without `gridcell`). Both fixed; the test that
found them is permanent. A library ships this audited; hand-rolling it means finding these
yourself — see the accessibility report.

## Reading the result honestly

On this runner both engines sustain 50,000 msgs/sec, and the comparison is more measured than a
headline collapse — which is the honest thing to report rather than a more dramatic number from a
weaker machine. Read the two columns that actually separate the engines:

- **Latency.** The virtualizer is lower across the whole matrix — its p99 stays at ~34–49 ms while
  AG Grid's climbs from ~37 ms to ~74 ms. At 5,000 instruments AG Grid's tail is roughly **1.5×**
  the virtualizer's, and that gap is stable across committed runs.
- **Frame rate.** Parity within run-to-run noise on this host: across the committed runs each
  engine has measured anywhere from 54 to 61 fps at the heaviest cell, with neither consistently
  ahead. The honest reading is that this runner does not separate the engines on fps — a
  CPU-limited host would, and the mechanism below says in which direction.

Three reasons, and only the first is a fair criticism of the library:

1. **AG Grid processes the whole transaction set; the virtualizer touches only the rows on
   screen.** At 5,000 instruments the grid is doing roughly 100× the work per frame for pixels
   nobody can see. This is the substantive finding, and it is why AG Grid's cost — visible here as
   latency and a small fps dip — grows with the universe while the virtualizer's does not.
2. **The async transaction queue trades latency for main-thread protection.** It adds its wait to
   every AG Grid measurement; that is a deliberate cost the virtualizer does not pay, and part of
   why the AG Grid p50 sits above the virtualizer's throughout.
3. **The virtualizer does far less.** No column resize, no pinning beyond what is hand-written, no
   filter UI, no column menu, no row grouping, no clipboard, no export — roughly 200 lines against a
   library that solves problems this application has not encountered yet.

## Decision

Keep AG Grid as the default. It is what these teams run, and the features it supplies — filtering,
column management, clipboard, export, an audited accessibility surface — are ones a production
blotter eventually needs. Keep the virtualizer as a first-class alternative and publish the numbers
for both.

## Consequences

- At the largest universe the default engine carries a measurably higher latency tail (widening on
  constrained hosts); the status bar reports fps and latency per engine honestly rather than
  hiding it.
- Both engines must be kept working against every store change; the bench matrix runs both, so a
  regression in either fails CI.
- The comparison creates an obligation to keep the fairness record current: any AG Grid option
  change invalidates the published matrix until re-run.

## What this changes in practice

If a production blotter needed 5,000 continuously updating instruments at 50k messages/sec, the
answer is not "tune AG Grid". It is to stop sending updates for rows that are not rendered — a
viewport-aware subscription, so the feed only publishes what the user can see. That fix applies to
either engine and would close most of the gap. It is the next thing to build here.
