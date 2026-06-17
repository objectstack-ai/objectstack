---
---

chore(example): CRM "Reassign Lead" action now also surfaces on the record
header (`locations: ['list_item', 'record_header']`) and uses the
`record.status == "converted"` predicate convention so its CEL `disabled` greys
out consistently on both surfaces. Param collection, `dataSource.update`, and
the Undo toast now all drive from the header too. Example-only.
