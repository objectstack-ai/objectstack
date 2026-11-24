---
'@objectstack/spec': patch
'@objectstack/core': patch
---

Clause-②: no
Metadata-protocol: none

Two more import row refusals are now sentences of the built-in validation message catalog (`BUILTIN_VALIDATION_MESSAGES`, all four platform locales) and name fields by their label instead of their API name, the same way the duplicate-match-key row does. Each reads in the caller's locale when the caller carries one and in English otherwise, and a deployment override reaches it only where the caller passes a translator. A row blank on every ordered key set (`BLANK_MATCH_KEY`) reads the new `import_blank_match_key` entry, naming each key set by label (`Email; Phone + Company`); its caller is the import endpoint (`POST /data/:object/import` with ordered key sets), which passes the request locale and the deployment's translator, so it reads in the request language and can be overridden under `validation.field.import_blank_match_key`. A run whose match key names a field holding a list or a structured value fails every row with the new `import_multi_value_match_key` entry, naming those fields by label; its only callers are the ones that reach the import runner without the import door (the connector and datasource pulls), which pass no request locale and no translator, so there it reads in English and `validation.field.import_multi_value_match_key` is not consulted. A deployment override of any of the three match-key sentences can name the API names as `{{field}}`. The rows keep their shape and codes (`BLANK_MATCH_KEY`, `VALIDATION_ERROR`), and the multi-value row's `field` still carries the API name; only the `error` text changes. The import door's own `400 INVALID_REQUEST` refusal of such a key is unchanged.
