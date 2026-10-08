---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: `granted_by` on the grant tables is provenance: the platform stamps the writer, and a non-system caller can no longer name the granter

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing at the delegated-admin write gate over an existing column: `sys_user_permission_set.granted_by` and `sys_user_position.granted_by` gain `readonly: true` and keep their name, type, target and storage, so no authorable key, spelling, export or stored shape moves and there is nothing for `objectstack migrate meta` to rewrite. A caller that sent a granter has nothing to change in what it sends; the value it named is replaced by its own user id. Stored rows keep their bytes. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this column and this diff adds none (not registered or already-registered); and the change narrows what a runtime write door stores, not a runtime TypeScript interface or a type surface alone (not runtime-interface-only or type-surface-only). -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes.

`granted_by` records who wrote a grant. The platform already treated it that way: the delegated-admin gate stamped the writer, and the organization-admin reconcile writes the attributed human or null (ADR-0118 D1, an id or null and never a sentinel). But the column was a plain lookup, so a non-system caller could store any existing user as the granter, and the integrity audit filed a granter that no longer resolves as a broken business reference, which raised its `[integrity] stored references that resolve to nothing` warning on every run.

**What moves for consumers.**

- **Non-system inserts store the writer.** The delegated-admin gate now stamps the caller's user id into `granted_by` on every `sys_user_permission_set` and `sys_user_position` insert it admits, whatever the payload carried. A tenant-level admin's insert and a delegate's insert are stamped alike. Before, a supplied value was stored as sent, and a tenant-level admin's insert that supplied none stored `null`.
- **Non-system updates cannot change it.** Both columns are now `readonly: true`, so the engine's update strip drops a caller's `granted_by` and the row keeps its granter. Before, the update landed. A caller that passes `strictReadonlyWrites` is refused instead, as for every read-only column.
- **The integrity audit files it as provenance.** A `granted_by` that names a user who no longer exists is reported under the audit's `provenance` bucket, which does not raise the warning. A business reference that resolves to nothing is reported under `dangling` and warns, as before.

**Unchanged.**

- System-context writers keep the value they write: invitation placement stamps the issuer, the organization-admin reconcile stamps the attributed human or `null`, and the platform-admin promotion writes `null`. A server-side writer that must record someone other than its caller writes under a system context, as these do.
- Who may write a grant, and what a grant gives, are unchanged. The gate's authority decision runs first; a refused write is not stamped.
- Stored rows are not rewritten, and no stored row is refused on read. A row whose `granted_by` already names someone else, or holds a value that names no user, keeps it.
- `sys_record_share.granted_by` (plugin-sharing) is unchanged: its only writer is the sharing service, which already stamps the acting user under a system context.
