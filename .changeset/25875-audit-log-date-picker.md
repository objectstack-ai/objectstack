---
'@object-ui/console': patch
---

fix(console): the audit log's From and To filters use the platform date picker the record forms use

Clause-②: no
Metadata-protocol: none

Setup → Audit Log drew the browser's native date input for its From and To filters, with the operating system's `mm/dd/yyyy` face and picker whatever the console's language. Both filters now draw the same date picker as a record form's `date` field: a text box in the display locale's format, a calendar popover, a clear button and today / tomorrow shortcuts. A typed day commits on blur or Enter. The filters send the same `created_at` bounds as before (`YYYY-MM-DD`, the To day through 23:59:59), and each filter label still names its text box.
