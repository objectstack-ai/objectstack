---
"@objectstack/spec": minor
---

spec: add `defineX` factories for the remaining 16 writable domains and the 6
missing `XInput` aliases — one consistent, type-safe authoring entry per domain
(#2035).

New factories: `defineDatasource`, `defineConnector`, `definePolicy`,
`defineSharingRule`, `defineRole`, `definePermissionSet`,
`defineEmailTemplateDefinition`, `defineReport`, `defineWebhook`,
`defineObjectExtension`, `defineCube`, `defineMapping`, `defineTheme`,
`defineTranslationBundle`, `definePage`, `defineAction`. Each mirrors the 19
existing factories (`XSchema.parse(z.input<…>)`): input-shape ergonomics +
authoring-time validation. Because a factory is a *value* import, a broken
import hard-errors instead of silently degrading to `any` (the #2023 failure
mode), and errors surface at `.parse()` time with field-level messages.

Also adds the previously-missing input aliases `PolicyInput`, `CubeInput`,
`MappingInput`, `ThemeInput`, `TranslationBundleInput`, `PageInput`.

Purely additive: no existing exports change.
