---
'@objectstack/objectql': patch
'@objectstack/plugin-audit': patch
---

fix(audit): a search the server widens never names a column the caller may not query (#34700)

Clause-②: no
Metadata-protocol: none
Skills-docs: none — no skill or docs page teaches this search set.

- The server-chosen search set of an object now leaves out every column the object's own query guard would refuse this caller, as it already leaves out a field the caller may not query (#25672). A column the caller names in `searchFields` is not left out: the guard judges it as before.
- `ObjectQL#registerSearchFieldWithholder(object, withholder)`: the seam an object's own guard uses to name those columns. plugin-audit registers one for `sys_audit_log` and `sys_activity`, answered by the guard's own rule.
