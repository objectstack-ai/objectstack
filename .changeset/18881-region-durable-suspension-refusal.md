---
"@objectstack/service-automation": patch
---

A node that **durably suspends inside a structured region body** now FAILS the run with a named refusal that carries the region node, the suspending node and the sub-flow — instead of being read as an ordinary region failure that a `try_catch` could contain, after which the run reported success over a sweep that had processed nothing (#18881, the runtime half of #15646's ruling D).

An ADR-0031 region body — a `loop` body, a `parallel` branch, a `try_catch` try or catch region, **at any depth** — runs synchronously inside the enclosing run and cannot park it on a durable pause. #3267 ruled that limit 禁. `runRegion` already converted such a suspension, but into a plain `Error`, which is indistinguishable from a node that simply failed.

Measured on the card's reproduction, `loop { try_catch { map(pausing child) } }`, before this change:

```
result.success   true          // the catch handler ran and "recovered"
run.status       completed
summary.failed   0             // over 0 of 10 child runs
```

The `map`'s progress state (`<nodeId>.$mapState`) is written into the **enclosing** scope, so the residue a contained refusal leaves is read back as progress by the next entry to the same node: iteration 2 saw `started === collection.length`, ran nothing, and reported success. A sweep that reports green having done nothing is the worst available failure, and it is the one the run-level `failed` counter (#14456) was built to expose.

What changed:

- **`FlowRegionSuspensionRefusalError`** (new internal module `region-suspension-refusal.ts`, ⛔ not exported from the package entry) carries `regionNodeId`, `regionKind`, `suspendedNodeId` and `subFlowName` as fields as well as in its message, so a reader never parses the sentence. It is branded as a #3863 guard refusal, so a `fault` edge on the enclosing container cannot route it either.
- **`try_catch` re-throws it** from both the try-attempt arm and the catch-region arm rather than treating it as a region failure, and ⛔ spends no retry attempt on it — re-entering the region would re-enter the pausing node, and the metadata is what is wrong. **`parallel` re-throws it** rather than folding it into its returned (and therefore routable) branch failure. `loop` already re-threw unchanged.
- **One refusal is one failure.** The region node's own frame records the `EXECUTION_ERROR` step and publishes `{$error}`, exactly as any thrown node failure does; every enclosing container the unwind passes through records nothing, so `summary.failed` counts the fault and ⛔ not the nesting depth.

⛔ **Nothing changes for a region whose nodes complete synchronously.** `loop { map(synchronous child) }`, `parallel { branch: [map(synchronous child)] }` and #15616's regression suite run exactly as before — pinned as explicit controls beside every refusal case, because without them a reader cannot tell "the durable pause is refused" from "the region path was closed off".

⛔ **No authoring-time rule is added here**: #18688 landed that half in `packages/spec` and it refuses `screen` / `wait` / `approval` / `approval_revise` / `end` inside a region body by type. `map` and `subflow` are deliberately not refused there — whether they pause is decided by the child flow record their `config.flowName` names — which is exactly why the runtime arm has to exist.

⛔ **No new `error.code`.** The closed `ERROR_CODE_LEDGER` (ADR-0112) lives in `packages/spec`; the refusal is named by its type and its fields, and the step it produces keeps the `EXECUTION_ERROR` code every thrown node failure has always carried.
