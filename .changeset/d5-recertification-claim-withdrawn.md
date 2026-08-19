---
"@objectstack/plugin-security": patch
---

fix(security): the ADR-0091 D5 attestation columns stop claiming a recertification review the platform does not run (#9046)

`last_certified_at` and `certified_by` are declared on both grant tables
(`sys_user_permission_set`, `sys_user_position`) as the ADR-0091 D5
recertification *substrate*. A whole-tree sweep over `packages/`, `apps/` and
`examples/` — every `.ts`/`.tsx`, tests included — finds the pair in exactly two
kinds of place: those two declarations and the generated i18n bundles carrying
their strings. **No producer and no consumer.** Nothing stamps either column,
nothing reads either one, and no surface derives "never certified" or
"certification stale" from them. The sweep is not blind: the sibling ADR-0091
columns on the same objects all resolve to real enforcement — `valid_from` /
`valid_until` through `isGrantActive` at resolution time, `reason` and
`delegated_from` through the delegated-admin gate and the security-posture lint.

Their descriptions nonetheless stated D5's intent as though it were the
behavior — *"When this grant was last attested in a recertification review. Null
= never certified"* and *"Reviewer who last attested this grant."* Access
recertification is a compliance control (SOX / ISO 27001 access review), so that
misreading is the expensive kind: an admin walking `plugin-security`'s objects,
or an AI agent authoring against this model, takes a populated `Last Certified
At` as evidence of a review the platform never performed and never checked.

ADR-0049 enforce-or-remove, settled the way `sys_capability.active` was
(maintainer ruling, 2026-08-13): **the claim is withdrawn in prose.** Building
the review workflow is a designed feature with no measured pull, and dropping
shipped columns costs a migration over existing rows while buying nothing the
prose fix does not — the harm here is the promise, not the storage, and a
description is one line to change back if D5 is ever implemented. The columns,
their types and their storage are untouched; no producer and no consumer is
added, deliberately.

Both descriptions now state the inertness outright rather than merely omitting
the promise, so a reader who remembers the old wording is told it was wrong
instead of being left to infer it. All four locale bundles carry the corrected
text.
