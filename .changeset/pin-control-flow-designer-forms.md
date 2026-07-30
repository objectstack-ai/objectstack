---
---

Tests only — no package changes, nothing to release.

Pins the published `configSchema` of the `loop` / `parallel` / `try_catch`
descriptors, which had no assertions at all: the designer's input for the whole
control-flow trio was unguarded (#4045 step A).

The assertions capture *intent*, not just current bytes. All three publish a form
description that is deliberately **shallower and looser** than its Zod counterpart
in `control-flow.zod.ts`:

- region keys (`loop.body`, `parallel.branches[].nodes/edges`, `try_catch.try/catch`)
  publish `{ type: 'array' }` with **no `items`**, so the designer treats a sub-graph
  as opaque — it is edited on the canvas, not in a property form. The Zod is
  `FlowRegionSchema` (`z.array(FlowNodeSchema)`), which would generate the entire
  FlowNode/FlowEdge definition nested there;
- `collection` is `z.string().min(1)` and `iteratorVariable` is `.default('item')`
  in Zod, yet the form publishes neither `minLength` nor `default`.

This matters for the rest of #4045: the plan (and the issue) assumed these three
were redundant copies awaiting de-duplication by a single Zod source. They are not
— they are a second artifact with a different job, and the differences are
deliberate. With these pinned, any move toward a generated `configSchema` either
keeps them green or has to state explicitly why the designer contract changed.

Verified to bite: simulating what a naive `z.toJSONSchema` swap would emit (deep
`items` under `body.nodes`, plus `minLength`/`default`) turns both new `loop` tests
red.
