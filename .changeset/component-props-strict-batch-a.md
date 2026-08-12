---
"@objectstack/spec": minor
"@objectstack/lint": patch
---

feat(spec): close the 31 SDUI component-props shapes against unknown keys (#4001 batch A)

`ComponentPropsMap` — the declared shape of every `page:*`, `record:*`,
`element:*`, `nav:*` and `ai:*` node a page can carry — stripped unknown keys in
silence. All 31 object sites in `ui/component.zod.ts` are `strictObject` now.

**What actually changes for an author.** #5068 already reported these keys: it
dispatches `ComponentPropsMap` by the component's `type` and judges `properties`
at `os validate` / `os build` / `os lint`. It did that by walking a strip-mode
object and reconstructing what the parse would have dropped. Now the parse
rejects the key itself. Same rule id (`component-props-unknown-key`), same
warning tier — and three things a reconstruction could not give:

- **Curated prescriptions per surface.** A tab item's `key` is answered with
  `value` (objectui's Studio designer publishes `key`; the renderer reads
  `it.value` and falls back to `tab-<index>`, so an authored `key` yields tab
  tokens that move when the item list changes). A header's `description` is
  answered with `subtitle`, the rename its own ADR-0087 conversion performs —
  the one path that had no diagnostic at all, as `conversions/walk.ts` records.
  A container's `body` is answered with `children`. Anything spelled like a
  component-level key (`visibleWhen`, `id`, `dataSource`, `className`, …) is told
  it belongs one level up on the node, where the runtime actually reads it.
- **A rejection that holds for every caller**, not only inside the gate.
- **Union arms.** `RecordHighlightsField`'s object arm and
  `record:related_list`'s sort entry are closed too. Zod 4 collapses arm
  failures into one `invalid_union`, so `@objectstack/lint` now unpacks a lone
  arm's `unrecognized_keys` back onto the unknown-key rule — and declines to,
  deliberately, when two arms could both have been meant.

**Five props are newly DECLARED, not rejected**, on the rule this file has
applied three times before (#5611 / #5775 / #6276: the delivered, authorized
shape is the contract). Each is read by objectui through
`schema?.X ?? schema?.properties?.X` with its own comment inviting authors, and
closing the shape around them would have turned an invited affordance into a
rejection: `page:header` `maxVisible` / `mobileMaxVisible` (the inline-vs-overflow
action budget, desktop and mobile), `page:tabs.alwaysShowStrip` (keep a one-tab
strip visible), `record:details` `inlineEdit` / `showHeader`. All optional with
no schema default — the defaults are the renderer's, and declaring them would
turn an unset key into an authored one.

**Deliberately unchanged, and worth stating because a reader will assume
otherwise.** The carrier is still `z.record(z.string(), z.unknown())`: direction
B (a discriminated `properties`) stays declined, because `type` is an open union
and the example corpus alone authors 87 nodes across ten types this map does not
carry — those are still skipped, not rejected. The storage path still parses no
props (#4463). The gate is still warning-level.

**Zero refusals on shipped metadata.** Verified by parsing the three example
apps' build artifacts and the three published platform pages directly through
`ComponentPropsMap` — 244 registered props bags, no undeclared key, no new
refusal — because `objectstack validate` never parses through `PageSchema`
(#5000), so "the examples validate clean" would have been no evidence at all.
