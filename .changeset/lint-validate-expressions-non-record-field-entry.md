---
"@objectstack/lint": patch
---

`validateStackExpressions` no longer throws on a non-record entry in an object's `fields:` list.

An empty item in a YAML `fields:` list deserialises to `null`, and `buildFieldIndex` cast each member of the list inline (`fields.map(f => (f as AnyRec).name)`) before the `.filter` two calls later could drop it. `Array.isArray` proves the LIST, never its MEMBERS, so linting such a stack failed with `TypeError: Cannot read properties of null (reading 'name')` out of the whole rule instead of reporting anything about the file.

The list is now read through `recordsOf` — the one place that coercion is decided — which drops a non-record member of the array shape whole and in **silence**: it carries no author-written name, so there is nothing to report about it. That matches what the two sibling field readers in the same module (`buildFieldTypeIndex`, `fieldEntries`) already did with the same member, so the three readers now agree. The readable siblings of the junk member are still indexed, so unknown-field findings on that object continue to be reported.

The map shape (`fields: { amount: { … } }`) is unchanged: there the author's key is the field name, which is what this index needs.
