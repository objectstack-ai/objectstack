---
'@objectstack/metadata-protocol': minor
'@objectstack/cli': minor
'@objectstack/cloud-connection': minor
---

**BREAKING** feat(metadata-protocol)!: `__c` extension fields only in a base's paired `.custom` package, refused at the save, restore and publish doors, `os validate`, the marketplace install and `duplicatePackage` (ADR-0146 D10, #28564)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no file under `skills/**` teaches a field spelled `__c`, an `objectExtensions` field name or a `<base>.custom` package; the measured count below found none.

<!-- adr-0087: not-required (no-migration-prescription) The narrowing refuses a field NAME spelling at the write doors: a field ending in `__c` outside a base's paired `.custom` package, and an `objectExtensions[].fields` key without the suffix inside one. No metadata key, accepted value of a key, export or error code is removed or renamed, and no stored shape changes. The remedy is a rename of a field, an authoring choice a person makes (which name a vendor or a customer field should carry); there is no mechanical conversion between two metadata versions for `objectstack migrate meta` to apply. Measured at `2678600d57`: 0 fields spelled `[a-z0-9]__c` in `examples/**`, `packages/*/src` and `skills/**` outside tests (7 textual hits, all in doc comments). The other categories are closed on facts: all three packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); no `packages/spec/**` file is touched, so no schema, type or runtime interface moves (not type-surface-only, not runtime-interface-only); and no export is retired (not runtime-export-retired). -->

ADR-0146 D10 reserves the `__c` field suffix to the customer's layer — maintainer, verbatim: 「扩展字段用 __c 后缀，只有 .custom 包能用。」 So a customer's field on a base object is `region__c`, a vendor's next version can never take that name, and nobody mistakes the customer's field for the vendor's. The reservation was declared in `@objectstack/spec` (`EXTENSION_FIELD_SUFFIX`, `isExtensionFieldName`) and read by no door.

**What is refused**, given the package a body is written into:

- **(a) `__c` outside a `.custom` pair.** In a package that is not a base's paired `<base>.custom`, every field spelled `__c`, on its own objects or in its `objectExtensions`: "the `__c` suffix is reserved to a base's paired `.custom` package (ADR-0146 D10); rename the field." A field one vendor package adds to another's object keeps the plain spelling.
- **(b) An unsuffixed extension field in a `.custom` pair.** Every `objectExtensions[].fields` key without the suffix: "name it `<name>__c`, or change a base field's display properties in the extension's patch (`fieldPatches`)."

A `.custom` pair's own new objects are not judged (their fields are its own), and neither is a write bound to no package.

**Where**, each door in its own envelope, no new code:

- the save door (`saveMetaItem`, so `PUT /api/v1/meta/object/:name`), the restore (`rollbackMetaItem` and `revertCommit`'s restore limb) and the draft promotion (`publishMetaItem`, `publishPackageDrafts`), for an `object` body: `400 VALIDATION_ERROR`, `issues[]` locating each field;
- `duplicatePackage`, judged against the target id before the copy writes anything: a copy of a `.custom` pair's `__c` objects into a plain id is refused whole, `400 VALIDATION_ERROR`;
- `os validate`: exit 1, each field's path on `errors` (`code: 'VALIDATION_ERROR'`, `rule`, `packageId`, `message`);
- the marketplace install (`POST /api/v1/marketplace/install-local`), at the dependency check's position, before the manifest service sees the artifact, on the managed and the unmanaged branch: `422 VALIDATION_ERROR` (the door's existing body refusal), one row per field in `details.refusals`; nothing is registered and no ledger entry is written.

`installPackage` needs no call: its manifest (`PackageInstallManifestSchema`) is closed, its `objects` are glob strings and it has no `objectExtensions` key, so a field body never reaches it.

**Migration.** None needed for this repository: 0 fields affected (measured above). A package that ships a `__c` field outside `.custom`, or a `.custom` extension field without the suffix, renames the field.

`@objectstack/metadata-protocol` exports the judge, `judgeExtensionFieldSuffix`, with the active doors' envelope (`extensionFieldSuffixRefusalError`) and the one-item question those doors ask (`objectBodyExtensionFieldSuffixRefusal`), so every door asks one judgement.
