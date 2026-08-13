---
"@objectstack/lint": minor
---

feat(lint): `validateSecurityPosture` now gates `object` / `permission` / `book` writes at the runtime publish door (#8310)

The final slice of the #7891 strictness rollout (#4001 pattern): the
`validateSecurityPosture` registry entry declares `runtimeTypes: ['seed',
'object', 'permission', 'book']`, so the security-posture rule families run at
the runtime metadata publish gate (Studio, REST `/meta`, MCP/AI authors) for
those writes. A class of runtime writes that used to succeed is now refused
with a 422 — most notably an `object` published without an authored
`sharingModel` (`security-owd-unset`). Warning/info-tier findings (the three
cross-collection rules' common verdicts) surface as non-blocking advisories on
the save response.

Measured zero breakage before shipping: the full `@objectstack/metadata-protocol`
suite and a replay of every shipped-corpus object/permission/book/seed
(showcase + CRM + todo + blank template — 88 writes) produce zero refusals,
because #8308 taught `METADATA_CREATE_SEEDS.object` to author its OWD and
#8309 gave the per-write snapshot the sibling collections the cross-collection
rules judge against.

`security-role-word` deliberately does NOT cross: it judges six collections
including `positions`/`apps`, which the per-write snapshot does not carry — so
it is split into its own CLI-only registry entry (`validateSecurityRoleWord`,
same rule id, same findings on every CLI command) rather than enforced for
three of its six collections (#7220: one rule id sits on one side of the wall).
`validateSecurityRoleWord` is also a new named export of `@objectstack/lint`.
