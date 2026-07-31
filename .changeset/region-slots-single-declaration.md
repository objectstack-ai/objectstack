---
'@objectstack/spec': patch
'@objectstack/lint': patch
---

One declaration of where ADR-0031 regions live (#4401).

A region is a sub-graph inside `FlowNodeSchema.config`, an open `z.record`. Nothing in the
type system says which key on which node type holds one, so every pass that needs to reach
a region node has to be told — and within one week three of them were told separately, by
two changes that were each correct on their own:

| pass | package | table it carried |
|------|---------|------------------|
| `mapFlowNodes` (ADR-0087 conversions) | `spec` | `FLOW_REGION_SLOTS` |
| `validateControlFlow` / `normalizeControlFlowRegions` / `collectFlowGraphs` | `spec` | `regionSlotsOf` |
| `walkFlowNodes` (lint flow rules) | `lint` | `REGION_SLOTS` |

Each pinned its own copy with its own reconciliation test. So every copy was protected from
drifting away from the schemas, and **nothing would have failed if the copies drifted from
each other** — while adding a fourth construct meant editing three places, and missing one
reproduces exactly the silent blind spot #4347 and #4380 were both filed about.

- New `@objectstack/spec/automation` export `FLOW_REGION_SLOTS` (plus the
  `FLOW_REGION_SLOTS_BY_TYPE` / `FLOW_REGION_CONFIG_KEYS` views) is now the only statement
  of the fact. It lives in an **import-free** module so `spec/conversions/walk.ts` can read
  it and stay the pure shape walker it was written as; mapping a slot onto the Zod schema
  its value parses as stays in `control-flow.zod.ts`, which is schema business.
- The three reconciliation tests collapse into one, `region-slots.test.ts`, keeping the
  strongest of them: it derives each construct's region keys **behaviourally**, by asking
  the config schema what it actually accepts in a region shape, rather than reading names
  off `.shape`. It also probes every other exported `*ConfigSchema`, so a new
  region-bearing construct cannot be added without either declaring its slots or failing
  here.

The three **walks** are deliberately left separate. They take different inputs (parsed
`FlowNodeParsed` vs raw authored records), yield different units (a graph, a node, a
copy-on-write rewritten tree), and the lint one formats human diagnostic trails from node
labels — consumer logic, not protocol (Prime Directive #2). Merging them would trade a
duplicated four-line table for a walker that serves nobody well. Only the fact they all
need is shared.

No behaviour change: every existing test passes unchanged, which is the point of the
exercise.
