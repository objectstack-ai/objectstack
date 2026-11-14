---
'@objectstack/platform-objects': patch
'@objectstack/plugin-audit': patch
---

fix(platform-objects, plugin-audit): a member who holds `view_all_audit_log` and not `manage_platform_settings` (a separation-of-duties auditor) now finds the Audit Log entry in Setup › Diagnostics (#33224)

Clause-②: yes (widening) — `GET /meta/app/setup` now serves `group_diagnostics` with the Audit Log entry (`nav_audit_logs`) to a member who holds `view_all_audit_log` without `manage_platform_settings`; before, the whole group was withheld from them. Every shipped permission set is served what it was before: `admin_full_access` holds both capabilities and still sees Sessions, Notification Events and Audit Log; `organization_admin` and the member sets hold neither and still see no Diagnostics group. One custom-set audience moves the other way: a set granting `manage_platform_settings` without `view_all_audit_log` is no longer served the Audit Log entry (the page itself is unchanged and still opens by URL).
Metadata-protocol: none

**What moved.** The Setup app's `group_diagnostics` slot carried `requiredPermissions: ['manage_platform_settings']`, and a group's gate prunes its whole subtree before any child is judged, so the audit entry contributed into it could never reach an auditor. The slot now carries no gate, and each entry carries its own: Sessions (`nav_sessions`) and Notification Events (`nav_notifications`) keep `manage_platform_settings`, and Audit Log is gated on `view_all_audit_log`, the ledger's own read capability.

**If you contribute into `group_diagnostics`.** The slot no longer gates what you put in it. An entry that should stay admin-only declares `requiredPermissions` on the entry itself, as the platform's own entries now do.
