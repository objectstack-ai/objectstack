---
"@objectstack/spec": patch
---

docs(spec): alias guidance for `visible` / `showWhen` on the `page:tabs` item and screen-field `visibleWhen` shapes (#8382)

#7832 curated the `visible` / `showWhen` action-side spellings onto `visibleWhen`
across six shapes, pinning the inventory in `visible-when-alias-guidance.test.ts`.
Two more `visibleWhen` shapes in `packages/spec` were never in that inventory:
`page:tabs` items (`ui/component.zod.ts`) and the automation `screen` node's
`ScreenFieldConfigSchema` (`automation/builtin-node-config.zod.ts`). On both, an
author who wrote `visible` or `showWhen` got a rejection naming the surface but
never the key to write instead.

**Nothing changes about what parses.** Every key named here was rejected before
and is rejected after; only the message differs — an alias row is a message
channel, not a parse-time rename.

What each surface says now:

- **`page:tabs` items** rename `visible` and `showWhen` onto `visibleWhen`, the
  simple case (one landing key, no boolean sibling). The item's docblock also
  states that the deprecated ADR-0089 `visibility` / `visibleOn` spellings are
  not accepted here (unlike the view/page shapes that fold them in via
  `normalizeVisibleWhen`) — that statement is about **acceptance**, which an
  alias row does not disturb, so both now get the same pointer at `visibleWhen`
  while staying rejected exactly as before.
- **`ScreenFieldConfigSchema`** (the `screen` automation node's per-field
  config) renames `visible` and `showWhen` onto `visibleWhen` the same way. The
  shape's pre-existing `visibleIf` prescription (an exact `guidance` entry) is
  unaffected — an exact entry wins over the alias table, so that bespoke prose
  keeps firing for the four-edit-away typo it was written for.

Both shapes are hand-rolled `strictObject` calls with their own options and
neither spreads `VISIBILITY_STRICT_OPTIONS`, so no shared guidance set answers
these keys ahead of the new alias rows — verified against
`alias-integrity.test.ts`, which fails on a row a guidance set would shadow.
