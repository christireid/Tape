# Accessibility report

Banks reliably require WCAG; funds essentially never mention it. Solving accessibility in a dense,
real-time context is the distinguishing part — so it is documented here, including the deliberate
deviations, rather than asserted in a badge.

Write **WCAG unversioned** in prose (the versioned form appears in none of the fintech postings
surveyed); the automated target below is WCAG 2 A + AA because that is what axe-core checks.

## Automated (axe-core)

`npm run verify` runs axe-core across all six theme × density combinations — dark, light and
high-contrast, each at compact and comfortable density — on the AG Grid engine (the default). The
gate is **zero WCAG 2 A/AA violations**, and CI fails on any. The hand-built virtual engine is
re-run through the same `npm run audit` axe pass; its accessibility surface is hand-written and has
not been through the same audit depth as the library's, which is stated plainly in
[ADR 004](adr/004-build-or-buy-the-grid.md) rather than glossed.

Two classes of finding were fixed during the build and are worth recording because the token layer
made them one-line corrections:

- **Contrast.** Every text token clears 4.5:1 against its surface in every theme. The muted grey
  is where this fails first; it is a single token, lifted once. Negative-money text was similarly
  lifted so red figures clear 4.5:1 on alternating rows.
- **Scrollable regions.** Display-only scroll regions (charts, tables) carry `tabIndex={0}` and an
  accessible name, or they are keyboard traps for anyone not using a mouse.

## Manual keyboard walkthrough

The application is fully operable with no mouse (spec §1.1.7 — how these users actually work):

- `⌘K` / `Ctrl+K` opens the command palette focused; arrow keys navigate, Enter runs, Escape
  closes and restores focus to the prior element.
- `/` focuses the blotter filter; `B` / `S` set the order side; `D` toggles density; `T` cycles
  theme; `G` / `X` inject a gap / disconnect; `?` opens the key map; `Esc` dismisses overlays.
- Shortcuts are suppressed while a text input has focus, so typing a filter never triggers a
  command.
- Every command in the palette is also reachable by shortcut or control — the palette is discovery,
  not the only path.

## Screen-reader behaviour

- Order state transitions and fills are announced through a visually-hidden `role="status"`
  region; validation errors carry `role="alert"`.
- The session range is a `role="meter"` with an `aria-valuetext` that reads as a sentence.
- The command palette is a `role="listbox"`/dialog with `aria-activedescendant`.

## Deliberate deviations (with justification)

- **Prices are not announced.** Announcing every price change at up to 50 updates/sec would destroy
  a screen-reader session — the assistive technology would never finish reading one value before
  the next arrived. Only order-state transitions and fills are announced; they are batched and
  debounced. This is the one deviation an accessibility-literate reviewer will ask about, and the
  reasoning — not a default — is the answer.
- **The blotter is a data grid, not a document.** It uses grid semantics (`role="grid"`,
  row/column indices) and roving focus rather than exposing 5,000 rows to the tab order.

## Not yet done

A full screen-reader session log (NVDA / VoiceOver transcripts) is planned; the automated axe pass
and the manual keyboard walkthrough are complete and gated in CI.
