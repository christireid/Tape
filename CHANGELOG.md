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

### Known open items

Tracked honestly in the README "Not yet built" list and the scorecard's definition-of-done table:
viewport-aware feed subscription, deployed WebSocket transport, performance-trend page, first-paint
measurement, and a recorded walkthrough.
