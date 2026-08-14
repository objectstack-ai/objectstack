---
"@objectstack/metadata-protocol": patch
"@objectstack/metadata-core": patch
---

fix(metadata-protocol): a package publish refused by the namespace-prefix rule now leaves an audit row per violation (#8595)

`publishPackageDrafts` refuses a whole batch pre-flight when an object draft's
name is missing its package namespace prefix (ADR-0028). That refusal returns
ABOVE the batch's `engine.transaction()`, so it reached neither the post-commit
`allowed` rows nor the rollback handler's `batch_aborted` row: it wrote nothing
to `sys_metadata_audit` at all. The compliance consequence is the defect — a
package rejected for a bad object name was **indistinguishable in the trail from
a package nobody ever pressed Publish on**, so a compliance query could not tell
a refused publish from one that never happened.

Each violation now leaves its own `publish` / `denied` row keyed on the
offending draft's `(type, name)` — the tuple `auditMetaItem` reads, so the
refusal is visible on that item's own audit-log tab via
`GET /api/v1/meta/:type/:name/audit`. The row carries the violated rule
(`namespace_prefix`) as its `code`, and the rule's actionable message as `note`.
Rows are keyed on the draft's own organization scope, matching the promoted
rows: an env-wide draft audits env-wide even when the publishing session carries
an active org.

One row per violation rather than one per batch: a pre-flight refusal names N
violating items and no single causal one, so a batch-level row would have had to
mint a synthetic identity — exactly what the `batch_aborted` row declines to do
for its own unattributable case.
