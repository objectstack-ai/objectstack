---
'@object-ui/plugin-form': patch
---

fix(plugin-form): an edit `ObjectForm` in its default layout whose record does not exist shows the record not-found state instead of an empty editable form

Clause-②: no
Metadata-protocol: none

`DataSource.findOne` answers `null` for a record that does not exist (the ObjectStack adapter maps the server's 404 to it). The default `object-form` layout seeded its form from that answer, so editing a deleted or unknown record opened a blank form with an enabled Update button, and the 404 surfaced only after submit. It now draws the record not-found state ("Record not found", the same copy the record page and the modal, drawer, tabbed and wizard forms show) with no fields and no submit, both on the first read and when a background re-read finds the record deleted. Create, and an edit of a record that exists, are unchanged.
