---
---

Tests only — no package changes, nothing to release.

Reconciles the designer form against the Zod for the region-bearing flow nodes
(#4045). `loop` / `parallel` / `try_catch` each carry two descriptions of the same
config — a hand-written `configSchema` on the descriptor and a Zod schema in
`control-flow.zod.ts` — and nothing compared them. #4064 pinned the shape of the
first; this pins the relationship, so neither side can gain or lose a key without
the other noticing.

The two are **not** merged into one source, because measurement says that does not
work here: generating from the Zod emits 9–17× more schema at +9 levels of depth
(`loop` 597 → 5,537 chars, `parallel` 294 → 5,112, `try_catch` 737 → 10,739), with
no `$defs`/`$ref` — `FlowNodeSchema` is inlined at every region key, so a loop body
would arrive as the whole node/edge definition instead of the opaque array the
designer needs for a canvas-edited sub-graph. A projection pruning ~90% back off
would leave three things to maintain instead of two.

So the divergence is legitimate, and what is enforced is that it stays declared: a
`DELIBERATELY_SHALLOW` ledger names each shallow key with a reason, and every entry
must name a key both sides still declare, so it cannot rot.

Compares key sets rather than generated shapes on purpose — generating needs
`z.toJSONSchema`, and `service-automation` does not depend on `zod`. The Zod's key
set is reachable via `schema.shape` without that dependency, and the key set is
where the drift that matters shows up.

Verified to bite in all three directions: a Zod key the form does not offer, a form
key the Zod rejects, and a ledger entry pointing at a renamed key each turn the
suite red with the offending name in the message.
