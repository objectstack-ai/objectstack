---
"@objectstack/spec": patch
---

feat(spec): register `@objectstack/driver-memory` as an emitter of `UNIQUE_VIOLATION` in the error-code ledger (#13254)

`ERROR_CODE_LEDGER` (ADR-0112 D3) lists a code once per emitting package —
its own header calls those rows "provenance, not identity", and they are how a
reader answers "who produces this code?".

Since the in-memory driver started enforcing uniqueness (field-level `unique`,
and object-level declared `indexes[]` entries carrying `unique`), a colliding
write is refused with `code: 'UNIQUE_VIOLATION'` / `status: 409` — stamped in
one place for both declaration surfaces by `conflictRefusal` in
`packages/drivers/driver-memory/src/memory-unique-constraint.ts` — while
`@objectstack/driver-memory` had no row at all. No gate could see that: the
ledger's admission rules check casing, duplication and shadowing, never who
emits, and the code itself was already registered by `@objectstack/rest`, so
union membership, `ApiErrorSchema` parsing and
`check:dispatcher-error-vocabulary` were all green over the gap.

Pure provenance append: one new owner key naming the one code. No code's
identity, status, casing or union membership changes, no other package's rows
are touched, and the generated reference products are unchanged because the
deduped union they enumerate is unchanged.
