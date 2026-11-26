---
'@objectstack/spec': patch
---

fix(spec): a deployment's validation override prints a written value exactly as written

Clause-②: no
Metadata-protocol: none

`renderValidationMessage` (`@objectstack/spec/system`) now asks a deployment's `validation.field.<messageKey>` override for its template, without the parameters, and fills the placeholders once. Before, the `i18n` service filled them and the renderer filled the result again, so a written value that itself contained a placeholder, such as a select value `{{label}} plan` refused as `invalid_option_value`, was expanded on the second pass and the refusal showed the field label where the user's own value should be. An override's text now quotes the value exactly as written, as the built-in sentence already did. Overrides that use only `{{name}}` placeholders read the same as before.

The `translate` option of `RenderValidationMessageOptions` and `RenderOperationMessageOptions` now says it is asked for the template with no params. Its type is unchanged. The error code, status and the shipped `value` field of the refusal are unchanged.
