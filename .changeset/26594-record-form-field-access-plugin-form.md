---
'@object-ui/plugin-form': patch
---

fix(plugin-form): the record form's edit dialog disables only the fields the server locks on that record

Clause-②: no
Metadata-protocol: none

An edit form for a stored record (`ModalForm`, the console's edit dialog; `ObjectForm` and every layout beneath it; `DrawerForm`) now asks the data source for that record's field projection and answers its field locks from it, through `RecordFieldAccessScope`. A field locked only from `approved` onward is live on a draft and locked on an approved row, in what the form draws and in what its save sends. Create forms, `view` forms and data sources without `getRecordFieldAccess` behave as before. Row-level write scope is not part of the answer: on a row the caller may read but not write, the fields stay open and the server refuses the save, as before.
