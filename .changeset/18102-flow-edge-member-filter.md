---
"@objectstack/spec": patch
---

`collectFlowGraphs` no longer hands out a `FlowGraph` whose `edges` can hold a non-record — the sibling list #16752's repair did not reach (#18102).

`FlowGraph.edges` is declared `readonly FlowEdgeParsed[]`. The walk forwarded it untouched, four lines from the node-side member filter the same walk has carried since #16752, and a nested region's edge list is admitted on `Array.isArray` alone — which proves the LIST and never its MEMBERS. A YAML `edges:` list item left empty deserialises to `null`, and a region its own schema refused is left RAW for `validateControlFlow` to name, so the producer handed out an array holding a member its own declared element type excludes. Measured on `main`:

```
collectFlowGraphs({ nodes: [start, loop{ body: { nodes: [], edges: [null] } }], edges: [] })
  graph[1] scope="loop 'lp' body"  edges=[null]     declared readonly FlowEdgeParsed[]
```

- **The junk member is DROPPED, per list**, through the same one predicate the node side uses (`isRegionDict`), so the two lists the walk hands out cannot drift from each other. Copy-on-write per list: a well-formed flow is handed back the very same arrays.
- ⭐ **The real edge beside it is still HANDED OUT**, and so is the node list. "No non-record members" is half a contract — a filter that emptied `edges`, or reached into `nodes`, would satisfy it. Both are pinned.
- **This is a drop in the producer, not a refusal.** No authoring door's accept set moves: `FlowSchema.safeParse` still returns an envelope rather than throwing, the region `safeParse` refusal in `validateControlFlow` still owns and still reports the malformed region, and `FlowGraph.path` still indexes the RAW node list so a Zod issue stays anchored where the author wrote it. ⛔ Not a looser signature either — the declared element type is unchanged and is now true.
- **Latent, not live — measured, and not for the reason the filing gave.** There are THREE `graph.edges` consumers on the tree, not two. The two in `packages/lint` coerce through `recordsOf` (#16910). The third is `packages/services/service-automation`'s registration pass, which reads `.id` / `.source` / `.target` straight off each member with no guard, and is shielded only by call ORDER — `validateControlFlow` refuses the malformed region a few frames earlier in `registerFlow`. So no throw is reachable today, by one belt more than was counted. After this change the declared type carries it, and the next consumer needs neither a coercion nor a call-order argument.
- **`analyzeRegion` is not one of those consumers.** It throws a `TypeError` on a `null` / `undefined` edge member (measured), but nothing routes producer output into it: its in-repo callers hand it post-`safeParse` region data. It reads an edge list, it does not read `FlowGraph.edges`.
- **No behaviour changes on well-formed metadata.** The only input whose handling moves is input whose declared type already said it could not exist.

Clause-②: no
