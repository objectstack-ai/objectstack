---
'@objectstack/plugin-sharing': patch
---

Recompute `unit_and_subordinates` / `business_unit` sharing-rule grants when the business-unit graph changes.

**Security:** read access granted through a business-unit sharing rule is now withdrawn immediately when the business unit is moved out of the shared subtree, deactivated or deleted, or when the membership row is removed — previously it survived until the shared record happened to be written next, which put no bound at all on how long a revoked recipient kept reading the record.

The sharing-rule recompute hooks were registered only on each rule's own object, and nothing was registered on `sys_business_unit` or `sys_business_unit_member`. A rule whose recipient resolves through the business-unit tree therefore never re-materialised its `sys_record_share` grants when the tree or a membership moved. Writes to both tables now drive a recompute: the withdrawal is synchronous and complete before the write returns (scoped by recipient, so it needs no scan of the records the rule matches), and the grant direction — a unit moved *into* a shared subtree — is queued on the existing re-grant queue.

Only recipient kinds that actually read the business-unit graph are recomputed (`business_unit`, `unit_and_subordinates`); `user`, `team`, `position` and `queue` rules are untouched by a business-unit write.
