---
"@objectstack/lint": patch
---

fix(lint): `lintDataModel` reads only the canonical `reference` target (#13250)

`refOf` in `packages/lint/src/data-model-rules.ts` resolved
`def?.reference || def?.reference_to`, so a relationship field spelled with the
rejected alias resolved a target. #11567 settled that `reference` is the only
relationship spelling `@objectstack/spec` declares — `FieldSchema` answers
`reference_to` with `unrecognized_keys` and *"Did you mean `reference_to` →
`reference`?"* — and put it as "one key, one answer, on both doors".

`@objectstack/lint` runs over an in-memory, schema-parsed stack, so the alias
cannot legitimately appear here at all: the tolerance was inert. Where it did
fire, it made the rule whose entire job is to catch a relationship with no
target — `relationship/missing-reference` — report a valid target for a field
that has none, i.e. the one component that exists to tell an author their
metadata is wrong was the component accepting the wrong spelling.

This mirrors the deliberate canonical-only narrowing already recorded in-file
for `refOf` in `packages/lint/src/validate-security-posture.ts`, including its
`typeof r === 'string'` guard — which also makes the declared
`string | undefined` return type true, where the old `||` chain returned
whatever truthy value it found (a non-string `reference` was reported as a
resolved target).

What changes for a consumer, only for metadata the spec already refuses:
`relationship/missing-reference` (error) now fires on a relationship field
whose only target spelling is `reference_to`, and the rules that need a
resolved target (`relationship/master-detail-required`, `rollup/missing-summary`
and the rest of the relationship family) no longer treat such a field as
pointing anywhere. Canonical `reference` is untouched.

Scope note: the two remaining tolerant readers named in #13250 —
`packages/verify/src/derive.ts` and
`packages/plugins/plugin-security/src/security-plugin.ts` — are deliberately
NOT narrowed here. Both were measured to sit on populations the alias can
actually reach (raw `registerObject`, which skips Zod by design, and an app
config that never passes through a `define*` parse), so narrowing them is a
triage call rather than a defect fix.
