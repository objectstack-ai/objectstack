---
"@objectstack/spec": patch
---

docs(spec): re-measure and rewrite four expired post-#5702/#5710 status claims in `src/data` (#6993)

Four status sentences in `filter-text-conformance.ts`, `filter-text-conformance.test.ts`
and `filter.zod.ts` still described the pre-#5702/#5710 world as current: "`$icontains`
… implemented by nobody", "a standard no backend answers yet", the `$regex` retirement
block's "hard order: #5710 flips the producer, then #5702 turns these strings into
refusals" (both gates fired since), and "`$options: 'i'` are #5702's work" (the fold is
still there; its owner is #6682 now). Each was re-measured by executing every face —
the five drivers (both turso transports), `formula`, objectql `having`, the analytics
read-scope compiler — plus a fresh run of `scripts/check-driver-conformance.mjs`, and
rewritten to state the shipped reality with dated re-verification markers, pointing at
the gate-maintained conformance ledger instead of hand counts where one exists.

No behaviour change: no operator added to `FILTER_OPERATORS`, no refusal or assertion
touched, generated artifacts byte-identical. The one measured gap the census surfaced
(objectql `having` refuses retired operators outside the ADR-0112 envelope) is filed
as #7047, not fixed here.
