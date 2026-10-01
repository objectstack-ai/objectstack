---
'@objectstack/spec': minor
'@objectstack/cli': minor
---

feat(spec,cli): shared seam for projecting stored metadata bodies, and the audit rewrite command

Clause-②: no

`@objectstack/spec/kernel` gains the family-wide primitives for the
stored-metadata-body security invariant, beside the per-type redactor registry
they build on: `STORED_METADATA_BODY_OBJECTS` / `isStoredMetadataBodyObject`,
the `STORED_METADATA_BODY_COLUMN` / `STORED_METADATA_TYPE_COLUMN` names, and
`redactStoredMetadataBody` / `redactStoredMetadataRow` / `redactStoredMetadataRows`.
These project a stored row's body through the one `getMetadataTypeRedactor`
definition, so every surface that serves, copies or evaluates such a body shares
one rule rather than a copy per package. Additive — no existing export changes.

`@objectstack/cli` gains `os migrate audit-metadata-bodies`, the one-off rewrite
of at-rest metadata-body copies in `sys_audit_log` / `sys_activity` (dry run by
default, `--apply` to write, idempotent).
