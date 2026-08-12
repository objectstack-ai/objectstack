---
"@objectstack/service-automation": patch
---

fix(services): a paused run's variable snapshot is readable on run-detail (#7639)

While an automation run was **paused**, `GET /api/v1/automation/{flow}/runs/{runId}`
carried no `variables` key at all — so a run stopped at an approval, a screen or a
wait, which is precisely the state an operator most often needs to inspect,
answered with no variable state. "What did the previous node actually produce, and
why did the next one route the way it did?" was not answerable from the product;
it could only be inferred backwards from whatever the next node happened to
resolve.

This was structural, not a data gap. `ExecutionLogSchema` has declared
`variables` ("Final state of flow variables") since the schema was written, and
the engine's own log entry declared it too — with no producer anywhere, so the
key the run-detail read publishes was never populated. The engine already held
the answer: both `status: 'paused'` `recordLog` call sites sit a few lines below
the suspend bookkeeping that computes `Object.fromEntries(variables)` for the
continuation. The snapshot simply never reached the surface a caller can read.

Both paused sites now write it — the initial-execution suspend **and** the
resume-path re-suspend, so a multi-stage approval is readable at every stage
rather than only the first. Each site takes ONE snapshot expression and hands the
same object to the continuation and to the log entry, so what an operator reads
can never disagree with the state the run will resume from.

The snapshot is **point-in-time at the suspend**, not a live read: the variable
map is dead by then (the run has unwound; resume rebuilds a fresh map from the
continuation), so there is nothing later to diverge from.

Nothing about the exposure envelope changes: the run-detail read serves the log
entry verbatim — no projection, redaction or masking on any field — and
`variables` receives exactly that same treatment, under the same anonymous
baseline that already gates the whole `/automation` domain. Terminal runs keep
exactly the fields they had; only `paused` gains the key.
