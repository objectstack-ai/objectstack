---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": minor
"@objectstack/runtime": minor
"@objectstack/platform-objects": minor
---

feat(metadata-protocol,objectql): an object extension is an item of a writable package — saved, published and exported through the existing doors

Clause-②: yes (widening)
Metadata-protocol: added

A package can now add fields and rules to an object another package defines by saving an `object_extension` item through `/api/v1/meta`, the same way it saves any other item. This is what Studio's add-field on a base object writes (ADR-0146 D10): an extension in the base's paired `<base>.custom` package, its fields suffixed `__c`, the base untouched.

- **The type** (`@objectstack/spec/kernel`). `object_extension` joins `MetadataTypeSchema` and the metadata type registry. Its body is `ObjectExtensionSchema` as it stands: it carries `extend` and no `name`. The row is filed under the target object's name, one extension per package per target. `OVERRIDE_TYPE_CLASSIFICATION` lists it as `excluded`: an extension adds to its target, it never replaces a base item, so it never carries `overrides`. That disposition does not close the type to a `.custom` pair.
- **The doors.** Draft, publish, history restore and delete are the doors every item uses. The save, publish and restore doors refuse, with `VALIDATION_ERROR` / 400 and an issue path: a write bound to no package; `defaultRowScope` or `membershipKeys` in the body (the registry's own sentences); a row filed under a name other than its `extend`; an unregistered target; a target outside the package's dependency closure (with the closure prescription the other save doors print); and a `.custom` field without the `__c` suffix (the existing `__c` judge). A body the schema refuses answers 422 `INVALID_METADATA` with the schema's issues. No error code is added.
- **The registry** (`@objectstack/objectql`). A published row registers its whole parsed body as the package's `'extend'` contributor (`SchemaRegistry.registerObjectExtension`), so its fields, validations and indexes appear on every read of the object, and a publish adds the column to the target's table. Every stored-row sync re-registers it (boot, write-through, read hydration), and deleting the row or uninstalling the package withdraws it (`SchemaRegistry.withdrawObjectExtension`). What a manifest's `objectExtensions` register is unchanged.
- **The export** (`@objectstack/runtime`). `GET /packages/:id/export` carries each of the package's extension items as an `objectExtensions` entry that re-installs. A package's `objects` are now only the objects it owns: an object the package extends is no longer exported as an `'own'` object, which re-install refused with `ObjectOwnershipConflictError`.
- **`@objectstack/platform-objects`**: the metadata-forms translation bundles gain the type's `label` and `description` (regenerated; the non-English locales carry the English text until translated).
- **`@objectstack/lint/runtime`** exports `closureDependencyRemedy`, the closure prescription the save doors print.

Two costs, both on purpose: `/meta/types` serves no JSON schema for `object_extension`, and a draft carries no `_diagnostics` badge, because the type is not bound in `BUILTIN_METADATA_TYPE_SCHEMAS` (that map requires the ADR-0010 envelope, which would change the schema a manifest's `objectExtensions` parse with).
