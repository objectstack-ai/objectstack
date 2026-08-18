---
'@objectstack/spec': minor
---

Retire `BATCH_PARTIAL_FAILURE`, `BATCH_COMPLETE_FAILURE` and `TRANSACTION_FAILED` from `StandardErrorCode` (ADR-0112 amendment 2026-08-18, ADR-0049 enforce-or-remove, #9266). Breaking for the error vocabulary: the three spellings now fail `StandardErrorCode` / `ApiErrorSchema` parse. No producer has ever emitted any of them — the batch surface reports these conditions per row instead, with strictly more information.

FROM → TO: `error.code === 'BATCH_PARTIAL_FAILURE' | 'BATCH_COMPLETE_FAILURE' | 'TRANSACTION_FAILED'` (envelope-level, never emitted) → read the per-row `results[].errors[].code` — a rolled-back atomic batch marks each row `ROLLED_BACK`, rows the abort never reached `NOT_ATTEMPTED`, and the causal row keeps its own error (HTTP 200, both codes ledger-registered). One-line fix: delete any branch on the three retired spellings (it never fired) and branch on the per-row codes instead.

<!-- adr-0087: registered standard-error-code-batch-members-retired -->
