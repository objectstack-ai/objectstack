---
'@object-ui/plugin-form': patch
---

fix(plugin-form): an edit `DrawerForm`, `TabbedForm` or `WizardForm` whose record does not exist shows the record not-found state instead of an empty editable form

Clause-②: no
Metadata-protocol: none

`DataSource.findOne` answers `null` for a record that does not exist (the ObjectStack adapter maps the server's 404 to it). The drawer, tabbed and wizard form layouts seeded their form with `{}` from that answer, so editing a deleted or unknown record opened a blank form with an enabled Update button, and the 404 surfaced only after submit. They now draw the record not-found state ("Record not found", the same copy the record page and the `ModalForm` overlay show) with no fields and no submit, both on the first read and when a background re-read finds the record deleted. All four record form layouts draw that state from one shared private component. Create, and an edit of a record that exists, are unchanged.
