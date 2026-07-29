# Case study — Tape

## The problem

A front-office blotter is the most-looked-at surface on a trading desk, and the one where "it
feels slow" ends careers of software. The interesting engineering question is not "can you render a
table" — it is "can you render a table that stays honest and responsive while 50,000 messages a
second try to change it, and can you *prove* the responsiveness with numbers a domain reader will
trust." This project is built around the proof, not the table.

## The thesis

**The deliverable is the measurement.** A blotter that looks correct is a portfolio piece; a
blotter with a reproducible tick-to-screen distribution under 50,000 messages per second is a
credential. So the instrumentation was built first and allowed to shape the architecture, rather
than bolted on at the end.

## The three decisions that carry the project

1. **React is not on the tick path.** Prices reach the DOM without passing through React
   reconciliation; P&L is recomputed in a worker so the main thread receives a finished array. This
   is the single architectural boundary the whole design defends ([ADR 001](adr/001-react-outside-the-render-path.md)).
2. **Two engines, measured against each other.** AG Grid Community and a ~200-line hand-built
   virtualizer share one store, one worker, one token layer, and switch at runtime. The comparison
   is data, not opinion — and the data is read honestly, including why the hand-built engine wins
   and what would close the gap for either ([ADR 004](adr/004-build-or-buy-the-grid.md)).
3. **Latency is measured correctly or not claimed.** One absolute clock across the worker boundary,
   closed at grid flush plus paint, both ends of each batch sampled, warm-up discarded and
   documented ([ADR 003](adr/003-tick-to-screen-measurement.md)).

## Rejected alternatives

- **Next.js / SSR.** There is no SEO surface and no server-render benefit for an authenticated
  real-time tool; an SPA is the correct architecture, and being able to say why is worth more than
  the framework. Vite + React, no server.
- **AG Grid Enterprise.** The Server-Side Row Model is the obvious "buy". Instead the pattern is
  described and the Community client-side model is used, which is correct at these universe sizes —
  and knowing exactly when it would stop being correct is the point ([ADR 002](adr/002-server-driven-row-model-without-enterprise.md)).
- **SVG price chart.** SVG charting dies at these update rates — one DOM node per point mutated
  many times a second. The tape is canvas (uPlot); the slow sparklines stay SVG, because the rule
  is "canvas where update-rate × node-count exceeds the frame budget," not "canvas everywhere"
  ([ADR 005](adr/005-canvas-charting.md)).
- **Rendering every message.** Last-value-wins conflation per window; the raw stream is still
  counted and still available, because a tape or VWAP would need it ([ADR 006](adr/006-conflation-strategy.md)).

## What the build taught (the failure modes)

Every one of these was hit while building, and each is now guarded: duplicate instrument ids aliasing price
state and inflating the gap counter; `performance.now()` compared across the worker boundary
producing a meaningless p50; measured-`dt` message production compounding into a 50% overshoot;
queued async transactions resolving against a replaced row set on a universe swap; a CSS
`auto 1fr` panel pushing a zero-height virtualized grid; a muted grey failing contrast by a
single token. The value of writing them down is that the next person — or the next model — expects
them.

## Where it stops, on purpose

The local simulator is the default and a design decision, not a placeholder: the demo has no
backend to fail, no cold start and no cost. Named as not-yet-built rather than hidden: a
viewport-aware feed subscription (the fix that would close the engine gap), the deployed WebSocket
transport, a performance-trend page, a first-paint measurement, and a recorded walkthrough.

## Screen recording

The ~90-second walkthrough is committed at [`docs/walkthrough.webm`](walkthrough.webm) and is
reproducible — `node bench/record-walkthrough.mjs` re-records it against a running build. The
sequence: load → live blotter → engine switch → 5,000 × 50k load → gap and disconnect injection
with visible recovery → an order through the fat-finger gate → theme and density switching → the
command palette flattening the book.
