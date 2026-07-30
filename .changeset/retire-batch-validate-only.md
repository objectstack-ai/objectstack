---
"@objectstack/spec": major
---

feat(spec)!: retire `BatchOptions.validateOnly` — a dry-run flag that was never implemented (#4052)

`BatchOptions.validateOnly` promised a dry-run — "validate records without
persisting changes" — but no batch surface ever read it. `updateManyData`,
`deleteManyData` and `batchData` all persist regardless, so a caller sending
`options.validateOnly: true` to PREVIEW a mutation got it executed. That is the
dangerous direction of "declared ≠ enforced": a flag lying about a data-safety
guarantee, not merely an inert no-op.

There is no dry-run today. Rather than back-fill an implementation to match a
promise nothing kept — a real no-commit batch has its own design space (cascade
and constraint semantics under rollback, a response contract that reports each
row's would-succeed verdict) — the key is retired so it can be reintroduced
deliberately when there is a real need.

**Breaking change.**

- `BatchOptions.validateOnly` is a retired key. It is tombstoned (`retiredKey`)
  in `BatchOptionsSchema`, so authoring it now fails with a fix-it prescription
  rather than being silently stripped (the ADR-0104 / #3733 quiet-failure class).
  The `BatchOptions` type's `validateOnly` becomes `never`.
- The retirement is HTTP-only (the key never appeared in stored stack metadata),
  so it is recorded as a semantic migration on the protocol-18 chain step
  (`batch-options-validate-only-retired`) — a TODO for API callers, not a stack
  conversion.

**Migration.** Stop sending `options.validateOnly` on `/batch`, `/updateMany`
and `/deleteMany`. It never previewed anything; removing it changes no behaviour.
If you need to validate a batch without writing, follow #4052 so a real
no-commit preview can be designed.

Also fixes a dangling documentation reference: the `/createMany` route
registration named `requestSchema: 'CreateManyRequestSchema'`, a schema no
module ever exported — pointed at the real `CreateManyDataRequestSchema`.
