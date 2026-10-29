---
'@object-ui/app-shell': patch
---

fix(app-shell): the condition builder writes a null-safe comparison on a field

Clause-②: no
Metadata-protocol: none

In Studio's no-code condition builder, a row such as "`record.estimated_hours` greater than `40`" compiled to `record.estimated_hours > 40`. On a field that may be empty, CEL has no `>` for a missing value, so the server refused the rule at publish ("Guard it with '!= null'") and held back every other draft in the package, while the builder had said "Valid CEL".

A greater than, less than, at least or at most row on a field of the object now compiles behind a null test, `record.estimated_hours != null && record.estimated_hours > 40`: the shape the "Number can't be negative" preset already writes and the one the server's message prescribes. It is accepted at publish and evaluates to false on a record with no value. Equals and not equals are unchanged, as are rows on a context subject. A stored condition is never rewritten on open: a comparison saved without the guard reopens as the same row and keeps its text until the author edits that row.
