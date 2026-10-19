---
'@objectstack/spec': patch
---

fix(spec): the 18.0 upgrade-guide entries that name `os migrate organization-ownership` say first that 18.0 supports fresh installs only

Clause-②: no

In 18.0, `os migrate organization-ownership` refuses plan and apply alike on every database (exit 1, `NOT_IMPLEMENTED`, nothing read or written). Seven ADR-0087 semantic entries still told an operator to run `--out PLAN`, then `--apply --plan-file PLAN`, as if 18.0 upgraded a v17 database. Each now says, in the same words as the CLI and the boot refusal: 18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release until the 18.x release that carries the upgrade path. The plan and apply steps stay, marked as the 18.x release's ceremony.

- `sys-metadata-organization-column-retired`, `sys-metadata-audit-organization-column-retired`, `sys-metadata-commit-organization-column-retired`, `sys-metadata-history-organization-column-retired`, `ups-permission-set-id-column-retired`: the replacement and the acceptance criteria.
- `sharing-rule-declared-mirror-retired`: the replacement and the acceptance criteria.
- `cli-organization-ownership-apply-plan-file-required`: the replacement now says that 18.0 refuses this invocation, as it refuses every invocation of the command, and keeps the plan-file rule as the 18.x release's.

Only the text changes. Every entry keeps its `id`, its surface and its step.
