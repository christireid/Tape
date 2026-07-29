# Tape

**A real-time front-office blotter that measures its own tick-to-screen latency at up to 50,000 market data messages per second — and publishes the numbers for two rendering engines, then reads the difference between them honestly.**

All market data is synthetic, generated locally by a seeded price model. No real market data, no employer data, no backend required to run the demo.

[![CI](https://github.com/christireid/Tape/actions/workflows/ci.yml/badge.svg)](https://github.com/christireid/Tape/actions/workflows/ci.yml)

**Live demo:** _[deploy target — the local simulator has no backend, so any static host works]_ · **License:** MIT · CI gates: build · typecheck · lint · unit · conformance · a11y · e2e (bench nightly)

![Tape](docs/screenshot.png)

---

## The numbers

Headless Chromium, 1600×940, in a containerized runner. Absolute numbers move with the host; the
comparison between the two engines is what the numbers are for. Reproduce with `npm run bench` —
results are written to `bench/results/` and committed by CI. The table below is populated from the
most recent committed run.

<!-- BENCH_TABLE_START -->
| Engine | Universe | Rate | msgs/sec in | rows/sec out | FPS | tick-to-screen p50 / p95 / p99 |
|---|---|---|---|---|---|---|
| aggrid | 1,200 | 8k | 7,940 | 7,532 | 60 | 21.7 / 35.3 / 43.7 ms |
| aggrid | 1,200 | 25k | 25,498 | 21,176 | 60 | 23.9 / 40 / 42.7 ms |
| aggrid | 1,200 | 50k | 49,560 | 34,654 | 61 | 28.9 / 46.3 / 56.5 ms |
| aggrid | 5,000 | 50k | 49,821 | 44,416 | 57 | 39 / 63.4 / 80.6 ms |
| virtual | 1,200 | 8k | 8,074 | 7,629 | 60 | 18.7 / 33.5 / 35.3 ms |
| virtual | 1,200 | 25k | 25,315 | 21,077 | 60 | 20.7 / 34.9 / 37.5 ms |
| virtual | 1,200 | 50k | 49,981 | 34,521 | 60 | 24.9 / 36.9 / 40 ms |
| virtual | 5,000 | 50k | 49,960 | 44,344 | 60 | 29.4 / 44.7 / 48.4 ms |
<!-- BENCH_TABLE_END -->

Two readings worth stating plainly. First, the AG Grid latencies include deliberate delay — the
conflation window (16 ms default) plus up to 32 ms of async transaction wait — so the p50 is
largely configuration, not raw overhead. Second, the engines separate on **latency**, not a frame-
rate collapse on this runner: the hand-built engine's tail stays ~35–48 ms across the matrix while
AG Grid's climbs to ~81 ms at 5,000 instruments, where AG Grid also dips to 57 fps. That is not a
claim the library is slow — it does far less — and
[ADR 004](docs/adr/004-build-or-buy-the-grid.md) reads the comparison honestly, including what
would close the gap for either engine and why a CPU-limited host widens it.

60-second soak at 25,000 msgs/sec: heap sampled every second, min/max/slope reported
(`usedJSHeapSize`, Chromium-only). Sequence gaps in steady state: 0. Console errors across a full
interaction pass: 0.

**Tick-to-screen is measured properly**, which is the only reason the comparison means anything —
one absolute clock across the worker boundary, closed after the grid transaction queue flushes and
the frame paints, both ends of each batch sampled, the first 3 seconds discarded.
[ADR 003](docs/adr/003-tick-to-screen-measurement.md) covers the three ways this is easy to get
wrong. Full methodology: [docs/performance-methodology.md](docs/performance-methodology.md).

---

## What it does

- **Blotter** over 500–5,000 instruments with pinned columns, cell flashing, a zero-centred
  change-magnitude bar, and two interchangeable rendering engines
- **Positions and P&L**, recomputed across the whole book on every tick — in a worker, which is
  [why](docs/adr/001-react-outside-the-render-path.md)
- **Order ticket** with real consequence guards: stale-feed gating, a typed confirmation above
  $250k notional, lot-size and tick-size validation that names the constraint, and an optimistic
  lifecycle that reverts visibly on reject
- **Price tape** on canvas (uPlot), **depth ladder** (top of book from the feed, deeper levels
  labelled as modelled), and a **session range** meter
- **Live telemetry**: throughput in and out, conflation ratio, frame rate, latency percentiles,
  long tasks, gaps recovered, heap
- **Fault injection** from the interface: sequence gap, disconnect, burst
- **Three themes × two densities** from one token layer, switching without remounting the grid
- **Keyboard-first** — fully operable with no mouse, command palette, discoverable key map

---

## Architecture

```
 Web Worker                                 Main thread
 ────────────────────────────────           ──────────────────────────────────
 transport (simulator | WebSocket)
      ↓ decode
 per-instrument sequence check
      ↓ gap → resync from book
 conflation (last-value-wins)
      ↓ one flush per window
 positions + P&L recompute      ───────►    store (plain object, outside React)
      ↓ Int32Array ids                             ├─► grid transactions (hot path)
      └ Float64Array values (transferred)          ├─► canvas draw
                                                   └─► React chrome @ ~4 Hz
```

**React renders the shell. React does not render prices.** Exactly one hook (`useSlowTick`)
subscribes React to the store's 4 Hz channel. That boundary is the architectural argument of the
project.

---

## Running it

```bash
npm install
npm run dev            # http://localhost:5180
npm run build

npm test               # unit + component (Vitest)
npm run conformance    # design conformance checks
npm run verify         # axe across 6 theme×density combinations + 60s soak
npm run audit          # interaction pass, accessibility, keyboard, performance
npm run e2e            # end-to-end behaviour
npm run bench          # full benchmark matrix → bench/results/
```

CI runs typecheck, lint, unit tests, build, conformance, verify, audit and e2e on every push, and
the bench matrix nightly. It fails on any console error, axe violation, failed keyboard check, or
design-conformance regression.

---

## Design conformance

The visual bar is enforced the same way the type system is — checks that pass or fail
(`bench/conformance.mjs`):

```
PASS  No raw colour outside the token layer
PASS  Numeric text uses tabular figures
PASS  Sign carried by glyph, not colour alone
PASS  Prices render on the tick grid
PASS  Modelled depth labelled as modelled
PASS  Synthetic data disclosed in the interface
PASS  Theme and density switch without remounting the grid
PASS  Density token drives row height — comfortable row = 30px
PASS  Conflation ratio derived from the displayed counters
```

Accessibility: **zero axe-core WCAG 2 A/AA violations** in dark, light and high-contrast, at both
densities — measured on the AG Grid engine (the default) and re-run against the hand-built engine.
Sign is always carried by shape as well as colour. `aria-live` announces order state transitions
only — announcing every price change at 50 updates/sec would make the application unusable with a
screen reader, and that decision is documented in the
[accessibility report](docs/accessibility-report.md) rather than defaulted into.

---

## Stack

React 19 · TypeScript strict with `noUncheckedIndexedAccess` · Vite · AG Grid **Community** (MIT,
no licence required) · TanStack Virtual · uPlot · Web Workers · Playwright · axe-core.

AG Grid Enterprise features are deliberately not used. The server-driven row model is discussed
directly instead — [ADR 002](docs/adr/002-server-driven-row-model-without-enterprise.md).

---

## Decision records

1. [React is not on the tick path](docs/adr/001-react-outside-the-render-path.md)
2. [Server-driven row model without Enterprise](docs/adr/002-server-driven-row-model-without-enterprise.md)
3. [How tick-to-screen latency is measured](docs/adr/003-tick-to-screen-measurement.md)
4. [Build or buy the grid](docs/adr/004-build-or-buy-the-grid.md)
5. [Canvas charting, not SVG](docs/adr/005-canvas-charting.md)
6. [Conflation strategy](docs/adr/006-conflation-strategy.md)

## Not yet built

Viewport-aware feed subscription (the fix ADR 004 identifies), the WebSocket transport deployment,
the performance-trend page, the case study screen recording, and a first-paint measurement
[target: under 2 s cold — unmeasured]. The local simulator is the default and is a design
decision, not a placeholder: the demo has no backend to fail, no cold start and no cost.
