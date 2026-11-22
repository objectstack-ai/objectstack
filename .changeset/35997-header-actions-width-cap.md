---
'@object-ui/components': patch
---

fix(components): the record header re-measures its width fold on another record

Clause-②: no
Metadata-protocol: none

In a record page's header bar the action row folds by width: while its buttons wrap past one line, the page's own actions fold into the `⋯` one at a time. The lowered budget used to come back only when the bar changed width. Stepping to another record (previous / next, or another record in the drawer) keeps the same row, so after a record with many actions a record with fewer kept the old, lower budget and folded actions that fit.

The lowered budget now holds only for the record and the action set it was measured on. Another record, or a changed action set, draws the full budget (3, or the page's `maxVisible`) and the next layout measures again, so a row that still does not fit folds as before. Nothing an author writes changes.
