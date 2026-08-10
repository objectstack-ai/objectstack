---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": minor
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-reports": patch
---

refactor(spec,plugin-sharing): retire the exported `SharingExecutionContext` type (#7218)

<!-- adr-0087: registered sharing-execution-context-retired -->

**BREAKING — public surface removal.** `SharingExecutionContext` is deleted from
`@objectstack/spec` (`contracts/sharing-service`) and from
`@objectstack/plugin-sharing`, which re-exported it. Both `api-surface/` and
`export-origins/` snapshots are regenerated accordingly.

This is the deferred deletion recorded when #7070 split the convergence in two.
#6523 / PR #7068 converged 36 contract signatures onto the full
`resolveAuthzContext` envelope (`ExecutionContext`), applying the #6206 ruling —
enforcement adjudicates on the whole envelope, never a per-site subset. The
consumer halves then re-annotated the implementations: PR #7140 (identity:
`plugin-sharing`, `plugin-audit`) and PR #7206 (services: `plugin-approvals`,
`plugin-reports`). Both landed with the type still exported, because it is
DEFINED in `packages/spec` and that package's retirement is the spec seat's to
make. Nothing declares it any more, so it goes.

**Migration.** Anyone who imported `SharingExecutionContext` from either package
should import `ExecutionContext` from `@objectstack/spec` instead — the type the
contracts have declared since #7068. The old shape was six optional fields, all
of which exist on the envelope with the same names and types, so a value that
satisfied the retired type already satisfies `ExecutionContext`; only the
spelling of the annotation changes.

**No runtime behaviour changes.** The type was erased at compile time and no
signature's accepted shape moved: the contracts already took the wide envelope.

**What the retirement did NOT remove — the reason to read the pins.** Deleting
the type does not make re-narrowing a compile error. Structural subtyping still
accepts a six-field context where the envelope is expected, so the boundary is
held by the declared parameter type plus the pins, exactly as before. The three
`exec-context-annotation.pin.ts` files (`plugin-sharing`, `plugin-approvals`,
`plugin-reports`) told their failure story as "the parameter narrows back to
`SharingExecutionContext`", which a deletion would have quietly hollowed out.
Each now keeps the retired six-field shape as a local, non-exported SPECIMEN
type and refutes every enforcement parameter against it by type identity, so a
re-narrowing under ANY name is red — alongside the fresh-literal
excess-property checks they already carried. `sharing-service.test.ts` in
`packages/spec` is re-anchored the same way, and its "twin unchanged in shape"
case becomes a "twin stays retired" case. The narrative the retired type's doc
block carried (the measured `(context as any).posture` specimen, and why tsc
cannot police this) moves to the module doc of `contracts/sharing-service`,
which the contracts and pins now point at.
