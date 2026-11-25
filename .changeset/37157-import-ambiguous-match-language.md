---
'@objectstack/spec': patch
'@objectstack/core': patch
---

Clause-②: no
Metadata-protocol: none

The import row refusal for a row whose match key finds more than one stored record (`AMBIGUOUS_MATCH`) is now a sentence of the built-in validation message catalog (`BUILTIN_VALIDATION_MESSAGES`, all four platform locales), the new `import_ambiguous_match` entry, the same way the duplicate-key, blank-key and multi-value-key rows are. It names the key set the row was matched by its field labels instead of the old English `matchFields matched more than one <object> record`, which named the API parameter and the object's API name. It reads in the caller's locale when the caller carries one and in English otherwise, and a deployment override (`validation.field.import_ambiguous_match`, which can also print the API names as `{{field}}`) reaches it only where the caller passes a translator: the import endpoint (`POST /data/:object/import` and the async import job) passes both the request locale and the deployment's translator, while the connector and datasource pulls pass neither and so read English. The row keeps its shape and its code; only the `error` text changes.
