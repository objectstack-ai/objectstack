---
"@objectstack/lint": minor
---

feat(lint): `validateSecurityPosture` now gates `permission` / `book` writes at the runtime publish door; `security-role-word` splits into its own CLI-only rule (#8310)

The measured half of the #7891 strictness rollout (#4001 pattern): the
`validateSecurityPosture` registry entry declares `runtimeTypes: ['seed',
'permission', 'book']`, so the security-posture rule families run at the
runtime metadata publish gate (Studio, REST `/meta`, MCP/AI authors) for
permission-set and book writes. A class of runtime writes that used to succeed
can now be refused with a 422 — e.g. a permission set granting a `'*'`
wildcard with View/Modify All Data (`security-wildcard-vama`) or a
high-privilege default set (`security-anchor-high-privilege`). Warning/info
findings (the three cross-collection rules' common verdicts) surface as
non-blocking advisories on the save response.

Measured zero breakage for the shipped set: the full
`@objectstack/metadata-protocol`, `@objectstack/objectql` and
`@objectstack/rest` suites plus a replay of every shipped-corpus
permission/book/seed write (showcase + CRM + todo + blank) produce zero
refusals.

`object` is deliberately NOT declared: re-measured on the #8308-repaired tree
it still refuses 95 platform-suite writes in `@objectstack/objectql` and
`@objectstack/rest` (all `security-owd-unset` / `security-external-wider`),
including contract pins of the ADR-0094 403 `owd_external_wider` door that
this 422 gate would preempt — escalated on #8310 rather than forced green.

`security-role-word` does not cross either: it judges six collections
including `positions`/`apps`, which the per-write snapshot does not carry — so
it is split into its own CLI-only registry entry (`validateSecurityRoleWord`,
same rule id, same findings on every CLI command) rather than enforced for a
subset of its collections (#7220: one rule id sits on one side of the wall).
`validateSecurityRoleWord` is a new named export of `@objectstack/lint`;
`validateSecurityPosture` no longer emits `security-role-word` findings —
callers consuming both should run both (the registry does).
