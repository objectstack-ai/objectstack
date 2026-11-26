---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/rest': patch
'@object-ui/plugin-grid': patch
---

Clause-②: no
Metadata-protocol: none

An import row refused because another row of the same file carries the same match key (`DUPLICATE_MATCH_KEY`) now reads in the importing user's language, like the cell errors beside it, and names the key by its field label (`Email`, `Supplier + Type`) instead of its API name; the row numbers stay in the sentence. The sentence is the new `import_duplicate_match_key` entry of the built-in validation message catalog (`BUILTIN_VALIDATION_MESSAGES`, in all four platform locales), so a deployment can override it under `validation.field.import_duplicate_match_key`. The row keeps its shape (`code`, `error`); only the `error` text changes. An English deployment reads the same sentence as before, with the field label where the API name was.

The console import wizard shows a row refused by an object-level validation rule (a rule that names no field, reported on the `_record` field) as its message alone, without a `_record:` prefix, in the dry-run findings, on the result screen and in the failed-rows download. A field-level error keeps its `Label: message` form; the failed-rows download now prefixes it with the field label too, where it used the API name.
