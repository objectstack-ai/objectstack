---
'@objectstack/spec': minor
---

feat(spec): one override declaration for code and Studio — `overrides: { package, basedOn }`, the `.custom` pairing helpers, the closed overridable-type list, the `__c` reservation and the base-field display whitelist (ADR-0146)

Clause-②: yes (widening)
Metadata-protocol: added

A customer's change to an installed package lives in its paired `<base>.custom` package (ADR-0146). This release declares the shared definitions every later door reads, so a developer's `hotcrm.custom` in a repository and an administrator's Studio customization write the same thing:

- **The override declaration.** `view`, `dashboard`, `report`, `translation`, `email_template`, `page`, `app`, `dataset`, `doc`, `book`, `mapping`, `flow` and `action` items accept an optional `overrides: { package, basedOn }`: this item replaces the base package's same-named item whole. `package` names the base (never a `.custom` id); `basedOn` is recorded and never judged. The key survives `defineStack()`, the metadata save and the package export. No door acts on it yet: the write gate and the effective read are separate changes.
- **The pair's identity** (`@objectstack/spec/kernel`): `CUSTOMIZATION_PACKAGE_SUFFIX` (`.custom`), `customizationPackageId`, `customizationBasePackageId`, `isCustomizationPackage`, `isCustomizationPairOf`, `customizationNamespace` (`<base_ns>_custom`; a base namespace longer than 13 characters gets none, with the named reason `base_namespace_too_long`, never a truncation) and `customizationDependencyRange` (`^<major>` of the base version). Each derivation answers `{ ok: true, value }` or `{ ok: false, reason }`.
- **The overridable-type list.** `OVERRIDE_TYPE_CLASSIFICATION` classifies every metadata type as `overridable`, `extend_only` (`object`) or `excluded` (`permission`, `position`, `capability`, the code-only types and others), with `flow`'s and `action`'s preconditions carried as data. `OVERRIDABLE_METADATA_TYPES` and `isOverridableMetadataType` read it. `seed`, `datasource`, `tool` and `skill` are `excluded` pending a ruling.
- **Customer extension fields** (`@objectstack/spec/data`): `EXTENSION_FIELD_SUFFIX` (`__c`), `isExtensionFieldName`, and `BASE_FIELD_DISPLAY_WHITELIST`: the base-field properties an extension may change (`label`, `description`, `inlineHelpText`, `placeholder`, and an option's `label`). Enforcing both is a separate change.
