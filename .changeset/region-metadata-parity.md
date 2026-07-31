---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
'@objectstack/lint': patch
---

Flow metadata is canonicalized inside structured regions, not just at the top level (#4347).

`registerFlow` canonicalizes a stored flow through three passes — the ADR-0087 conversion
table, `FlowSchema.parse`, and the ADR-0032 predicate validation — and every one of them
walked `flow.nodes` / `flow.edges` only. An ADR-0031 container keeps a whole sub-graph in
its open `config` (`loop.config.body`, `parallel.config.branches[]`,
`try_catch.config.try`/`.catch`), so all three stopped at the container and metadata came
out **position-dependent**: the same node converted at the top level and did not one level
in, and the same predicate was stored as a `{ dialect: 'cel', source }` envelope on a
top-level edge and left a bare string on a loop-body edge.

The reporting app shipped three sweeps whose gates never opened. Each run reported
`success: true`, queried correctly, selected exactly the right records, and then did
nothing — which is indistinguishable from "this sweep had no work to do" unless you assert
on records written.

- **`mapFlowNodes` recurses into regions**, to any depth. Every conversion in the table now
  reaches a nested node, which matters most for the two that change behaviour rather than
  spelling: a `webhook` / `http_request` callout inside a loop body kept a type no executor
  owns (the run failed), and a `delete_record` kept `config.filters`, leaving the canonical
  `filter` the executor reads absent — the erased-condition hazard
  `flow-node-crud-filter-alias` exists to prevent. Notice paths carry the region
  (`flows[0].nodes[3].config.body.nodes[1].config.filter`), so the warning points at the
  node to edit.
- **New `normalizeControlFlowRegions`**, called at the load seam after
  `validateControlFlow`: each region is parsed through its own schema (recursively — regions
  nest), so nested edges and nodes carry the same canonical shapes as top-level ones. A
  region that does not parse is left untouched; rejecting one stays `validateControlFlow`'s
  job, so which flows register is unchanged.
- **New `collectFlowGraphs`** yields a flow's own graph plus every nested region, each with
  a scope label. Both predicate validators iterate it instead of `flow.nodes` — the engine's
  `validateFlowExpressions` and `@objectstack/lint`'s author-time
  `validateStackExpressions` — so the `{record.x}` brace-trap they exist to catch is now
  caught inside a loop body too, naming the region (`loop 'sweep' body · edge 'b1' …`). It
  used to pass `objectstack validate`, pass registration, and fail at run time with the
  diagnostic suppressed.

The container executors already parse their own config at run time (`parseNodeConfig`,
#4277), so a nested predicate did evaluate correctly on current `main` — what was still
wrong is everything that reads a region *without* re-parsing it (the Studio designer,
`getFlow`, the version history), and every conversion, none of which the executors replay.

Also hardened, per the issue's secondary finding: `evaluateCondition`'s legacy `{var}`
template path **refuses an unresolved dotted reference** instead of comparing it as a
string. `'oppRecord.amount > 500000'` was compared `'oppRecord.amount' > '500000'` — `'o'`
against `'5'` — so it was constantly true regardless of the amount: silently wrong in the
*true* direction, a gate that reports success while never gating. It now throws with the
source and the fix (a CEL envelope, or brace the reference if the `{var}` dialect was
meant), the same "never swallow a broken predicate" rule ADR-0032 §1c set for the CEL path.
The `try { … } catch { return false }` around that block went with it: nothing in it throws,
so it guarded nothing and would have swallowed the new refusal straight back into the silent
wrong answer. Bare-word comparisons (`'{status} == active'`) and `{var}` templates are
unchanged — only dotted references, which substitution can never leave behind, are refused.
