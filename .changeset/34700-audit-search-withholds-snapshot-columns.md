---
'@objectstack/objectql': patch
'@objectstack/plugin-audit': patch
---

fix(audit): a search the server widens never names a column the caller may not query (#34700)

Clause-②: no
Metadata-protocol: none
Skills-docs: none — no skill or docs page teaches this search set.

- The server-chosen search set of an object now leaves out every column the object's own query guard would refuse this caller, as it already leaves out a field the caller may not query (#25672). A column the caller names in `searchFields` is not left out: the guard judges it as before.
- `registerMiddleware(fn, { object, withholdSearchFields })`: a guard middleware names those columns in its own registration (`EngineMiddlewareOptions.withholdSearchFields`, asked for the reads the middleware runs on). plugin-audit's guards on `sys_audit_log` and `sys_activity` declare one, answered by the guard's own rule.
