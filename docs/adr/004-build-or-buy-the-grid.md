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
| aggrid | 1,200 | 8k | 7,940 | 7,532 | 60 | 21.7 / 35.3 / 43.7 ms |
| aggrid | 1,200 | 25k | 25,498 | 21,176 | 60 | 23.9 / 40 / 42.7 ms |
| aggrid | 1,200 | 50k | 49,560 | 34,654 | 61 | 28.9 / 46.3 / 56.5 ms |
| aggrid | 5,000 | 50k | 49,821 | 44,416 | 57 | 39 / 63.4 / 80.6 ms |
| virtual | 1,200 | 8k | 8,074 | 7,629 | 60 | 18.7 / 33.5 / 35.3 ms |
| virtual | 1,200 | 25k | 25,315 | 21,077 | 60 | 20.7 / 34.9 / 37.5 ms |
| virtual | 1,200 | 50k | 49,981 | 34,521 | 60 | 24.9 / 36.9 / 40 ms |
| virtual | 5,000 | 50k | 49,960 | 44,344 | 60 | 29.4 / 44.7 / 48.4 ms |
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

The published axe-core results are captured on the **AG Grid engine** (the default); the
hand-built engine's accessibility surface is hand-written and re-run through `npm run audit`, but
has not been through the same audit depth — see the accessibility report.

## Reading the result honestly

On this runner both engines sustain 50,000 msgs/sec, and the comparison is more measured than a
headline collapse — which is the honest thing to report rather than a more dramatic number from a
weaker machine. Read the two columns that actually separate the engines:

- **Latency.** The virtualizer is lower across the whole matrix — its p99 stays at 35–48 ms while
  AG Grid's climbs from ~44 ms to ~81 ms. At 5,000 instruments AG Grid's tail is roughly **1.7×**
  the virtualizer's.
- **Frame rate under the largest load.** Both hold ~60 fps at 1,200 instruments; at 5,000×50k
  AG Grid dips to **57 fps** while the virtualizer holds 60. On a CPU-limited host that dip
  deepens — the mechanism below predicts exactly that.

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

- At the largest universe the default engine carries higher latency and a small frame-rate dip
  (widening on constrained hosts); the status bar reports fps and latency per engine honestly
  rather than hiding it.
- Both engines must be kept working against every store change; the bench matrix runs both, so a
  regression in either fails CI.
- The comparison creates an obligation to keep the fairness record current: any AG Grid option
  change invalidates the published matrix until re-run.

## What this changes in practice

If a production blotter needed 5,000 continuously updating instruments at 50k messages/sec, the
answer is not "tune AG Grid". It is to stop sending updates for rows that are not rendered — a
viewport-aware subscription, so the feed only publishes what the user can see. That fix applies to
either engine and would close most of the gap. It is the next thing to build here.
