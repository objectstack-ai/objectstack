---
'@objectstack/platform-objects': patch
'@objectstack/plugin-audit': patch
---

fix(platform-objects, plugin-audit)!: a member who holds `view_all_audit_log` and not `manage_platform_settings` (a separation-of-duties auditor) now finds the Audit Log entry in Setup › Diagnostics (#33224)

Clause-②: yes (narrowing) — `GET /meta/app/setup` now serves `group_diagnostics` with the Audit Log entry (`nav_audit_logs`) to a member who holds `view_all_audit_log` without `manage_platform_settings`; before, the whole group was withheld from them. Every shipped permission set is served what it was before: `admin_full_access` holds both capabilities and still sees Sessions, Notification Events and Audit Log; `organization_admin` and the member sets hold neither and still see no Diagnostics group. One custom-set audience narrows: a set granting `manage_platform_settings` without `view_all_audit_log` is no longer served the Audit Log entry. A gate is all-of, so the entry cannot be gated on either capability.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema, accepted value or metadata type is added, removed, renamed or re-shaped. What moves is which entries of the platform's own Setup app the served app read lists for a caller, so nothing is stored for a migration to rewrite and nothing needs a tombstone. -->

**BREAKING** for a custom permission set that grants `manage_platform_settings` without `view_all_audit_log`. Its holders were served the Setup › Diagnostics › Audit Log entry and no longer are. The Audit Log page itself is unchanged: it still opens by URL and still shows them the organization-attributed ledger rows it showed before. What to do: grant `view_all_audit_log` to that set if its holders should keep the menu entry, or open the page by URL. A third-party package that contributes an entry into `group_diagnostics` without its own `requiredPermissions` is now shown to every member who can open Setup, where before only `manage_platform_settings` holders saw it: declare `requiredPermissions` on the entry (see below).

**What moved.** The Setup app's `group_diagnostics` slot carried `requiredPermissions: ['manage_platform_settings']`, and a group's gate prunes its whole subtree before any child is judged, so the audit entry contributed into it could never reach an auditor. The slot now carries no gate, and each entry carries its own: Sessions (`nav_sessions`) and Notification Events (`nav_notifications`) keep `manage_platform_settings`, and Audit Log is gated on `view_all_audit_log`, the ledger's own read capability.

**If you contribute into `group_diagnostics`.** The slot no longer gates what you put in it. An entry that should stay admin-only declares `requiredPermissions` on the entry itself, as the platform's own entries now do.
