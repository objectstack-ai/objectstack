---
"@objectstack/spec": patch
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol,spec): a bulk write that STOPS now reports every record — `NOT_ATTEMPTED` rows instead of a truncated `results` array, and counters that reconcile (#7539)

`POST /data/:object/batch` with no `options` (so `atomic` defaults `false`,
ADR-0119 D4) and three records — valid, failing, valid — answered:

```
200 { "total": 3, "succeeded": 1, "failed": 1,
      "results": [ { idx 0: ok }, { idx 1: VALIDATION_FAILED } ] }
```

Two results for three records, no entry for idx 2, and `succeeded + failed` (2)
`!= total` (3). The un-attempted record was invisible **twice over**: it
produced no `results[]` entry and was counted in neither bucket, so the only
trace of it was an arithmetic mismatch a client had to notice and interpret.

`buildBatchDataResponse` read `total` from the REQUEST (`records.length`) while
`results` / `succeeded` / `failed` came from a loop that had stopped early. Its
two siblings under-reported identically — the same defect on `updateManyData`
and `deleteManyData`, whose per-object bulk counters lost the tail whenever a
row failed without `continueOnError`. All three now go through one shared
reconciler rather than a fourth copy of the same arithmetic.

**What changed is the REPORT, not the semantics.** Every record now gets a row
saying what happened to it: records after the failure carry
`errors[0].code === 'NOT_ATTEMPTED'` — the same registered ADR-0112 code the
atomic arm has emitted since #4793, because "never ran" means the same thing to
a client whether the batch stopped to roll back or stopped because it was told
to. The message names the causal row index and `continueOnError`, since on this
arm the caller's next action is a flag rather than a fixed row. `results` now
always covers all `total` records, and `succeeded` / `failed` partition it, so
`succeeded + failed === total === results.length` on both arms.

**The stop itself is unchanged, deliberately.** Without `continueOnError` the
first failure still ends the run, records written before it stay written
(nothing is rolled back on this arm), and the tail is still not attempted.
That is the declared contract, not an accident:
`BatchOptionsSchema.continueOnError` reads *"If true (and atomic=false),
continue processing remaining records after errors"*, ADR-0119 D4 scopes the
flag to exactly `atomic=false`, and D4's test plan holds non-atomic batches to
"behave exactly as before". If `atomic: false` alone continued past a failure,
`continueOnError` would be inert. Callers who want every valid row to land
should send `continueOnError: true` — unchanged, and now the only difference
between the two is whether the tail is attempted, not whether it is reported.

**Upgrade note.** A non-atomic batch that stops now returns more `results` rows
and a larger `failed` count than before, for the same request and the same
writes. `failed` counts every row that is not a success — matching the atomic
rollback response, which has always counted never-reached rows this way. A
client that summed `succeeded + failed` and compared it to `total` to detect
truncation no longer needs to; one that treated `failed` as "rows the server
tried and could not write" should branch on `errors[0].code` instead, where
`NOT_ATTEMPTED` distinguishes "skipped" from "attempted and failed". No schema
field was added or removed.
