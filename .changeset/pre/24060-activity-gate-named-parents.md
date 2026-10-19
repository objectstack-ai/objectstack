---
'@objectstack/plugin-audit': patch
---

Clause-②: no

fix(plugin-audit): a read of the activity stream, the compliance ledger or comments that names its parent objects writes one parent-record branch per named object, not one per registered object

- **What changed.** The parent-record read gate on `sys_activity`, `sys_audit_log` and `sys_comment` ANDs one branch per parent object into every read: a `ReadableIds` leaf, or the bounded probe for an on-behalf-of caller, a middleware-narrowed parent or a parent on another datasource. It wrote one for every registered object, whatever the read asked for. When the read's own `where` names the objects its rows are about (`object_name` as a plain value, `$eq` or `$in` of machine names, at the top level or inside a top-level `$and`), the gate now writes branches for those objects only, and the bounded probe pre-scans only the named objects of its classes, or does not run. The activity stream's withheld-update rule, which wrote one branch per enumerated object too, narrows the same way.
- **What it costs now.** Measured on SQLite with 148 registered objects: a newest-first 20-row activity read filtered to 3 objects went from a 711.8 KB statement with 2,629 bindings to 14.9 KB with 60, for the rows and again for the total, and its two probe pre-scans no longer run.
- **Unchanged:** the rows, the totals and the grouped counts every reader is served. A read of any other shape (no `object_name` filter, an `$or`, a `$not`, another operator, a value that is not a machine name) keeps every branch, as before. No export, option or stored shape changes.
- **One failure mode is gone:** a leaf or a probe for an object the read does not name is no longer composed or run, so a refusal composing it, or a failing pre-scan for it, no longer fails or denies that read.
