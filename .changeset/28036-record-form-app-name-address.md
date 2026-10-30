---
'@object-ui/app-shell': patch
---

fix(console): a full-page record form opened on the app's name address stays in the app after Save

Clause-②: no
Metadata-protocol: none

A record's full-page form (`/apps/APP/OBJECT/record/ID/edit` or `/apps/APP/OBJECT/new`) opened by a pasted link, a bookmark or a new tab on the app's **name** (rather than its package id) saved, then went Back out of the console: the page the tab showed before came back and the save toast was lost. The console moves a name address to the package-id one on load, and that move made the page believe a console page was behind it. Save and Cancel now go Back only when the console itself navigated to the form; otherwise an edit lands on the record and a new record on the object's list, inside the app, with one toast. A form opened from a list, a view or a record page still returns to that page.
