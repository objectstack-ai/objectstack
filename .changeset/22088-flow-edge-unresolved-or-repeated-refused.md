---
'@objectstack/spec': minor
---

feat(spec)!: `FlowSchema` refuses an edge whose `source` or `target` names no node of its graph, and an edge that repeats an earlier one

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-edge-unresolved-or-repeated-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** `FlowSchema` held node ids and edge ids unique, and checked nothing else about an edge. A flow whose edge named a node it no longer held (`start → node_1` over nodes `[start, end]`), or that held `start → node_1` three times, passed `FlowSchema.parse`, `objectstack validate` and the metadata save door, and publish answered 200 with `_diagnostics.valid: true`. Then it ran. The dangling edge carried the run nowhere, silently, and the repeated edge ran its target once per copy: one record update created three identical records. The Studio flow designer produced both shapes after a node was removed.

**What is refused.** Both rules run in the region walk the node-id rule already uses, at every depth it reaches. The issue's `code` is `custom`, and each issue is anchored on the edge to fix:

- **An endpoint that names no node of the edge's own graph**, at `edges.N.source` / `edges.N.target`. For an edge inside a `loop` / `parallel` / `try_catch` region the path is the region path, such as `nodes.N.config.body.edges.M.target`. The graph is the flow's own `nodes` for a top-level edge, and the region body's `nodes` for a region edge, because the engine resolves an endpoint there alone. So a top-level edge into a region node is refused too, and the message names the graph the node does live in. The node-id space is still one across the flow for uniqueness.
- **A repeated edge**, at `edges.N`, naming the earlier copy. Repeated means the key the engine selects on: the same `source`, `target`, `type`, `condition` (its dialect and source, so a bare CEL string and its envelope are one condition) and branch `label`. An `isDefault` copy of an unconditional edge is a repeat. A repeat is judged only between edges whose endpoints both resolve.

That covers `FlowSchema`, `defineFlow`, `defineStack` (`STACK_SCHEMA_INVALID`, 422), `os validate`, `os compile`, an artifact's parse, `AutomationEngine.registerFlow` (which parses first) and the metadata save door (`422 INVALID_METADATA`, in draft and in publish mode).

**What is still accepted, byte for byte.** Two nodes joined by edges the engine tells apart: different conditions, a `fault` edge beside a default one, or `approve` and `reject` branch labels into one node. Every flow whose edges all resolve in their own graph and repeat nothing.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| an edge into a node that is not in the same `nodes` list (`target: 'node_1'`, no `node_1`) | point it at the node it was meant to reach, or delete the edge |
| a top-level edge into a node inside a region body | an edge into the region's container node; the region's own edges reach the nodes inside it |
| the same `source` → `target` edge twice, with the same `type`, `condition` and `label` | one edge. Delete the later copy; an edge meant to take its own route needs its own `condition` or branch `label` |

**The one-line fix: delete the edge the refusal names, or re-point its endpoint.** Deleting a dangling edge changes nothing a run did, with one exception. A conditioned edge into a missing node still counted as the branch taken when its condition held, so where a flow relied on that, point the edge at a node that ends the branch. Deleting a repeated copy runs its target once per traversal instead of once per copy, which is the defect being removed.

**Who is affected, measured.** At `aa71c4d9d`, every flow the examples ship (`app-showcase`, `app-crm`, `app-todo`: 35 flows, 55 graphs counting region bodies, 131 edges) has no dangling endpoint and no edge pair sharing a `source` and `target` at all. The flows the packages ship (the `os generate` and `os explain` templates, the new-flow seed, the `@objectstack/verify` fixture) and the platform test checklist's flow bodies are clean by reading. The CLI's golden eval corpus carries no flow. Deployed metadata and other repositories were not measured. Where such an edge already sits in a stored flow, the whole flow is refused at registration: at boot it is skipped with a warn naming it, its trigger not armed, while the flows beside it register.

### The kit

- **The refusal.** Two blocks in `FlowSchema`'s `superRefine`, after the edge-id rule, over `collectFlowGraphs`. No new error code: the issue is the same `custom` issue the id rules raise.
- **The ledger.** The D3 semantic entry `flow-edge-unresolved-or-repeated-refused` (protocol 18) and its step-18 rationale fragment. No key is removed, so there is no tombstone, and there is no D2 conversion: a dangling endpoint carries no intent a rewrite could recover, and dropping a copy changes how often its target runs.
