---
"@objectstack/lint": patch
---

Flow-node-list readers no longer throw on a non-record member — `lintFlowPatterns`, `collectFlowVariableNames` and the three record-change template-path readers now coerce through `recordsOf`.

`lintFlowPatterns` crashed on an ordinary flow. A YAML `nodes:` list item left empty deserialises to `null`, and the rule read `nodes.find(n => n.type === 'start')` off a list it had only `Array.isArray`-checked, so an author's own metadata turned `objectstack validate` into an uncaught `TypeError` out of a function contractually typed `(stack) => Finding[]`:

```
TypeError: Cannot read properties of null (reading 'type')
    at lint-flow-patterns.ts:1430
```

`Array.isArray` proves the LIST, never its MEMBERS — the same sentence removed from `validate-expressions.ts` one file over. All seven readers now go through `recordsOf` (`object-graph.ts`), which stays the single home for this coercion; no new copy of the predicate is declared.

- **`lintFlowPatterns`** — `flow.nodes` is coerced once, and that coerced array is what is handed on to `collectFlowGraphs`. That second half is the load-bearing one: `collectFlowGraphs` is transparent about members (it forwards the caller's array and re-exposes the same objects), so coercing only for the local read would have moved the crash into `packages/spec` rather than removing it. Its two `graph.nodes` readers are coerced as well, because a nested region's node list reaches them with only an `Array.isArray` behind it.
- **`collectFlowVariableNames`** — the `graph.nodes` walk had no member guard while the `flow.variables` walk seven lines above it did. Reachable today only at a region nest of exactly `MAX_REGION_DEPTH`; it now cannot throw at any depth.
- **The three record-change template-path readers** (`boundObjectOf`, `declaredExpandOf` and the per-flow start lookup in `validateFlowTemplatePaths`) were **not** throwing. They survived on an optional chain in the `.find` predicate — one character's difference from the reader that did throw, maintained by nothing and looking redundant next to the `Array.isArray` above it. They are coerced for the same reason and the optional chain goes with it. This half is a hardening, not a bug fix.

A malformed member is dropped, in silence, exactly as `recordsOf` drops one everywhere else; the valid nodes standing beside it are still judged and the findings a flow draws are unchanged.
