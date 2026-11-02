---
'@objectstack/spec': minor
---

spec(data): the name-only reference value a refused reader is served has a named schema, and `referenceNameVisible` says which name it carries

Clause-②: yes (widening)
Metadata-protocol: added

A `lookup` or `user` field that declares `referenceNameVisible: true` answers `$expand` with `{ id, name, readRefused: true }` for a target the reader may not read. Until now that value had no name in the spec, and the field's description named the wrong source for `name` and only some of the cases where the name is withheld.

- **New export.** `ReferenceNameOnlyValueSchema` / `ReferenceNameOnlyValue` from `@objectstack/spec/data`: a closed object of the record id the referencing row holds, a non-empty `name`, and `readRefused: true`. It is a read form only. The stored form of a reference stays the bare id, so a record write never accepts it.
- **Expanded lookup value.** `valueSchemaFor(def, 'expanded')` for the reference types lists the new schema beside the bare id and the open record object. The open record member already accepted this value, so no value parses differently than before; the new export and its authorable-surface rows are what the declaration records.
- **Which name.** The `referenceNameVisible` description now says the name is the referenced object's display name as `resolveRecordDisplayName` resolves it: its `nameField`, else its `displayNameField`, else the derived title field. Before, it named `nameField` alone.
- **When the name is withheld.** The description now lists every case where the `Record #` floor with the id is served instead of the name: the reader's field-level security keeps the name field from it; the field declares a `maskingRule`; it is a formula reading through another reference; an explicit `nameField` (or its `displayNameField` alias) points at a column that is neither title-typed nor autonumber; or no field-level answer can be had for the reader. A target with no resolvable or no non-empty name reads as the same floor.

**For consumers.** Code that types a lookup's expanded value can import `ReferenceNameOnlyValue` and check `readRefused === true` to tell a refused target from an expanded record. Show the name as text and link nothing.
