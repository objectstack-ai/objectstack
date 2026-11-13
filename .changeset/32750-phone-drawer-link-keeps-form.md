---
'@object-ui/app-shell': patch
---

fix(app-shell): on a phone, a record-drawer link that carries a related-record form opens that form over the record page

Clause-②: no
Metadata-protocol: none

A phone draws no record drawer: it answers a `?recordId=` link with the record's page in the list's place. A link that also named a record form (`?form=new&formObject=…&formLink=…`, as a desktop writes it when a related record is created from the drawer) lost those parameters on the way, so the form closed a moment after it opened and the reader was left on the record page. The record page now carries the form's parameters, and the seeded create values of the history entry, so the form stays open over it; the list kept as the page's way back no longer names the form. A link with no form is answered exactly as before.
