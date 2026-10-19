---
'@objectstack/plugin-audit': patch
'@objectstack/platform-objects': patch
---

Clause-②: no

Setup's Diagnostics group has one audit entry, "Audit Log", and it opens the audit browser

- **What changed.** `@objectstack/plugin-audit` contributed two Setup entries onto the same rows: "Audit Logs" (the `sys_audit_log` record list) and "Audit Log Browser" (the console's `audit:log` page). It now contributes one, "Audit Log", which opens the browser. The browser filters by action, object, actor and date, offers the record list's views (Writes, Auth, Record Views, …) as presets, and links to the record list ("Open as list"). Those two parts of the page ship in the console this release pins.
- **Ids.** The entry keeps the id `nav_audit_logs`, so a sidebar pin a user set on "Audit Logs" stays on the new entry. The id `nav_audit_log_browser` is no longer served; a pin set on it no longer shows, and the user can pin "Audit Log" instead.
- **Labels.** `@objectstack/platform-objects` serves the entry's label in the four shipped locales (Audit Log, 审计日志, 監査ログ, Registro de auditoría), and drops the "Audit Log Browser" label.
- **Unchanged.** The `sys_audit_log` object, its list views, its routes and its data API answer as before. The record list is no longer an entry in Setup's menu, so the ⌘K palette's record search in Setup no longer searches audit rows.
