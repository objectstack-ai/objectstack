---
'@objectstack/plugin-audit': patch
---

An activity row names its record by the record's title as every renderer resolves it, not by a guess from a fixed list of field names

Clause-②: no

The record-change mirror writes a label for the record into each `sys_activity` row (`record_label`, and inside the created, deleted and generic updated summary). It used to pick that label from a fixed list of field names (`name`, `subject`, `title`, `full_name`, `label`, `first_name`, `company`, `email`) and fall back to the record id. An object titled by any other field showed its record id on every activity row: an object titled by `company_name` read `Created Customer "RECORD_ID"`, with the raw record id, while its record page showed the company name.

The label is now the value of the object's title field as ADR-0079 resolves it (`nameField`, then the deprecated `displayNameField`, then the same derivation the record page, the picker and the approvals inbox use). The record id stays the floor: when nothing resolves, when the title field is the primary key, a credential or a field declared `internal`, or when the record's title value is empty. An empty title no longer borrows another populated field.

- Objects titled by `name`, `title` or `subject` are labelled as before.
- An object whose `nameField` names another field is now labelled by that field. An object whose only list match was not its resolved title is labelled by its title now; in the bundled examples that moves the CRM contact from `full_name` (a formula that declares no `returnType: 'text'`, so it is not derived as the title) to `first_name`, its registered title.
- The activity row records the resolved field as the label's source, so the read-side redaction keeps serving the label only to a reader served that field.

Rows written before this change keep the label they were written with; nothing is backfilled.
