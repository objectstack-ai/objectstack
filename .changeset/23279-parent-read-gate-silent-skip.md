---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): the `sys_activity` and `sys_audit_log` read gates skip a parent object the caller cannot read without reading it, so the security plugin no longer logs a denial for each skipped object

Clause-②: no

Both gates serve a row only when the caller can read the record it is about. They decide that once per parent object the query's rows name, by reading that object as the caller. For every object the caller holds no object-level read on, plugin-security refused that read and logged `[Security] Access denied` at WARN: one line per object per read, and again for the list's `total`. The console header's activity feed reads `sys_activity` on every page view, so every non-admin page view logged a line for each platform object the stream names (`sys_migration`, `sys_platform_setting`, `sys_user_permission_set`, and others), and real denials were buried among them.

Each gate now asks the security service's `canReadObject` first, with the caller's own context. That is the security middleware's own object-level read check, and it answers without logging. The gate then reads only the objects it admits. An object it refuses contributes no rows, exactly as its refused read did before, so every caller is served the same rows, with the same `total`, as before. A caller's own read of such an object is still refused and still logged, once.

The check can only exclude objects. An admitted object is still read as the caller, and that read still decides row scope, sharing and RLS. If `canReadObject` throws, or answers anything other than `true`, that object's rows are excluded and the gate logs a warning naming the object. On a deployment without the security plugin, or with a security service that does not offer `canReadObject`, every parent object is read as the caller, as before.
