---
'@objectstack/objectql': minor
'@objectstack/runtime': minor
---

fix(objectql)!: a disabled package's `objectExtensions` fields are withheld from the object they extend, and come back with their values on enable

Clause-②: yes (narrowing) — while a package is disabled, the served object it extends (`GET /api/v1/meta/object/:name`, the record page, the `/data` field map) no longer carries the fields, validation rules and indexes the package's `objectExtensions` add, so a `/data` write, filter, sort or `fields` projection naming one of those fields is refused as a field the object does not have (`400 INVALID_FIELD` / `INVALID_SORT`), and `GET /api/v1/packages/:id/customizations` no longer lists them among the base's `contributions`.
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and nothing stored changes: the extension, its columns and its values stay as they are, and enabling the package serves them again. -->

**BREAKING** served-object narrowing under package disable (`@objectstack/objectql`, `@objectstack/runtime`).

- **Before.** Disabling a package withheld its objects (`404 OBJECT_PACKAGE_DISABLED`), flows, navigation items, permissions and actions, but the fields its `objectExtensions` add to another package's object stayed on that object: in `/meta/object`, in every `/data` read and on the record page.
- **Now.** The served fold of an object leaves out every `extend` contribution of a disabled package: its fields, its validation rules, its indexes and its field patches. A base layer that already carries them (a tenant overlay saved from a served read, a metadata-service copy of a resolved object) has those fields and rules taken off too. A field the owner itself declares, or another enabled extension also adds, stays. A write naming a withheld field answers exactly what a write naming an unknown field answers; a write through the object's other fields lands and leaves the withheld values alone.
- **Kept.** Schema sync, the federated binding and the lifecycle sweep read the object with every extension folded in (`SchemaRegistry.getStorageObject` / `getAllStorageObjects`), so a disable never drops or skips a column, and a boot that starts with the package disabled still creates them. Enabling the package serves the fields again with the stored values.
- **Who moves.** A client that reads a disabled module's extension fields gets the object without them. A formula on the object that reads a withheld field answers `null`. A validation rule of another, enabled package that reads a withheld field cannot be evaluated, so writes to the object are refused (`400 VALIDATION_FAILED`, naming the rule) until the field's package is enabled again or the rule's package declares and keeps that package.
