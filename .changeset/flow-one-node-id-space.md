---
"@objectstack/spec": minor
---

feat(spec)!: `FlowSchema` refuses a region node whose id is already declared elsewhere in the flow — one node-id space across the top-level `nodes[]` and every region body (#16134)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-typed: `nodes[].id` keeps its name, its type and its describe at every depth, and every flow whose node ids are unique across the whole flow parses byte-identically. The only newly refused shape is a region node (`loop.config.body`, `try_catch.config.try` / `.catch`, `parallel.config.branches[]`, at any depth the parse walks — nesting up to `MAX_REGION_DEPTH` = 32) carrying an id that a top-level node or a node in another region already declares — a collision, not a spelling — and its remedy is to rename one of the two (and re-point the edges that meant it), which is authoring intent no `objectstack migrate meta` rewrite can choose for the author. The census over this repository at `83863b2df` (AST scan of `packages/**` and `examples/**`: 972 outermost literal `nodes[]` arrays including tests, 66 excluding; 102 region arrays / 86 region nodes with a literal id, 15 / 11 excluding tests; a planted region-reuses-top-level-id control reads 1 at its planted line) found zero cross-region or region-vs-top-level collisions, so there is no in-repo file to name. -->

**BREAKING** accept-set narrowing on `FlowSchema` — a flow has **one node-id
space**. A node inside an ADR-0031 region body (`loop.config.body`,
`try_catch.config.try` / `.catch`, each `parallel.config.branches[]`, nested to
any depth the parse walks — up to `MAX_REGION_DEPTH` = 32 levels) whose `id` is
already declared by a top-level node, or by a node in
any other region of the same flow, is now **refused at parse time** — by
`FlowSchema.parse` / `safeParse`, `defineFlow`, and every door that validates a
flow through the schema (`objectstack validate`, the runtime publish gate, a
stack's `flows[]`) — where it used to parse on green. Shipped as `minor` under
the repo's launch-window convention for breaking changes. Maintainer ruling
(director seat, decision batch #61, 2026-09-07, 「同意」): ADR-0031's
"self-contained single-entry / single-exit sub-graph" describes control flow and
variable scope, not id reuse; every reader that flattens a flow may key on the
bare id. The ADR gains one sentence saying so in this same change.

Before this change uniqueness was enforced **inside** each array — the
top-level `nodes[]` by `FlowSchema` (#15713) and each region body by
`analyzeRegion` at `registerFlow()` — and never **across** them: a loop-body
node could carry the same `id` as a top-level node, or as a node in a sibling
branch, and both rules stayed green. Every edge's `source` / `target` names a
node by id, and the designer canvas, the BPMN export, a flow diff and a
checkpoint's `completedNodeIds` all key on the bare id, so such a collision was
silently wrong wherever a flow is flattened.

**What changes** (`packages/spec/src/automation/flow.zod.ts`): the existing
`superRefine` pass over `nodes[]` now walks every graph the parse reaches via
`collectFlowGraphs` — the top-level graph first, then each region in document
order, depth first, down to `MAX_REGION_DEPTH` (32) — keeping one map of first
declarations. A later occurrence
raises the same single `custom` issue as before, anchored at the later node's
own `id` (inside the region, e.g. `nodes.1.config.body.nodes.0.id`) and naming
both locations — a top-level index (`nodes[1]`) or a region path
(`loop 'sweep' body → nodes[0]`):

```text
✗ nodes.1.config.body.nodes.0.id: Duplicate node id `start` — `loop 'n' body → nodes[0]` reuses the id already declared by `nodes[0]`; every node id in a flow must be unique. Rename one of them: …
```

One refusal, one message shape, at every depth the parse walks: within
`MAX_REGION_DEPTH` an author never sees two issues for one collision. A region
nested beyond that ceiling is left raw by the parse and stays
`validateControlFlow`'s, in its own line — there `analyzeRegion`'s
`duplicate node id 'X'` is the only refusal of a within-region duplicate (a
cross-region collision past the ceiling is not judged), and the same line
guards `bpmn-mapping`'s raw-region caller, so it is kept on purpose.
`collectFlowGraphs` gains a `path` field beside `scope` — the same location as
a key path — so the issue can be anchored where the author wrote the node; it
also now skips a non-object element in a region its own schema refused (such a
region is left raw for `validateControlFlow` to name), where it used to throw a
`TypeError` from inside that validator.

**What does NOT change:** `nodes[].id` keeps its name, type and describe; the
open node-type vocabulary (ADR-0018), the region rules (edge integrity,
single-entry / single-exit, acyclicity) and every other refusal are untouched;
a flow whose node ids are unique across the whole flow parses exactly as
before, region nodes included, in authored order.

The shape that is refused, and what the author does about it — the region node
renamed, and any region edge that meant it re-pointed:

```ts
// before — parsed on green, `start` declared twice (top level + loop body)
nodes: [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'sweep', type: 'loop', label: 'Sweep', config: { collection: '{items}', body: {
    nodes: [{ id: 'start', type: 'assignment', label: 'First step' }],
  } } },
  { id: 'end', type: 'end', label: 'End' },
]

// after — refused at parse (nodes.1.config.body.nodes.0.id: Duplicate node id `start` …);
// rename the region node and point the region's edges that meant it at the new id:
nodes: [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'sweep', type: 'loop', label: 'Sweep', config: { collection: '{items}', body: {
    nodes: [{ id: 'sweep_first', type: 'assignment', label: 'First step' }],
  } } },
  { id: 'end', type: 'end', label: 'End' },
]
```

**Remedy.** Rename the later node to an id nothing else in that flow carries —
no top-level node, no node in any region — then re-point at the new id the
edges whose `source` / `target` meant it; nothing else in the flow needs to
move. The census over this repository found no flow to migrate, so this is a
release note, not a migration: no shipped example, fixture or seed in
`packages/**` or `examples/**` declares a region node id that collides with a
top-level or another region's node id.
