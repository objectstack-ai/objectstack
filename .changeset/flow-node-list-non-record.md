---
"@objectstack/lint": patch
---

`validateStackExpressions` no longer throws on a non-record entry of a flow's `nodes` list.

An empty item in a YAML `nodes:` list deserialises to `null`, so this is an authorable shape — the same one #15552, #15636 and #15742 closed for stack collections and for `objects[].fields`. Here it crashed the linter instead of producing a finding: `flow.nodes: [null, ...]` threw `Cannot read properties of null (reading 'type')`, which presents to an author as a broken tool rather than as a problem with their metadata.

Both of the file's inline casts now read through `recordsOf`, the one home of this coercion, instead of asserting that `Array.isArray` proves anything about a list's MEMBERS:

- The flow walk reads `flow.nodes` through `recordsOf`, and — the half that actually removes the crash — hands that coerced array to `collectFlowGraphs` rather than the raw flow. `collectFlowGraphs` declares its input as already-parsed `FlowNodeParsed[]` and is transparent about members, so passing raw authored metadata was calling it out of contract; coercing only the local variable relocated the throw into `@objectstack/spec` instead of ending it. The producer's contract is unchanged, deliberately: widening it to tolerate malformed members is the wrong direction.
- The per-graph walk reads `graph.nodes` through `recordsOf` in place of an `as unknown as` double cast. A nested region's node list is only `Array.isArray`-checked before it becomes a graph, so that list carries the producer's word about its members and not a check.

A non-record member is dropped whole and in silence, exactly as the file's sibling field readers already did; a flow standing beside the junk entry is still judged, and a `nodes` list holding a plain string still reports exactly what it reported before.
