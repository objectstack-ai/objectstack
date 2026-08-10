---
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-reports": patch
---

refactor(plugin-approvals,plugin-reports): enforcement implementations annotate the full `ExecutionContext` (#7135)

The services half of #7070, mirroring what PR #7140 did for
`plugin-sharing` / `plugin-audit`. #6523 converged 36 contract signatures onto
the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
enforcement adjudicates on the whole envelope, never a per-site subset. The
implementations behind those contracts still annotated their own parameters
with the six-field shape the contracts used to name, so nothing they could
*read* had widened.

`ApprovalService`, the approval flow-node provider and `ReportService` now
declare `ExecutionContext` on all 43 of those positions, and the casts the
narrow annotation forced are gone:

- `isOverrideActor()` read the derived `posture` (ADR-0095) through an
  unchecked `(context as any)`. That gate decides whether a platform or tenant
  admin may release a STUCK approval — one routed to an unstaffed position, the
  only in-product recovery from a permanently locked record — so an erasure sat
  directly on an enforcement input: a mistyped rung would have compiled and
  silently denied every override. It is a declared read now.
- Both services' `SYSTEM_CTX` is typed as the envelope and passed as itself,
  retiring the `SYSTEM_CTX as unknown as …` double casts at the three sites
  that hand it to a contract method.
- The `(context as any).userId` / `.tenantId` reads in `ApprovalService` now
  read declared fields.
- `OwnerContextResolver` returns the envelope, which is what a scheduled report
  actually resolves for its owner (#2849 / #2980).

**No runtime behaviour changes.** The values were always complete — this
family's damage was type-side — so every gate answers exactly what it answered
before. Method parameters only WIDEN what they accept, so no caller is
affected, and no public export changes shape.

Casts deliberately kept, and now documented where they sit: `organizationId`
is not a field of the envelope at all — that spelling has its own history
(#5858 / `check:org-identifier`) and was held out of this change by #7070. In
`approval-node.ts` the single remaining assertion exists only because the
literal names that key; it was reduced from `as unknown as …` to a single
`as ExecutionContext`, which still requires the literal to be comparable to
the envelope.

Because a re-narrowed annotation would compile, ship and pass every test in
these packages, the convergence is pinned by a new compile-time module per
package, `exec-context-annotation.pin.ts`: it hands each parameter a fresh
literal naming envelope-only fields (`posture`, `accessible_org_ids`,
`org_user_ids`), which TypeScript's excess-property check rejects the moment a
parameter narrows back, plus negative cases so a parameter erased to `any`
cannot pass either.

The exported `SharingExecutionContext` type itself is NOT removed here: it is
defined in `packages/spec`, which is single-owner, so its retirement is a
separate follow-up.
