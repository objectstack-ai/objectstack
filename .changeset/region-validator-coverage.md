---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

`registerFlow`'s remaining validators cover structured regions (#4389).

#4347 closed the conversion and predicate halves of "metadata behaves differently
depending on how deep it sits". Three validators were left walking `flow.nodes` only, so
the same class stayed open one layer over: an ADR-0031 container keeps a whole sub-graph
in its open `config`, and each of these checked *part* of the flow while reporting on all
of it.

- **`validateControlFlow` recurses.** A container nested inside another container's region
  was never validated at registration — it reached run time, where `runRegion` →
  `findRegionEntry` throws mid-iteration, after the enclosing loop has begun and its side
  effects have landed. This cannot break a working flow: everything newly rejected was
  already guaranteed to throw on execution. It also closes cycle detection over nested
  regions, since region bodies are cycle-checked by `analyzeRegion` here rather than by
  `detectCycles`.
- **`validateNodeTypes` covers region nodes.** Soft-fail. A node in a `loop` body is as
  executable as one beside it, so the warning that exists to predict `NO_EXECUTOR` went
  quiet on exactly the nodes whose run-time failure is hardest to place.
- **`validateNodeConfigKeys` covers region nodes.** Hard-fail. `visibleIf` is the typo
  #4277 exists to catch, and moving the node into a region restored the silence #4277
  closed. Violations carry the region (`loop 'sweep' body · node 'w' …`). No
  double-reporting from the container side: all three container descriptors declare their
  region slot as a bare `nodes: { type: 'array' }` with no `items`, so the schema-lockstep
  walk stops there instead of descending twice.

**Measured before extending the two hard-fail checks**, since widening a rejecting
validator is a behaviour change rather than a bugfix: registering every flow in
`app-showcase`, `app-crm` and `app-todo` through the real `registerFlow` and re-running
each validator's own code over all 9 region graphs produced **0 new findings**. Nothing
that registers today stops registering, so the checks land at their existing severity
rather than staged through a warning window.

`validateNodeInputSchemas` is deliberately **not** extended. It declares 0 uses across all
159 example flow nodes, and its check compares a config value's runtime type against the
declared one — so extending it would newly fail a region node carrying a `{var}` template
string in a `number`-typed slot, which is a live authoring shape. Widening a check with a
known false-positive mode and no demonstrated reader is not worth it; the traversal gap is
noted on #4389 instead.
