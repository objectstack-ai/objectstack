---
'@objectstack/plugin-audit': patch
'@objectstack/spec': patch
---

fix(plugin-audit)!: the compliance ledger's deployment-level rows (no `tenant_id`) are served to the platform administrator alone, in every tenancy posture, `single` included (#26750)

Clause-②: no (narrowing) — under `single`, a non-system reader of `sys_audit_log` that is not the platform administrator (an organization administrator, the holder of a set that grants the ledger read, a holder of `view_all_audit_log`) is no longer served the ledger rows that carry no `tenant_id`; under a wall, the shipped sets' row scope already excluded them. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is added, removed or renamed: one runtime read rule on sys_audit_log changes which stored rows a reader who is not the platform administrator is served, and the view_all_audit_log description gains one sentence. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** read narrowing on `sys_audit_log` (`@objectstack/plugin-audit`), on every engine read of the ledger: the data API's list, by-id, count and aggregate, and the Setup views and record history built on them.

- **Before.** The ledger has no organization column (ADR-0131 D7); the organization a row is about is the attribution field `tenant_id`, and a row about a deployment-level action carries none: a GLOBAL settings change, a user-import run, a platform-admin standing change, a system write about an object with no organization column. Under a wall the shipped row policy `sys_audit_log_org` kept those rows from every organization reader. Under `single` no wall is enforced and that policy is stripped, so every reader whose sets grant the ledger read was served them, and a holder of `view_all_audit_log` was served them past the parent-record gate too.
- **Now.** In every posture, a ledger row with no `tenant_id` is served only to the platform administrator: the carried `PLATFORM_ADMIN` posture rung, which the unscoped `admin_full_access` grant derives. Every other non-system reader is served only the rows about an organization. Which organization's rows stays the row policy's answer, unchanged. The same holds under a wall for a set that authors its own ledger row policy or grants the superuser read bypass on the ledger: its holder is not the platform administrator.
- **Unchanged.** The rows stay stored. A system-context read and a context-less programmatic read still return every row. The platform administrator reads every row as before. The parent-record gate and the field-level redaction of the snapshots are unchanged. A walled deployment on the shipped sets serves every reader the same rows as before.
- **The capability text.** The `view_all_audit_log` description (`PLATFORM_CAPABILITIES`, `@objectstack/spec`) gains one sentence saying the same for `single`.

**Upgrade note for `single` operators who granted the ledger to someone who is not the platform administrator.** An auditor role (a set granting `sys_audit_log` read, with or without `view_all_audit_log`), an organization administrator, or a `viewer_readonly` holder no longer sees deployment configuration history: global settings changes, user-import runs and platform-admin standing changes. The organization's own record history and tenant-scope settings changes are still served. A person who must read deployment configuration history needs the platform administrator's grant (`admin_full_access`); no narrower grant serves those rows. A job that exports the full ledger reads it in system context and is unaffected.
