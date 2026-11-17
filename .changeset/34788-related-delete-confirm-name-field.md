---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a related list's row Delete confirm names the row by its declared `nameField` when no column shows it

Clause-②: no
Metadata-protocol: none

A related list with authored columns sends a `$select` projection, and the row Delete confirm names the row from the row that projection fetched. The projection did not ask for the child object's declared `nameField` unless a column showed it, so the confirm read `Are you sure you want to delete "Record #<id>"?` for a row that has a name. The projection now asks for the declared `nameField` (or its deprecated `displayNameField` alias) through the same gates as its other members: the field must be declared by the child object or be a platform column, the viewer must be allowed to read it, and the block must not redact it. It is fetched only, never drawn as a column. A list without authored columns sends no projection, as before. A name field the viewer cannot read is still not requested, and its confirm keeps the `Record #<id>` wording.
