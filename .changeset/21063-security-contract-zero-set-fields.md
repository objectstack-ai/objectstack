---
'@objectstack/spec': minor
---

docs(spec)!: the security service contract's field answers for a caller who resolves no permission set exclude the fields that declare `requiredPermissions` (#21063)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Only the prose of the ISecurityService interface moves: no method, parameter, return type, schema key or stored shape changes, so objectstack migrate meta has nothing to rewrite. The answers it now states are the ones every field-level requiredPermissions declaration already implied. -->

**BREAKING for implementers and consumers of `ISecurityService` field answers.**

**What changed.** The contract in `@objectstack/spec/contracts` now states the
field answers for a non-system caller who resolves no permission set. Such a
caller holds no permission-set field grant and no capability. No grant narrows
its answers, and a field's own declarations still apply: a field that declares
`requiredPermissions` is not in its `getReadableFields` answer (unless a
`maskingRule` on the field serves it masked, which keeps it as a served
column), and it is not in its `getWritableFields` answer.
`getMetadataReadableFields` answers the same for that caller when the
deployment's fallback set resolves to nothing. The contract used to say the
data-plane answer for that caller was the full field set, because the engine
middleware skipped its whole field gate for it. The middleware skips only its
permission-set grant gates.

**Who this reaches.** An implementation of `ISecurityService` must answer this
way for that caller. A consumer that relied on the full field set for that
caller now receives the narrower answer from the reference implementation
(`@objectstack/plugin-security`).

**What to do.** An implementation folds each field's `requiredPermissions`
into its answer for this caller exactly as it does for a caller whose
permission sets lack the capability. A consumer needs no change.
