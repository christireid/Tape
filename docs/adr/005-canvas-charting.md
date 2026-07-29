# ADR 005 — Canvas charting, not SVG

**Status:** accepted · **Date:** 2026-07-28

## Context

The price tape redraws several times a second and the throughput sparklines update at 4 Hz. The
price tape holds a 600-point ring buffer and must follow the theme.

## Decision

The price tape is drawn on **canvas** via uPlot. The throughput sparklines, which update slowly
and carry few points, are **SVG** polylines.

## Why canvas for the tape

SVG charting creates one DOM node per point (or per segment). At the tape's update rate and point
count, that is thousands of nodes mutated per second — the browser pays layout and
style-recalculation costs on every frame, and the frame budget disappears into the DOM. Canvas
draws pixels with no retained node graph. uPlot is a canvas plotter built precisely for this
regime: it holds a large time series and redraws in well under a frame.

## Why SVG is fine for the sparklines

The sparklines carry ~120 points and update at 4 Hz. At that rate the DOM cost is negligible and
SVG buys crisp vector rendering and trivial theming (stroke is a CSS variable). Using canvas here
would be over-engineering. The rule is not "canvas everywhere" — it is "canvas where the update
rate × node count exceeds the frame budget."

## Theming

The canvas reads its colours from the computed custom properties (`--accent`, `--text-muted`,
`--border-subtle`) at construction, and is rebuilt on theme change via a `MutationObserver` scoped
to `data-theme`, and resized via a `ResizeObserver`. So the chart follows the token layer without
the token layer knowing the chart exists.
