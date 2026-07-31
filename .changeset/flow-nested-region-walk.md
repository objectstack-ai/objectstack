---
"@objectstack/lint": patch
---

fix(lint): flow rules see into try_catch / loop / parallel regions (#4380)

Every lint rule that inspects flow nodes had hand-written the same one-liner —

```ts
const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
```

— and every one of them was therefore blind to the same thing.
`FlowRegionSchema` holds a full `nodes: z.array(FlowNodeSchema)`, and four
config slots carry one: `try_catch.config.try` / `.catch`, `loop.config.body`,
and `parallel.config.branches[].nodes`. Regions nest arbitrarily. Move a node
into any of them and the checking stayed behind.

Measured before the fix, the same bad nodes at the top level vs inside a
`try_catch`:

| rule | severity | flat | nested |
| :--- | :--- | :--- | :--- |
| `flow-node-write-unknown-field` | error | 1 | **0** |
| `flow-update-readonly-field` | error | 1 | **0** |
| `approval-approver-*` | error/warning | 1 | **0** |
| `flow-template-unknown-field` (filter position) | error | 1 | **1, as a warning** |

**The last row is the one a reader would not predict.**
`validate-flow-template-paths` scans a node's whole `config` for string leaves,
so it still *saw* tokens inside a region — but its `filter`-position split only
looks at the top level of the node it was handed. A nested filter token lost its
position, so the #3810 finding ("this node cannot run — an erased condition
WIDENS the query") silently degraded to an advisory warning, reported against
the wrapping `try_catch` instead of the `get_record` that is broken:

```
FLAT     error  	flow "f" node "get_record"	flows[0].nodes[1]
NESTED   warning	flow "f" node "try_catch"  	flows[0].nodes[1]
```

Being visible is not the same as being judged correctly. That is worse than a
clean miss: a yellow line reads as "checked and merely advisory".

**One shared walk, not five.** `flow-walk.ts` — the flow-side counterpart of the
existing `page-walk.ts`, and here for the same stated reason: getting the
traversal right is subtle enough that duplicating it has already produced dead
rules. `walkFlowNodes(flow, flowPath)` yields every node with its real config
path (`flows[0].nodes[1].config.catch.nodes[0]`), a region breadcrumb for
diagnostics (`try_catch "Guard" › catch`), and depth. Four rules now route
through it: the two flow write rules, the template-path rule, and the approval
rule.

Findings now land on the node that is actually wrong, which is the point — a
path pointing at the container is not actionable in a flow with several regions.

**The double-count trap is handled, not left to each caller.** A container node
is walked too (it has its own config worth checking — a `loop`'s `collection`, a
`try_catch`'s `retry`), but its `config` physically contains every descendant,
so a rule that scans config recursively would report each nested finding twice.
`WalkedFlowNode.localConfig` is the container's config with region slots
removed; the recursive scanner uses it, and a test pins that a nested token is
reported once while the container's own `collection` token still is.

`REGION_SLOTS` is declared as data and pinned against the spec's own
region-bearing config schemas — derived behaviourally (a slot is one that
accepts `{nodes: […]}`), not restated — so a fifth construct fails that test
instead of becoming a fifth silent blind spot. A `MAX_REGION_DEPTH` cap keeps a
hand-authored (pre-parse) stack from hanging a lint.

Verified end to end: nested now matches flat on every rule, including the
restored `error` severity. app-showcase ships an `update_record` inside a
`catch` branch (`showcase_resilient_sync`) that had never been checked by
anything — it is correct, so validation stays clean, and breaking its field name
on purpose now fails `os validate` with
`flows[24].nodes[1].config.catch.nodes[0].config.fields.sync_statuss` and the
region trail `try_catch "Push with retry" › catch › node "Flag Sync Failure"`.
