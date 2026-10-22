---
'@objectstack/spec': patch
'@objectstack/skills': patch
---

docs(spec, skills): the `titleFormat` description and the objectstack-data skill no longer steer a composite record title that must be queried into a formula field

Clause-②: no
Metadata-protocol: none

The `titleFormat` description (and its generated copies on the object, metadata and migration reference pages) and the `objectstack-data` skill's `nameField` and `titleFormat` rows told an author to migrate a composite record title to a `formula` field with `returnType: 'text'` designated as `nameField`. A formula value is computed on read and stored nowhere, so a sort by it is refused, search never reaches it, and an import cannot match a lookup cell against it. Both now say what the record-title lint and ADR-0079 D3 already say: a composite title that import, sort or search must match is a stored computed field, a non-`formula` field that declares an `expression`, which the engine computes and stores on every write, designated as `nameField`; a text formula designated as `nameField` stays legal for a title shown for display only.

The same skill's "Computed column" bullet (`rules/relationships.md`) said a stored field's `expression` is a client compute hint and the sent value is stored verbatim. The engine computes the expression from the row the write stores and stores the result, so a client-sent value never stands; the bullet now says so.

No key, type, default or accepted value changes; only the text an author reads changes.
