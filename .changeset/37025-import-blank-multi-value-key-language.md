---
'@objectstack/spec': patch
'@objectstack/core': patch
---

Clause-②: no
Metadata-protocol: none

Two more import row refusals now read in the importing user's language and name fields by their label instead of their API name, the same way the duplicate-match-key row does. A row blank on every ordered key set (`BLANK_MATCH_KEY`) reads the new `import_blank_match_key` entry of the built-in validation message catalog (`BUILTIN_VALIDATION_MESSAGES`), naming each key set by label (`Email; Phone + Company`). A run whose match key names a field holding a list or a structured value, which fails every row for a caller that reaches the import runner without the import door (a mapping's connector pull), reads the new `import_multi_value_match_key` entry, naming those fields by label. Both entries exist in all four platform locales, and a deployment can override them under `validation.field.import_blank_match_key` and `validation.field.import_multi_value_match_key`. The rows keep their shape and codes (`BLANK_MATCH_KEY`, `VALIDATION_ERROR`), and the multi-value row's `field` still carries the API name; only the `error` text changes. The import door's own `400 INVALID_REQUEST` refusal of such a key is unchanged.
