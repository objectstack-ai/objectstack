---
'@objectstack/spec': minor
---

fix(spec): a translated validation or operation message fills {{ label }} holes written with spaces, as the Console does

Clause-②: yes (widening)
Metadata-protocol: semantic

A deployment that overrides a built-in validation message (`validation.field.<key>`) or operation message (`errors.<key>`) in a translation can now write a placeholder with spaces inside the braces, `{{ label }}`, and the server fills it. Before, `interpolateValidationMessage` (used by `renderValidationMessage` and `renderOperationMessage`) filled only `{{label}}`, so the same translation showed a value in the Console and raw braces in a 400 or 409 answer, such as an import row refusal or a duplicate-record error. Whitespace (spaces or tabs) between the braces and the name is now allowed. A placeholder with no value is still left exactly as written, spaces included, and single braces (`{label}`) are still not a placeholder. The built-in messages render byte-for-byte as before, and no change is needed in your bundles: `{{label}}` works as before.
