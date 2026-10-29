---
'@object-ui/types': patch
'@object-ui/components': patch
---

refactor(ui-types): one source for the filter-builder field-type list, read by the validator, the interface and the renderer

Clause-②: no
Metadata-protocol: none

The `filter-builder` field types used to be listed three times by hand: in `FilterFieldSchema.type`, in `FilterField['type']`, and in the renderer's behaviour buckets. Each copy could drift from the others, and past fixes repaired exactly that drift. There is now one declaration. The accepted set is unchanged: the same fourteen members, `type` still optional, and `text` still the default when it is absent.

- **`@object-ui/types`** exports `FILTER_FIELD_TYPES` and the four behaviour buckets it is built from: `FILTER_NUMBER_LIKE_TYPES`, `FILTER_DATE_LIKE_TYPES`, `FILTER_SELECT_LIKE_TYPES` and `FILTER_LOOKUP_LIKE_TYPES`. It also exports the member type `FilterFieldType`. `FilterFieldSchema.type` builds its enum from the list, and `FilterField['type']` is `FilterFieldType`.
- **`@object-ui/components`**: `filter-builder` takes its number-, date-, select- and lookup-like buckets from `@object-ui/types` and no longer declares its own. What it draws for each type is unchanged.
