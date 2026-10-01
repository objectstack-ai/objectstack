---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the compliance-ledger rows the admin identity endpoints write record the admin's decisions, never a value of a field of the user (#21174)

Clause-②: no

The admin create-user and set-user-password endpoints each write their own `sys_audit_log` row beside the rows plugin-audit's CRUD mirror writes for the same call. That row's free `metadata` copied values the call had just written into fields of the user. The ledger's read side narrows the mirror's before/after snapshots to what each reader is served, but it cannot narrow free metadata without deriving masking a second time, so a ledger reader the data plane withholds one of those fields from was served its value through the explicit row.

The explicit row now carries only the admin's decisions — which operation ran, whether the password was generated, whether the account's address is a generated placeholder, whether the membership was bound and to which organization — plus its reference to the user (`object_name` and `record_id`). The values the call writes into the user's fields are recorded where they already were: on the mirror's `create` and `update` rows for those same writes, in the snapshot columns the read side narrows per reader. The decision set is a closed type, so a field value no longer compiles into the row.

Migration: a reader that took a user field's value from the explicit row's metadata reads it from the mirror's row for the same write instead (its after-snapshot), served according to the reader's field access. Rows written before this release are stored data and are not rewritten.
