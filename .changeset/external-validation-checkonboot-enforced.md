---
"@objectstack/runtime": patch
---

fix(runtime): honour `datasource.external.validation.checkOnBoot` in the boot validation sweep (#13037)

`checkOnBoot` has been declared on `DatasourceSchema` — with `.default(true)` —
since the `external.validation` block was written, and **nothing read it**. Its
two block-mates are read (`onMismatch` by `resolveOnMismatch()`,
`checkIntervalMs` by `scheduleDriftChecks()`), which is what made the gap legible
rather than a whole-block miss: `ExternalValidationPlugin.start` hooked
`kernel:ready` and called `runValidation(ctx)` with no condition on it.

So an author who wrote `validation: { checkOnBoot: false }` and left `onMismatch`
at its default got the boot sweep anyway, and a measured mismatch threw
`ExternalSchemaMismatchError` and **aborted boot** — the exact outcome the key
reads as opting out of. The `.default(true)` made it worse than an ignored key:
the knob is materialized into every parse output, so a dead setting is
byte-identical to an honoured one in stored and serialized datasources, and
neither an author, an AI author, nor someone reading the metadata store could
tell which one they had.

Maintainer ruling 2026-08-29 — ADR-0049 disposition **enforce, not remove**:

- `checkOnBoot: false` ⇒ that datasource is skipped by the `kernel:ready` sweep.
  No `onMismatch` policy is applied to its rows, so a measured mismatch on it can
  no longer abort startup; its unreachable-remote rows raise no boot warning; and
  its objects are not counted in the all-clear. The skip is logged once, naming
  the datasources and stating that the verdict beside it covers the remaining
  ones only.
- `checkOnBoot: true` or absent ⇒ today's behaviour, unchanged — a measured
  mismatch still throws `ExternalSchemaMismatchError` and aborts boot under the
  default `onMismatch: 'fail'`.

The gate is **per datasource**, because the sweep is whole-farm and the key is
per-source: in one boot, an opted-out datasource does not suppress another
datasource's abort. Every uncertainty resolves towards running the check — an
absent key, an unparsed or legacy stored row, a managed datasource with no
`external` block, and a definition the metadata service could not read are all
validated, never inferred to have opted out.

**Scope, pinned at the ruling: the boot step only.** `scheduleDriftChecks()` and
its `external.validation.checkIntervalMs` read point stay independent — a
datasource that opts out of the boot check keeps whatever background drift
checking it armed. The two keys answer different questions ("gate my startup on
this" versus "watch this while I run"), and both the code comment and a test hold
that boundary.

Not a contract-face change: no schema, no key, and no accepted spelling moves.
`checkonboot` and `validateonboot` remain what they already were — entries in the
`strictObject` rejection table that refuse the misspelling and prescribe
`checkOnBoot` — so `checkOnBoot` is the single authorable spelling and the gate
has a single read point.
