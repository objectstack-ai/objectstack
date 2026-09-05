---
"@objectstack/spec": minor
---

feat(spec)!: `FlowSchema` refuses a flow whose `edges[]` declares the same id twice (#14964)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-typed: `edges[].id` keeps its name, its type and its describe, and every flow whose edge ids are unique parses byte-identically. The only newly refused shape is two edges sharing one id — a collision, not a spelling — and its remedy is to renumber one of the two, which is authoring intent no `objectstack migrate meta` rewrite can choose for the author. The Zone-2 census over this repo (776 `edges[]` arrays, 1,098 edges under `packages/**` and `examples/**`, with a lit control) found zero instances, so there is no in-repo file to name. -->

**BREAKING** accept-set narrowing on `FlowSchema` — a flow whose `edges[]`
carries two edges with the same `id` is now **refused at parse time** — by
`FlowSchema.parse` / `safeParse`, `defineFlow`, and every door that validates a
flow through the schema (`objectstack validate`, the runtime publish gate, a
stack's `flows[]`) — where it used to parse on green. Shipped as `minor` under
the repo's launch-window convention for breaking changes. Maintainer ruling
2026-09-05 on #14964 (director decision batch #40, verbatim 「同意」): option
A — an `error`, not a `warning`; no opt-out, no transition window.

Every reader of an edge id assumes the ids in a flow are unique — a designer,
a BPMN export, a flow diff, any traversal that dedupes by id — and nothing
enforced it. A real duplicate (`id: 'e20'` on two edges of one flow) shipped
through two releases of green CI in a downstream app and was inert only
because the engine keys out-edges by `source`, never by `id`: the collision is
invisible until something keys on ids, and then silently wrong rather than
loudly broken. The id space is hand-authored, so the next author picking a
"free" id from the sequence had no way to know it was taken.

**What changes** (`packages/spec/src/automation/flow.zod.ts`): a `superRefine`
on the flow's `edges[]`. Each later occurrence of an already-declared id raises
one `custom` issue, anchored at `edges[N].id` of the *later* edge and naming
both positions, so the formatted error points at the edge to renumber:

```text
✗ edges.7.id: Duplicate edge id `e20` — `edges[7]` reuses the id already declared by `edges[3]`; every edge id in a flow must be unique. Renumber one of them: …
```

**What does NOT change:** `edges[].id` keeps its name, type and describe; the
node vocabulary, the edge `type` enum and every other refusal are untouched;
a flow with unique edge ids (or no edges) parses exactly as before. Node ids
are not covered by this change.

The shape that is refused, and what the author does about it — a two-edge
excerpt, the later edge renumbered:

```ts
// before — parsed on green, both edges keyed 'e20'
edges: [
  { id: 'e20', source: 'qualify', target: 'convert' },
  { id: 'e20', source: 'convert', target: 'end' },
]

// after — refused at parse (edges.1.id: Duplicate edge id `e20` …); renumber the later one:
edges: [
  { id: 'e20', source: 'qualify', target: 'convert' },
  { id: 'e21', source: 'convert', target: 'end' },
]
```

**Remedy.** Renumber the later edge to an id no other edge in that flow
carries; nothing else in the flow needs to move. The census over this
repository found no flow to migrate, so this is a release note, not a
migration: no shipped example, fixture or seed in `packages/**` or
`examples/**` declares a duplicate edge id, and the pinned objectui tree
carries none in its authored flows. The one known downstream instance was
renumbered before this change (hotcrm PR #1571).
