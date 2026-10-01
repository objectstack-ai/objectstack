---
'@objectstack/spec': patch
---

fix(spec): the `filter-text-operator-declared-type-refused` migration entry's control no longer counts JSON-stored fields, and it names the separate door that refuses text operators there

Clause-②: no

**`filter-text-operator-declared-type-refused` (protocol 18).** The entry's acceptance criteria
named every text-valued field, `multiselect` / `checkboxes` / `tags` and lookup and `user` ids
included, as the control that "must keep answering exactly as before". The declared-type door this
entry registers still leaves every text-valued type alone. A second door, though, judges a field by
how it is STORED: on a column stored as JSON it now refuses `$startsWith`, `$endsWith`,
`$icontains`, `$like` and `$ilike` with `INVALID_FILTER` / `400`, as it already refused the scalar
comparisons there. So a stored filter that uses one of those operators on a multi-valued field
answers that `400` after the upgrade, and the old sentence called it a control.

The criteria now say four things:

- The control is a text-valued field that is NOT stored as a JSON column.
- The JSON-stored population is `multiselect` / `checkboxes` / `tags`, any field declared
  `multiple: true` (a multi-valued lookup or `user` among them), and, on a SQL deployment still
  inside the ADR-0104 dual-encoding window, a single-value file-class field.
- That door refuses every text operator except the membership pair `$contains` / `$notContains`,
  and its refusal names no declared type, so it is outside this entry's repair list.
- The repair on a multi-valued field is membership: `$contains` for one member, an `$or` of
  `$contains` for any-of. A single-value file-class field answers text operators again once the
  deployment finishes the media-column move (the column step of
  `objectstack migrate files-to-references --apply`).

Text only: no entry id, `surface`, `replacement`, `reason`, conversion or refusal changes, and
neither door moves. `objectstack migrate meta` prints the corrected `verify:` line, and the
generated migration registry carries the same text.
