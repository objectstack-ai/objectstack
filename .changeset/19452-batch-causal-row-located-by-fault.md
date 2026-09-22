---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a stopped or rolled-back bulk batch names the row that actually failed

`reconcileStoppedBatch` and `buildRolledBackBatchResponse` — the two builders every one of the three bulk-write faces (`batchData`, `updateManyData`, `deleteManyData`) reports through — located the causal row with `findIndex(r => !r.success)`. That encoded an invariant: **`!success` means this row failed, and it carries `errors[0]`.**

That invariant stopped holding when a matched-but-deliberately-not-removed row started answering `success: false` with no `errors` entry — correctly, because a surviving record is an outcome, not a fault. The locator could then land on that survivor, `errors?.[0]?.message` was `undefined`, and the message named the **wrong index** while calling the real error — sitting in the same array — 「unknown error」.

Measured on the unfixed tree:

- non-atomic `deleteMany ['survivor', 'missing', 'other']` — the un-attempted row answered `NOT_ATTEMPTED` *"record 0 failed — unknown error; the batch stopped there. …"* while record **1** is what threw;
- atomic `[t1, survivor, t3]` — the rolled-back rows answered `ROLLED_BACK` *"record 1 failed — unknown error"* for a row that **survived**;
- atomic `[t3, survivor, missing, t2]` — `ROLLED_BACK` said *"record 1 failed — unknown error"* and `NOT_ATTEMPTED` said *"atomic batch aborted by record 1"*, both naming the survivor while record **2** threw.

Both builders now share one locator, `locateBatchCause`, which finds the row by its recorded **fault** — the row's `errors[]` entry. That is the one per-row value whose declared meaning is a failure: `BatchOperationResultSchema.errors` is documented as *"Array of errors if operation failed"*, and the v17 migration entry publishes `row.errors?.[0]?.message` / `.code` to consumers as exactly that read. Its codes are drawn from the closed `StandardErrorCode ∪ ERROR_CODE_LEDGER` vocabulary, so an unregistered code fails `BatchOperationResultSchema.parse` — giving a non-fault ending an `errors[]` entry is a ledger widening in `packages/spec`, not something a call site can do on its own. `ApiError.message` is required, so a located cause always has text and the 「unknown error」 fallback is **deleted** rather than merely unreached.

The scan runs from the end of the attempted rows, because a run ends *at* the row it stops on: every stop is a `break` in a loop's `catch`, immediately after that row was pushed. A fault that does not stop the run (the `Unknown operation:` arm records one and keeps going) therefore cannot shadow the row that did.

One ending has no fault to quote at all — an atomic batch aborted by a lone survivor, where `runAtomicBatch` rolls back on `failed > 0` and nothing ever threw. The rolled-back rows now read *"record 1 did not succeed"*: the row that stopped the batch committing, named as what it is rather than as a failure with an unknown cause.

No envelope field, per-row code, status or count changes; `succeeded` and `failed` still partition `results`. What changes is which row two message strings name, and both of them stop inventing an error that is not there. Clients branch on `errors[0].code`, which is unchanged — the row classification itself was never wrong.

`Clause-②: no` — nothing authorable moves: no `packages/spec` key, export, accept set or stored shape changes, and the per-row code vocabulary is untouched.
