---
'@objectstack/objectql': patch
---

docs(objectql): the per-row `before*` docblock states the #16074 rule — a row-invariant-in-effect rewrite is ADMITTED (#17975)

`dispatchPerRowBeforeHooks`'s docblock (ADR-0058 Addendum II, clause D3) still
said per-row `previous` was supplied *"so a guard can REFUSE the write (throw),
not so a rewrite can be aimed"*, and a test comment in
`bulk-write-per-row-hooks.test.ts` said the same. Ruling #16074, landed in
`@objectstack/spec` by PR #17249, retired that: a per-row `previous`-conditioned
rewrite is admitted when its written KEY SET is the same on every matched row
and is assigned IN PLACE, kept safe by the engine's
`MULTI_UPDATE_HOOK_KEY_DIVERGENCE` refusal (#14099). Key-set divergence, a
per-row VALUE and a row-conditioned REPLACEMENT of `ctx.input.data` all stay
outside the contract.

This is published text, not an internal comment: JSDoc on a `private` member
survives `.d.ts` emit. Measured in the shipped `@objectstack/objectql@17.4.0`
tarball — the retired sentence is present in six published files, including
`dist/util-Dw5ZTIII.d.ts:3554`, on a member of the `ObjectQL` class that both
the `.` and `./core` entrypoints export. Every consumer's editor surfaces it on
hover, so as soon as spec's changeset is consumed the two packages would state
opposite contracts.

No behaviour change: the engine already follows the new rule, and the three
shipped provenance stamps (`email-template-provenance.ts`,
`sharing-rule-provenance.ts`, `webhook-provenance.ts`) all assign in place. The
admitted shape's coverage already exists in
`multi-update-hook-key-divergence.test.ts`; the test comment now points at it.
