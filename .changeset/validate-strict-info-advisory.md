---
'@objectstack/cli': patch
---

fix(cli): `os validate --strict` promotes warnings, never `info` findings

Clause-②: yes (widening) — `os validate --strict` now exits 0 on a stack whose only findings are `info`-severity rule-registry findings; nothing that passed before fails.
Metadata-protocol: none

`os validate --strict` fails the run (exit 1) on warnings and errors only. An `info`-severity finding from the rule registry is still printed — now under a blue `ℹ`, the glyph `os lint` gives the same finding as a `suggestion` — and still rides the `--json` payload's `warnings`, but it no longer fails the run under `--strict`, on either face, and an info-only run prints no `Strict mode: warnings treated as errors` line. This matches `os lint --strict`, which promotes warnings and leaves suggestions advisory.

The findings that stop failing `os validate --strict`, by their rule-id exports from `@objectstack/lint`:

- `SECURITY_PRIVATE_NO_READSCOPE` (`security-private-no-readscope`)
- `SECURITY_ROLLUP_SOURCE_ROW_SCOPED` (`security-rollup-source-row-scoped`)
- `ASSIGNMENT_RULE_QUEUE_UNSTAFFED` (`assignment-rule-queue-unstaffed`)
- `APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY` (`approval-approvers-may-resolve-empty`)
- `APPROVAL_EXPRESSION_NO_EMPTY_POLICY` (`approval-expression-no-empty-policy`)
- `APPROVAL_EXPRESSION_INVALID` (`approval-expression-invalid`) — its `info` arm only, a `resolveAs` on an approver whose type is not `expression`; its `error` arms still fail every run.

Every other advisory keeps gating `--strict` exactly as before: ADR-0087 conversion notices, `warning`-severity registry findings, doc findings, undeclared-key, capability-provider and structural advisories.

A CI step that runs `os validate --strict` and relied on an `info` finding to fail it should gate on the finding instead: read `--json`'s `warnings` for entries with `severity: 'info'` and the rule id it cares about.
