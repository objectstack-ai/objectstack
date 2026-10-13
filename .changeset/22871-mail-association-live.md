---
'@objectstack/spec': patch
---

The `mailAssociation` liveness row is `live`: the mailbox service's matcher reads the key, so authoring `mailAssociation: true` on an email field no longer draws the "no mailbox service reads this yet" author warning

Clause-②: no (dropping an author warning widens no accept set and no export: `FieldSchema` accepts `mailAssociation` exactly as before; only the warning the shipped liveness ledger carried is gone)

- `liveness/field.json`: the row moves from `planned` with `authorWarn` and `authorHint` to `live`, citing `MailRecordMatcher` in `@objectstack/service-mailbox` as its reader. The `field` state counts move from 94 live and 4 planned to 95 live and 3 planned.
