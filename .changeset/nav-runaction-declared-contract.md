---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

feat(spec,lint): declare the SDUI deep-link "navigate = run action" as a validatable `runAction` nav reference (#4848)

The `?runAction=<actionName>` deep link (cloud#844) lived as two private string
halves — objectui's `CloudOnboardingNext.tsx` concatenating the query and its
`EnvironmentListToolbar.tsx` consuming it by literal match — an implicit
cross-repo contract neither side's rename turned red. Per the maintainer's
2026-08-06 ruling on #4848, the contract is now spec-declared, contract-first.

**New slot — `ObjectNavItemSchema.runAction` (optional).** An `object` nav item
may declare the action to auto-run once on arrival at the object's list
surface. The name resolves against the stack's declared actions (global
`stack.actions` + any object's `actions`) — the same "defined ANYWHERE" scope
every other name-bound action surface uses. `runAction` + `recordId` is
parse-rejected (`objectNavTargetExclusivity`): a record detail has no list
toolbar, so the combination is a dead affordance made unrepresentable.

**Validation, both layers.** `defineStack`'s cross-reference walk rejects a
`runAction` naming no defined action (size-gated like the neighboring
dashboard/page/report checks), and `validate-action-name-refs` gains a nav
`runAction` arm — error severity, near-miss "did you mean", running on every
`os validate`/`lint`/`compile` via the reference-integrity suite.

The slot is ledgered `planned` + `authorWarn` (enforce-or-mark, like
`object.externalSharingModel`'s P1): no shipped shell reads the declared slot
yet, so authors are told the auto-run still fires only via the transitional URL
query param until the objectui consumer half lands. cloud#1048's pin remains
the transitional guard.
