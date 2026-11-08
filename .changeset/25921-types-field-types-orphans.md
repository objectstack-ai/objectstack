---
'@object-ui/types': patch
---

refactor(types)!: delete the two `field-types` orphans nothing reads, `VisibilityCondition` and `GeolocationFieldMetadata`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/types#VisibilityCondition, @object-ui/types#GeolocationFieldMetadata) the retired operands are TypeScript-only shapes declared in `field-types.ts`: a condition object that typed the field key objectui#12242 retired, and the interface of a field type that is not a spec `FieldType` and already left the `FieldMetadata` union; nothing in the workspace or in hotcrm imports either from the package entry, they have no zod twin, they are not arms of `AnySchema`, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports either of these two types from `@object-ui/types`. Neither had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Both were already marked `@deprecated`.

They are **gone from the package, not only from the entry**: `src/field-types.ts` no longer declares them. They were types only, so the built JavaScript is unchanged. Every other field metadata type stays, including every member of `FieldMetadata`.

What leaves, and what to write instead:

- FROM `VisibilityCondition` TO no replacement in this package. It typed the retired `visible_on` key; a field's visibility is `visibleWhen`, a CEL predicate on the field.
- FROM `GeolocationFieldMetadata` TO no replacement. `geolocation` is not a spec field type, so no published object can declare it; the spec's map-point field type is `location`, typed by `LocationFieldMetadata`. The `field:geolocation` widget in `@object-ui/fields` stays registered.
