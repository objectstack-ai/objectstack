---
'@object-ui/components': patch
'@object-ui/types': patch
---

fix(components): an editable list's lookup column is wide enough for its record picker

Clause-②: no
Metadata-protocol: none

With inline editing on, a lookup column in a list was sized from the short names its cells draw, often 80 to 121px. Its cell editor is the record picker, so the picker's trigger got a few dozen pixels and the option list it opened cut every name ("C..", "W."). In an editable table, a foreign-key column (a lookup, master-detail, tree or user field) whose cells edit is now never narrower than 168px, the width the inline line-item grid already gives its lookup columns. A wider name still widens the column as before. A width the view pins, or the user's own resize, is drawn exactly as written, and read-only tables and columns that do not edit are unchanged.
