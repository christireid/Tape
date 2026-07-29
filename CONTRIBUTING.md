# Contributing

Thanks for looking. This is a portfolio-grade reference build; contributions that keep the bar high
are welcome.

## Ground rules that are load-bearing

These are not style preferences — they are the argument of the project. A change that breaks one of
them will not be merged:

1. **React is never on the tick path.** Exactly one hook (`useSlowTick`) subscribes React to the
   store's 4 Hz channel. Do not subscribe a component to `onFrame`.
2. **Numbers must be real.** Every displayed metric is measured, not targeted. Derived numbers
   (e.g. the conflation ratio) are recomputed from their displayed inputs and gated in conformance.
3. **Synthetic data must look domain-plausible and stay on the tick grid.** Anchors and uniqueness
   are asserted at bootstrap and throw, not warn.
4. **Zero console errors, zero axe violations.** Library warnings count.

## Setup

```bash
npm install
npm run dev
```

## Before you open a PR

```bash
npm run typecheck
npm run lint
npm test               # unit + component (Vitest)
npm run build
npm run conformance    # design conformance (needs a built app / Chromium)
```

CI additionally runs `verify` (axe × 6 combinations + 60 s soak), `audit`, `e2e`, and the nightly
`bench`. If you change any AG Grid option, re-run `npm run bench` — it invalidates the published
matrix in [ADR 004](docs/adr/004-build-or-buy-the-grid.md) until re-measured.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `perf:`, `test:`). Keep the subject in
the imperative and under ~72 characters.

## Architecture map

- `src/domain` — types, formatters, pure P&L math (isomorphic, unit-tested).
- `src/sim` — the seeded market model (isomorphic, no DOM).
- `src/worker` — the tick path: transport, sequencing, conflation, positions, P&L.
- `src/store` — the object outside React and all instrumentation.
- `src/components` — the shell, both engines, the ticket, the charts, the chrome.
- `bench` — the measurement and conformance harness.
- `docs/adr` — why the load-bearing decisions were made.
