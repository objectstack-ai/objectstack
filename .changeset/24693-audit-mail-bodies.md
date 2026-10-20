---
'@objectstack/plugin-audit': minor
'@objectstack/cli': minor
---

feat(cli,plugin-audit): `os migrate audit-mail-bodies` masks the mail bodies that audit and activity copies written before the mail-body mask still hold in clear

**Run `os migrate audit-mail-bodies --apply` once after upgrading.** Since the mail-body read gate, the audit writer masks `body_text` and `body_html` whenever it copies a `sys_email` or `sys_identity_email` row into `sys_audit_log` (`new_value`, `old_value`) or `sys_activity` (both halves of `metadata`). Copies written before that still hold the body in clear at rest: password-reset, verification, magic-link and invitation links included. Today they are served only to a reader who is also served the body field, so this is no open door; it is a credential copy at rest, and it is what any later relaxation of the mail-body gate would re-open.

Clause-②: yes

- **The command.** `os migrate audit-mail-bodies` masks those copies with the writer's own mask: a set body becomes `••••••••`, an empty one stays empty, and a copy that never carried the column gains none. It is a dry run by default (counts, writes no row), `--apply` writes, and its flags are `os migrate audit-metadata-bodies`'s, one for one (`--database-url`, `--apply`, `--yes`, `--force`, `--json`). The report is counts only, per table, and never prints a value.
- **What changes in a row.** Only the body keys of the copy. Every other key of the copy and every other column of the row stay byte-identical, the row's `updated_at` included (the rewrite writes under `preserveAudit` with the stored stamp).
- **Idempotent.** A masked body is the mask, so a second run masks nothing; re-running finishes an interrupted run. A failed read or write exits `1`.
- **No selector, no ordering.** Every copy of both mail logs is masked, as the writer masks new ones, so the command needs no rule telling identity mail apart from tenant mail. It gives the same result before or after `os migrate organization-ownership`: that ceremony re-points moved mail's activity copies to `sys_identity_email`, which is masked the same, and leaves `sys_audit_log` as written.
- **Who sees a difference.** A platform administrator (the one reader the body field is served to) no longer reads a pre-upgrade mail body in the audit trail or the activity feed. The mail log row itself keeps its body, behind its field gate.

`@objectstack/plugin-audit` exports the rewrite, `migrateMailLogBodyCopies` (with `MAIL_LOG_BODY_COPY_OBJECTS`, `MAIL_LOG_BODY_MIGRATION_PAGE_SIZE` and its engine and report types), its two pure planners `planMailLogBodyAuditRowPatch` and `planMailLogBodyActivityRowPatch`, and `maskMailLogBodyCopy`, the one mask the audit writer and the rewrite both apply.
