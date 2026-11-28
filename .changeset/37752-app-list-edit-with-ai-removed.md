---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console)!: the app management page no longer offers "Edit with AI", which opened the retired build agent, and its two released translation keys are removed

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) The removed operands are translation keys in the published i18n catalogues: no packages/spec schema, registered node type, stored metadata row or ADR-0087 conversion surface names them, and nothing a metadata author writes changes, so there is nothing for objectstack migrate meta to rewrite -->

Each packaged app on the console's app management page carried an "Edit with AI" row action that opened the AI chat on the build agent, scoped to that app's package. The build agent is retired, so the button led to a closed feature. The button is removed; the row keeps its open, edit, enable or disable, set-default and delete actions.

**BREAKING**: released keys are removed. `@object-ui/i18n@18.6.0` shipped both keys below, in every locale; the button above was their only reader, and no code in the platform reads them any more. The exported `TranslationKeys` type loses the same two leaves.

- `appManagement.editWithAi`
- `appManagement.editWithAiNamed`

If a deployment overrides one of these keys (in its own i18next resources, or a Studio catalogue it registers), that override no longer applies: nothing in the console or Studio asks for the key, so the overriding text is never shown. Remove the override.
