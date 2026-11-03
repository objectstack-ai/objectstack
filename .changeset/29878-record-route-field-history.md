---
'@object-ui/app-shell': patch
---

fix(app-shell): a record page with no declared record page shows a tracked record's field-change history again, in a packaged app and in an app created in the console

Clause-②: no
Metadata-protocol: none

A record route whose object has no declared record page reads its objects by name through the app's scope, not the whole object registry. That scope never held `sys_audit_log`, so the record page's history gate (an object declaring `enable.trackHistory`, and the audit log among the objects the page holds) read false. The page asked its payload for no field changes and never read the audit rows. Its timeline showed only the activity summaries, while the record drawer, which still reads the registry, showed the field changes.

The route now also asks `sys_audit_log` by name, through the same scope, when the route's object declares `enable.trackHistory`, and waits for that answer before the record view first renders. If the read is refused, absent or failed, history stays off and the page still renders. The route reads no registry, and an object without `trackHistory` asks nothing more.
