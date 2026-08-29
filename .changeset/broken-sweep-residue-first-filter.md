---
"@objectstack/spec": patch
---

docs(spec): the last three broken-sweep mentions in `automation` become the first FILTER, and the misspelled-`effect` sentences state the direction the code measures (#13063)

#12685 measured that `selected > 0 AND acted = 0 AND unmeasured = 0` cannot separate a
healthy idempotent sweep from a dead gate, and #12721 / #12722 / #12900 / #13068 rewrote
the surfaces that stated it as a detector. Each of those changes was fenced to the doc
blocks its dispatch named, so three mentions inside `packages/spec/src/automation`
survived — including one that ships in `.d.ts` and is what a platform author reads.

Reworded to the shape the sibling surfaces now agree on: the predicate is the FIRST
FILTER and not a verdict, the per-node fold (`FlowRunSummary.nodes[]` / `gates[]`) is the
discriminator, and each clause keeps its own true point.

- `ExecutionStepMetricsSchema`'s `unmeasuredEffect` rationale no longer says an
  understated `0` "fires the broken-sweep alert on a healthy run until operators learn to
  ignore it". That muting is not peculiar to an understated `0` — after #12685 the filter
  selects every healthy idempotent sweep — so the block now states what a fabricated
  count actually costs: an understated `0` puts a run that DID act inside the filter, an
  overstated `1` keeps a run that acted on nothing outside it, and a faked `acted` is a
  fact the per-node fold can only repeat rather than settle.

Separately, and measured rather than ruled: the two sentences describing a misspelled
`effect` key stated their consequence backwards. Read forward, a lost `effect: 'writes'`
declaration means the `script` step reports no `unmeasuredEffect`, so the run reports
`selected > 0, acted 0, unmeasured 0` — which SATISFIES the filter. The run therefore
lands INSIDE the candidate set reading exactly like a dead sweep, rather than escaping
it; the declaration is what would have kept it out. That is how the same file's `@module`
block already stated it, and what `flow-function-effect.dogfood.test.ts` asserts end to
end. The `FlowFunctionDeclarationSchema` TSDoc and the author-facing `history` string in
its unknown-key message now say so.

TSDoc and one error-message string only — no behaviour, no schema, no accept-set change.
