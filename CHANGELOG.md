# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); the project uses conventional commits.

## [1.1.0] — 2026-07-29

Built from spec v1.1. First public milestone (spec §9, milestone 5+ complete).

### Added

- Synthetic market model with a seeded PRNG, deterministic across platforms; universe sizes
  500 / 1,200 / 5,000 (6 FX, 6 front-month futures, remainder equities).
- **Domain-plausible price anchors**, asserted at bootstrap alongside identifier uniqueness —
  AUDUSD stays below parity, crude in tens of dollars, treasuries near par.
- **Front-month futures symbology derived from the simulated clock** (ESU6 / GCQ6 in July 2026),
  with 10-/30-year treasuries quoted in **32nds**.
- Web worker: transport (local simulator + WebSocket seam), per-instrument sequencing with gap
  detect + resync, last-value-wins conflation, bounded production, position keeping and P&L.
- Store outside React with a single 4 Hz React channel (`useSlowTick`) and a frame channel for the
  grid and canvas.
- Two rendering engines — AG Grid Community and a hand-built TanStack Virtual engine — switchable at
  runtime and both driven from one column model.
- Order ticket with six consequence guards: stale-feed gate, $250k typed-CONFIRM fat-finger gate,
  lot-size and tick-size validation that name the constraint, optimistic lifecycle, palette-only
  flatten.
- Instrumentation: tick-to-screen p50/95/99 on one absolute clock closed at paint, fps from rAF,
  long tasks, throughput, conflation ratio, gaps, heap.
- uPlot canvas price tape, throughput sparklines, depth ladder (feed vs modelled labelled), session
  range meter.
- Three themes × two densities from a three-tier token layer; keyboard-first operation with a
  command palette.
- Bench matrix, design-conformance checks, axe verification across six theme×density combinations,
  a 60 s soak, unit/component/e2e tests, and a CI workflow that gates on all of them.
- Six ADRs and a performance methodology, accessibility report and case study.

### Added later the same day

- **ADR 004 ablations measured**: `asyncTransactionWaitMillis: 0` recovers ~4 ms p50 / ~10 ms p99
  (the queue's contribution); cell flash is near-neutral. Raw JSON committed.
- **Performance-trend page** at `/performance.html`, built statically from the committed
  `bench/results/` history.
- **First paint measured** (`bench/first-paint.mjs`): 292 ms median FCP, 688 ms to live blotter
  data, cold cache, against the 2 s target.
- **Soak heap slope**: the 60 s soak now reports min/max and a least-squares slope over per-second
  samples, and gates on both.
- **Walkthrough recording** (`docs/walkthrough.webm`), reproducible via
  `bench/record-walkthrough.mjs`.

### Added in the follow-up passes

- **WebSocket transport, fully implemented** (§5.2): a Node feed server
  (`npm run feed-server`) running the same seeded price model, and a worker-side
  transport sharing the same binary codec, sequencing and recovery as the
  simulator. Verified live: ticks over the wire through the same conflation
  path, disconnect → down → recovery with 0 false gaps, seamless switch back.
- **Binary wire codec** (`src/worker/codec.ts`) with property-tested bit-exact
  round-trips, and **ADR 007 (binary over JSON encoding)** — completing the
  full six-topic ADR set §11 names.
- Design-review refinements: per-theme flash tint, unambiguous disabled states,
  engine flash parity, copy hygiene in visible UI strings.
- The hand-built engine's first dedicated axe audit found and fixed a real
  `aria-required-children` defect; the both-engine axe gate is permanent.

### Known open items

Tracked honestly in the README "Not yet built" list and the scorecard's definition-of-done table:
viewport-aware feed subscription, public hosting of the feed server, and the public deployment of
the demo itself.
