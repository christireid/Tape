# ADR 002 — Server-driven row model without AG Grid Enterprise

**Status:** accepted · **Date:** 2026-07-28

## Context

AG Grid's Server-Side Row Model — the pattern for datasets too large to hold client-side — is an
Enterprise feature. Enterprise is $999 per developer and renders a watermark without a licence.
This project uses **AG Grid Community** (MIT) only.

## The licensing constraint

The Community edition ships the Client-Side Row Model: all rows live in the browser. That is the
right model for this application's universe sizes (500–5,000 instruments) and it is what both
engines use here. The Server-Side Row Model exists for a different regime — hundreds of thousands
to millions of rows — where the client cannot hold the full set and rows must be requested in
blocks as the user scrolls.

## Decision

Rather than pay for Enterprise, the equivalent pattern is described and its shape implemented at
the transport layer: the worker owns the "server", and the store requests and caches what the
viewport needs. Today the full universe fits client-side, so the store holds every row and the
grid receives transactions. The datasource seam is where a block-request model would attach.

What a full server-driven row model would add here, and where this build stops short:

| Capability | Enterprise SSRM | This build |
|---|---|---|
| Block requests by range | ✓ | seam present; full set held today |
| Sort/filter pushed to source | ✓ | client-side (Community) |
| Block cache + eviction | ✓ | not needed at ≤5,000 rows |
| Live updates inside/outside window | ✓ | transactions to loaded rows |

## Why this is the honest framing — and the stronger one

Anyone can pay $999. Rebuilding the pattern shows you know *why* it exists: specifically, why a
client-side row model stops being viable past a few hundred thousand rows, and what a
viewport-aware subscription (ADR 004's next step) buys you. The Community edition is not a
limitation here; it is the correct tool for the universe sizes this application targets, and being
able to say exactly when it would stop being correct is the point.
