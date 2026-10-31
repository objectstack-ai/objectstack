---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): a record save whose answer carries warnings shows one toast, the record-named save message carrying the warning lines

Clause-②: no
Metadata-protocol: none

A save from the record form (the overlay dialog, its child-form task, or the full-page form) that passed a `severity: 'warning'` validation rule showed two toasts: the write-warning channel's "Saved — with warnings" with the rule messages, then the form's own `OBJECT "TITLE" updated`. It now shows one: the record-named save message, on the warning variant, with each distinct rule message on its own line. While a record form is open, the write-warning channel hands the answer warnings of the write that form makes (that record's update, or a create of that object) to the form instead of toasting them; the stripped-fields notice keeps its own toast, and any other write keeps the "Saved — with warnings" toast.
