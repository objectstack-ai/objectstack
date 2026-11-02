---
'@object-ui/plugin-form': patch
---

fix(plugin-form): an edit `ModalForm` whose record does not exist shows the record not-found state instead of an empty editable form

Clause-②: no
Metadata-protocol: none

`DataSource.findOne` answers `null` for a record that does not exist (the ObjectStack adapter maps the server's 404 to it). The edit dialog seeded its form with `{}` from that answer, so the console's `?form=ID` overlay for a deleted or unknown record opened a blank form with an enabled Update button, and the 404 surfaced only after submit. The dialog now draws the console's record not-found state ("Record not found", the same copy the record page shows) with no fields and no footer, both on the first read and when a background re-read finds the record deleted. Create, and an edit of a record that exists, are unchanged.
