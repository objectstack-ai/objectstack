---
"@objectstack/spec": patch
---

`ObjectTimelinePropsSchema.items`' describe no longer says "the author owns the item shape". `items` stays `z.array(z.unknown())` — no schema-shape change — but the sentence now names the actual owner: each element is objectui's declared timeline element, `@object-ui/types`'s `TimelineFeedItem` (feed, `variant` absent / `vertical` / `horizontal`) or `TimelineGanttItem` (a gantt row, `variant: 'gantt'`), selected by the node's own `variant`, whose strict authoring face refuses a mismatched arm and any undeclared key.

The element union and its zod mirror are declared and enforced entirely inside objectui's `packages/types` — nothing in this package imports or re-declares it, so this is a documentation-only correction, not a value-tightening. Value tightening (declaring the arms in this schema instead of `z.unknown()`) stays a later ratchet with its own inventory.
