---
"@objectstack/spec": patch
---

`collectFlowGraphs` now honours the `readonly FlowNodeParsed[]` it declares: a member of a region's node list that is not a record is dropped from the `FlowGraph` it hands out, instead of being passed through verbatim.

An ADR-0031 container keeps a whole sub-graph inside `FlowNodeSchema.config`, a deliberately open `z.record`, so `collectFlowGraphs` re-derives those inner node lists at run time and checks them with `Array.isArray` — which proves the LIST and never its MEMBERS. An empty item in a YAML `nodes:` list under a `loop` body deserialises to `null`, and that `null` reached `graph.nodes` on every returned graph, at every depth. No caller could prevent it: this is an array the walk picks up itself, so no coercion at a call site ever holds it. Filed as #16752.

- **What changed.** The walk filters what it hands out and skips what it descends into, through one predicate. Array identity is preserved when nothing is dropped, so a well-formed flow allocates nothing new.
- **What deliberately did NOT change.** The declared input type is untouched — widening it to tolerate malformed members was refused on the anti-AI-error axis, and this is the opposite move: the producer now keeps the promise it already made. The schema refusal that owns a malformed region still fires, unchanged; this walk runs inside `FlowSchema`'s parse, where a thrown `TypeError` would escape `safeParse`, so the repair is a drop and a skip and never a throw. `FlowGraph.path` still indexes the raw authored list, so a Zod issue stays anchored where the author wrote the node.
- **Visible consequence.** As with the sibling repairs that read their lists through a record filter, a dropped member renumbers the ones behind it *within* `graph.nodes` — a difference in the index, never in whether a node was judged, and only in a list that was already malformed.
