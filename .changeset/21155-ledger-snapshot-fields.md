---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): the compliance ledger's before/after snapshots serve a parent field's value only to a reader the security service serves that field (#21155)

Clause-②: no

The CRUD mirror writes one `sys_audit_log` row per record write, once, as the system. A create row's after-snapshot, an update row's before/after snapshots of each changed field, and a delete row's before-snapshot carry the parent record's stored field values. The ledger is read through the generic data doors under its own object grant and tenant wall, so a reader whose permission sets grant the ledger read was served every snapshot key. This held for a field served masked to the reader, a field gated by `requiredPermissions` the reader does not hold, and a field a permission set the reader holds marks non-readable. The data plane answered the same reader masked or without the key.

Ledger readers are not field-unrestricted by default. The snapshots of create, update and delete rows are now narrowed at read time, keyed on the reading caller, through the security service's own answer: the read projection intersected with the query-side answer, whose difference the contract defines as exactly the fields served masked. Every key the reader is not served is dropped. A reader served every field reads the snapshots byte-identical to the row at rest, and system reads are unchanged. An auditor who must see every field is granted that by a permission set that unmasks those fields.

Rows of other actions are served as written: their snapshot columns are empty, a settings digest, or the administrator roster, and none of them is a parent record's field map. A create, update or delete row whose snapshot cannot be judged key by key (not a JSON object, or no parent object named) loses that snapshot. The activity stream's redaction and this one now share one served-fields helper.
