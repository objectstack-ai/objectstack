---
'@objectstack/plugin-audit': patch
---

The `Audit write FAILED` line names the table whose insert was refused and the row that is lost, gives a missing table the two causes the evidence cannot tell apart, and says it is printed once per audited object, refused table and error code

Clause-②: no

The record writer stores the `sys_audit_log` row that records who did it, then, when activities are enabled and the write has one, its `sys_activity` timeline row. When either insert was refused, the line always said the `sys_audit_log` row never landed. When the refused insert was `sys_activity`, every ledger row had in fact landed.

- The line now opens `Audit write FAILED on TABLE` and names the table the writer had in flight when it threw. A refused `sys_activity` insert says the ledger row landed and only the activity row is lost. A refused `sys_audit_log` insert says the ledger row is lost, and so is the activity row due after it when the object writes one.
- A missing table no longer gets only the telemetry-datasource split as its remedy. The table may never have been created because schema sync's DDL for it was refused at boot. The line cannot tell the two causes apart, so it names both, in order: look for `Schema sync FAILED for object 'TABLE'` in the boot log first, then the split and `OS_TELEMETRY_DB=0`. Any other cause keeps the driver-fault remedy.
- Whether the table is missing is asked about the refused table first. An error code that means "missing" without a phrase naming a relation is now attributed to that table, not to `sys_audit_log` by list order.
- The line is printed once per audited object, refused table and error code, and it now says so in place of "reported ONCE". The refused table joins the key, so the other table refusing with the same code on the same object gets its own line. The same missing table still prints one line per audited object that writes through it. Repeats stay at `debug`, which now also carries the `table`.

Log text and log metadata only: no status, error code, route, row or control flow changes. A log filter that matches the old text (`Audit write FAILED (`, `reported ONCE`) needs the new spelling.
