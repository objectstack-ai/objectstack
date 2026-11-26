---
'@objectstack/example-starter': patch
---

feat(examples): a starter app — companies and their contacts, with the platform's tasks and notes in the menu

Clause-②: no
Metadata-protocol: none

New private example package `@objectstack/example-starter` (`examples/app-starter`), written from metadata alone:

- Two objects, `starter_company` and `starter_contact` (a contact belongs to at most one company). The `starter_` namespace keeps both clear of a CRM package's own account and contact objects, so a tenant can install both.
- A grid and a board for each object; the company's record page lists its contacts; the create and edit form is each object's field groups.
- A menu of four object entries — companies, contacts, and the platform's `sys_task` and `sys_note` — plus an overview dashboard. Tasks and notes are not package objects, so uninstalling the package leaves every task and note in place.
- Five sample companies, six sample contacts, English and Simplified Chinese labels.
