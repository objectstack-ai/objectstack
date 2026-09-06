---
"@objectstack/spec": minor
---

feat(spec)!: `FlowSchema` refuses a flow whose top-level `nodes[]` declares the same id twice (#15713)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-typed: `nodes[].id` keeps its name, its type and its describe, and every flow whose top-level node ids are unique parses byte-identically. The only newly refused shape is two top-level nodes sharing one id — a collision, not a spelling — and its remedy is to rename one of the two (and re-point the edges that meant it), which is authoring intent no `objectstack migrate meta` rewrite can choose for the author. The census over this repo at `1f2a02ba` (997 literal `nodes[]` arrays, 2,186 nodes, 2,011 literal ids under `packages/**` and `examples/**` including tests; 79 arrays / 256 nodes excluding tests; AST scan with a planted-duplicate control that reads 1) found zero instances, so there is no in-repo file to name. -->

**BREAKING** accept-set narrowing on `FlowSchema` — a flow whose top-level
`nodes[]` carries two nodes with the same `id` is now **refused at parse time**
— by `FlowSchema.parse` / `safeParse`, `defineFlow`, and every door that
validates a flow through the schema (`objectstack validate`, the runtime
publish gate, a stack's `flows[]`) — where it used to parse on green. Shipped
as `minor` under the repo's launch-window convention for breaking changes. The
exact parallel of #14964 (edge ids, maintainer ruling 2026-09-05, option A —
an `error`, not a `warning`; no opt-out, no transition window), applied to the
other hand-authored id space in the same schema.

Every edge's `source` / `target` names a node by id, and the engine's traversal
picks out-edges by `source` — with two nodes sharing an id, every edge from
that id is ambiguous and whichever node wins is decided by array order,
silently. A designer, a BPMN export and a flow diff key on node ids the same
way they key on edge ids. Only region bodies (`loop` / `try_catch` / `parallel`
sub-graphs) were checked, by `analyzeRegion` at `registerFlow()`; the flow's
own top-level `nodes[]` parsed with the collision intact — measured on
`origin/main` `1f2a02ba` with two lit controls on the same schema instance (a
node missing its `label` → refused at `nodes.1.label`; an unknown key on a node
→ `unrecognized_keys`).

**What changes** (`packages/spec/src/automation/flow.zod.ts`): the existing
`superRefine` on `FlowSchema` gains a pass over the top-level `nodes[]`, the
same shape as the `edges[]` pass. Each later occurrence of an already-declared
id raises one `custom` issue, anchored at `nodes[N].id` of the *later* node and
naming both positions, so the formatted error points at the node to rename:

```text
✗ nodes.2.id: Duplicate node id `n` — `nodes[2]` reuses the id already declared by `nodes[1]`; every node id in a flow must be unique. Rename one of them: …
```

**What does NOT change:** `nodes[].id` keeps its name, type and describe; the
open node-type vocabulary (ADR-0018), the region rules (`analyzeRegion`) and
every other refusal are untouched; a flow with unique top-level node ids
parses exactly as before. The rule judges the flow's **own top-level**
`nodes[]` only — a region body's nodes remain `analyzeRegion`'s to judge, and
whether a region node may reuse a top-level node id (one id space or two) is a
separate decision this change neither takes nor pre-empts.

The shape that is refused, and what the author does about it — a four-node
excerpt, the later node renamed and its edge re-pointed:

```ts
// before — parsed on green, two nodes keyed 'n'
nodes: [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'n', type: 'assignment', label: 'Assign A' },
  { id: 'n', type: 'assignment', label: 'Assign B' },
  { id: 'end', type: 'end', label: 'End' },
]

// after — refused at parse (nodes.2.id: Duplicate node id `n` …); rename the later one
// and point the edges that meant it at the new id:
nodes: [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'n', type: 'assignment', label: 'Assign A' },
  { id: 'n2', type: 'assignment', label: 'Assign B' },
  { id: 'end', type: 'end', label: 'End' },
]
```

**Remedy.** Rename the later node to an id no other top-level node in that
flow carries, then re-point at the new id the edges whose `source` / `target`
meant that node; nothing else in the flow needs to move. The census over this
repository found no flow to migrate, so this is a release note, not a
migration: no shipped example, fixture or seed in `packages/**` or
`examples/**` declares a duplicate top-level node id.
