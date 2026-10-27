---
'@object-ui/i18n': patch
---

feat(i18n): the Studio option editor's lifecycle `kind` picker has its labels

Clause-②: no
Metadata-protocol: none

- Studio's picklist option editor can now set an option's lifecycle `kind` (`open` / `won` / `lost`, the key `SelectOption.kind` already publishes), so a select built in Studio can be chosen as the object's Lifecycle field (`stageField`) instead of the save being refused for options that declare no kind. The picker is drawn only on a single-value `select` / `radio` field, the one shape the spec lets carry a kind. The `studio` namespace gains its labels (`designer.field.optKind`, `designer.field.optKind.unset` / `.open` / `.won` / `.lost`), the malformed-option reason `designer.field.optMalformed.kindNotValid`, and the lifecycle-field hint `designer.field.hint.stageKinds`, in `en` and `zh`. No export changes.
