# Tape

**A real-time front-office blotter that measures its own tick-to-screen latency at up to 50,000 market data messages per second — and publishes the numbers for two rendering engines, then reads the difference between them honestly.**

All market data is synthetic, generated locally by a seeded price model. No real market data, no employer data, no backend required to run the demo.

[![CI](https://github.com/christireid/Tape/actions/workflows/ci.yml/badge.svg)](https://github.com/christireid/Tape/actions/workflows/ci.yml)

**Live demo:** deploys to GitHub Pages on merge to `main` via
[`deploy-pages.yml`](.github/workflows/pages.yml) — the build is fully static (relative base, no
backend), so it serves from any static host. · **License:** MIT · CI gates: build · typecheck ·
lint · unit · conformance · a11y · e2e (bench nightly)

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
| aggrid | 1,200 | 8k | 7,920 | 7,524 | 60 | 20 / 34.8 / 37.2 ms |
| aggrid | 1,200 | 25k | 25,448 | 21,068 | 60 | 24 / 39.3 / 42.4 ms |
| aggrid | 1,200 | 50k | 49,240 | 34,394 | 60 | 26.4 / 43.6 / 47.3 ms |
| aggrid | 5,000 | 50k | 51,360 | 45,752 | 59 | 38.5 / 62.4 / 73.7 ms |
| virtual | 1,200 | 8k | 7,909 | 7,489 | 60 | 18.7 / 31.9 / 34.2 ms |
| virtual | 1,200 | 25k | 25,682 | 21,325 | 60 | 20.7 / 34.7 / 35.8 ms |
| virtual | 1,200 | 50k | 50,140 | 34,450 | 59 | 23.9 / 36 / 38.4 ms |
| virtual | 5,000 | 50k | 50,460 | 44,918 | 54 | 30.1 / 45.4 / 48.7 ms |
<!-- BENCH_TABLE_END -->

Two readings worth stating plainly. First, the AG Grid latencies include deliberate delay — the
conflation window (16 ms default) plus up to 32 ms of async transaction wait — so the p50 is
largely configuration, not raw overhead. Second, on this runner the engines separate on
**latency**, not frame rate: fps is parity-within-noise across committed runs (both engines hold
54–60 at the heaviest cell, varying run to run), while the latency gap is durable — the hand-built
engine's p99 stays ~34–49 ms across the matrix and AG Grid's climbs to ~74 ms at 5,000
instruments, roughly **1.5×** the virtualizer's tail. That is not a claim the library is slow — it
does far less — and [ADR 004](docs/adr/004-build-or-buy-the-grid.md) reads the comparison
honestly, including what would close the gap for either engine and why a CPU-limited host widens
it.

60-second soak at 25,000 msgs/sec: heap **6.7 MB → 6.7 MB, slope 0.00 MB/min** over 60 per-second
samples (`usedJSHeapSize`, Chromium-only). Sequence gaps in steady state: 0. Console errors across
a full interaction pass: 0. Cold-cache first paint: **292 ms median FCP, 688 ms to live data**.

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
npm run verify         # axe across 6 theme×density combinations + 60s soak (heap min/max/slope)
npm run audit          # interaction pass, accessibility, keyboard, performance
npm run e2e            # end-to-end behaviour
npm run bench          # full benchmark matrix → bench/results/
npm run feed-server    # WebSocket feed server (ws://127.0.0.1:8181) for the second transport
```

The **performance-trend page** at `/performance.html` charts every committed bench run (built from
`bench/results/` at build time — static, no backend). `bench/first-paint.mjs` measures cold-cache
first paint; `bench/record-walkthrough.mjs` reproduces the walkthrough recording; the ablation
variants in [ADR 004](docs/adr/004-build-or-buy-the-grid.md) run via `?ablate=wait0` / `?ablate=noflash`.

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
densities — and the axe gate runs against **both engines**. Adding the hand-built engine to the
gate immediately found a real defect in its hand-written grid semantics (`aria-required-children`),
now fixed with the test kept — the [accessibility report](docs/accessibility-report.md) tells that
story. Sign is always carried by shape as well as colour. `aria-live` announces order state transitions
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
7. [Binary over JSON encoding](docs/adr/007-binary-over-json.md)

## Not yet built

Viewport-aware feed subscription (the fix ADR 004 identifies), and the public deployment itself
(a hosting decision — the demo needs only a static host; cold first paint is already measured at
**292 ms median FCP, 688 ms to live data** via `bench/first-paint.mjs`). The WebSocket transport
itself **is** built — `npm run feed-server` starts the Node feed server, and the worker's
transport shares the binary codec, sequencing and recovery with the simulator
([ADR 007](docs/adr/007-binary-over-json.md)); only its public hosting (a persistent VM, not a
function platform) remains a deployment decision. The local simulator is the default and is a
design decision, not a placeholder: the demo has no backend to fail, no cold start and no cost.
