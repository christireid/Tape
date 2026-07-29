# ADR 001 — React is not on the tick path

**Status:** accepted · **Date:** 2026-07-28

## Context

The blotter receives up to 50,000 market-data messages per second. Positions and P&L are
recomputed across the whole book on every tick. If price updates flowed through React
reconciliation, every tick would cost O(components) of virtual-DOM diffing, and P&L recompute in
a render would cost O(positions) per tick. At these rates that is not survivable on the main
thread.

## Decision

React renders the shell — the panels, the ticket, the controls, the chrome. **React does not
render prices.** The data path is:

1. The worker computes conflated updates and finished position/P&L arrays.
2. It transfers them to a plain store object that lives outside React.
3. The store notifies the grid through a transaction API and the canvas through a draw call —
   neither goes through React.
4. The store notifies React exactly once per ~250 ms (4 Hz) with aggregate figures only.

Exactly one hook, `useSlowTick`, subscribes React to that 4 Hz channel. Nothing in React
subscribes to the frame channel. This is enforced by convention and asserted in review: a second
`onFrame` subscription in a component is an architecture violation.

## Consequences

- Price throughput is decoupled from React's render cost. The grid updates via
  `applyTransactionAsync`; the hand-built engine writes cell text into spans directly.
- The store is mutable and imperative on purpose. It is the boundary between the real-time world
  and the declarative one.
- Testing the hot path means testing the store and worker, not React components — which is where
  the property-based P&L tests live.

## Why P&L is in the worker

P&L is a derived value recomputed on every tick across every position. In a React render that is
O(positions) per tick on the main thread. In the worker the main thread receives a finished
`Float64Array` and does no arithmetic. This is the clearest single piece of evidence that the
architecture was designed by someone who has measured this problem before.
