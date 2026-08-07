---
"@objectstack/spec": patch
---

fix(spec): the `fallbackNodeId` tombstone names the key that actually routes faults (#6094)

`flow.errorHandling.fallbackNodeId` was retired in 17.0.0 (#3896), and its
migration message tells the author what to draw instead. It named the wrong key:

- FROM: "the engine routes unrecoverable node errors via per-node fault edges
  (an edge with **condition `'fault'`**)"
- TO: "… (an edge with **`type: 'fault'`**)"

`condition` on `FlowEdgeSchema` is a **CEL predicate** returning boolean
(`flow.zod.ts` — `ExpressionInputSchema`), while the fault/default/conditional/back
routing lives on `type` (`z.enum([...])`). An author following the old wording
verbatim would write `{ source, target, condition: 'fault' }`, which **parses
clean** — `condition` accepts any expression string — and produces an ordinary
edge that is not a fault path. So the tombstone handed them a second silently
inert key in exchange for the one it took away: they delete a fallback that never
existed, then draw a fault edge that isn't one.

The repo already states the correct rule elsewhere (`flows.mdx`: "`type: 'fault'`
is what routes — a label is not"), and every other mention in the tree spells it
`type: 'fault'`; this was the only site out of step. The closing sentence
("draw a fault edge from the failing node to the handler node instead") was
already correct and is unchanged.

Message text only — no schema, validation, or runtime behaviour changes.
