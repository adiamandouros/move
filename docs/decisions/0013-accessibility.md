# 13. Accessibility is a requirement

Decided 2026-10-16 · In force

## Situation

Wayhop is meant for everyone, including people with accessibility needs and
people in a hurry, and public transport sites often fail both.

## Decision

- Every page meets WCAG 2.2 level AA: clean under axe-core, usable with the
  keyboard alone and with a screen reader, at 200% text, in light and dark,
  in both languages.
- New pages get the axe-core, keyboard and 200% text checks automatically
  ([test/browser/](../../test/browser/README.md)). Contrast is checked from
  the colour tokens (`test/accessibility.test.js`).
- Meaning is never carried by colour alone, nor by a picture alone: each
  map has a list of its stations beside it.
- A region that refreshes by itself, like a stop's arrivals, isn't a live
  region; what screen readers need to hear is said once, through
  `announce()` in [html.js](../../public/js/core/html.js).
- The **Check accessibility** button on `/admin/diagnostics` runs axe-core
  on the live pages.

## What follows

- A feature is designed for the keyboard and screen readers from the start,
  not fixed afterwards.
- Some visual ideas lose to it: scroll snapping on the bus page was dropped
  because it pushed the focused stop partly off screen (WCAG 2.4.11).

## Look again when

- The WCAG version Wayhop follows changes.
