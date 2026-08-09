---
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-audit": patch
---

refactor(plugin-sharing,plugin-audit): enforcement implementations annotate the full `ExecutionContext` (#7136)

The consumer half of #6523. That change converged 36 contract signatures onto
the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
enforcement adjudicates on the whole envelope, never a per-site subset. The
implementations behind those contracts still annotated their own parameters
with `SharingExecutionContext`, the six-field shape the contracts used to name,
so nothing they could *read* had widened.

`SharingService`, `SharingRuleService`, the sharing exec-context seam and
plugin-audit's comment-access gates now declare `ExecutionContext` on all 27 of
those parameters — plus the two return types that produce the contexts feeding
them — and the casts the narrow annotation forced are gone:

- `exec-context-seam.testkit.ts` resolved a REAL context and then had to force
  it into the narrow type — `{ ...authz, isSystem: false } as unknown as
  SharingExecutionContext`. It now returns what it resolved, so a drift in
  `resolveAuthzContext`'s output reaches the tests that trust this seam instead
  of being absorbed by a double cast.
- `SharingRuleService`'s system context is typed as the envelope and passed as
  itself, retiring `SYSTEM_CTX as any` at all 11 of its call sites — an erasure
  on an enforcement input switches checking off for the whole argument, not
  just for the readonly-array mismatch that provoked it.
- The `(context as any).userId` / `.tenantId` reads in `SharingService` now read
  declared fields.

**No runtime behaviour changes.** The values were always complete — this
family's damage was type-side — so every gate answers exactly what it answered
before. Method parameters only WIDEN what they accept, so no caller is affected.

Two casts are deliberately kept, and are now documented where they sit:
`__readScope` / `__writeScope` are private keys plugin-security's middleware
stamps onto the context it forwards and are not fields of the envelope, and
`organizationId` is not on the envelope at all — that spelling has its own
history (#5858 / `check:org-identifier`) and was held out of this change.

Because a re-narrowed annotation would compile, ship and pass every test in
these packages, the convergence is pinned by a new compile-time module,
`exec-context-annotation.pin.ts`: it hands each enforcement parameter a fresh
literal naming envelope-only fields (`posture`, `accessible_org_ids`,
`org_user_ids`), which TypeScript's excess-property check rejects the moment a
parameter narrows back, plus negative cases so a parameter erased to `any`
cannot pass either.
