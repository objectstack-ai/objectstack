---
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/runtime': patch
'@object-ui/fields': patch
---

feat(spec): an action param's `helpText` takes an inline locale map, so an inline action can write its param hint per locale

Clause-②: yes (widening)
Metadata-protocol: added

- **`@objectstack/spec`: `ActionParamSchema.helpText`** accepts an inline locale map (`{ en: 'Why the account is paused', 'zh-CN': '暂停该账户的原因' }`) beside the bare sentence and the `{ dialect: 'template', source }` envelope, the same three forms `description`, `confirmText`, `successMessage` and each `outcomeMessages` entry already take. It reaches every action that carries params: a registered action (`ActionSchema.params`) and a page button's inline `action` (`InlineActionSchema`). A registered action's hint is still translated through the bundle at `objects.<object>._actions.<action>.params.<param>.helpText`; the map is the form for an inline action, which no bundle reaches. Before, a page that wrote its dialog's title, line, option labels and toast as locale maps had to leave the hint out or show it in one language. Every value that parsed before parses to the same thing. A map key that is not a language tag is refused with the slot's own sentence.
- **`@objectstack/lint`:** `os validate`, `compile` and the publish gate judge each entry of a `helpText` map as a sentence, named at `params[N].helpText.<locale>`, the way they judge a `description` map: a blank entry, a `${…}` or single-brace token, a hole over a root the dialog does not bind (`record` only), logic in a hole or an unknown formatter is an error. `os i18n extract` records the map as authored text (its locales count as covered, a locale it omits is reported) and scaffolds no bundle row for it.
- **`@objectstack/runtime`:** the agent-facing tool schema (`summarizeActionParams`, read by the MCP action tools) reads a `helpText` map's source-language entry (`en`, then `default`, then any entry) instead of falling back to the bound field's description.
- **`@object-ui/fields`:** `resolveActionParams` resolves a `helpText` map for the active language with the same order as `label`, so the param dialog draws the viewer's language. A map no longer falls through to the field's help line; an envelope with no `source` still does.

Callers that read `helpText` and may now see a map: the console's `resolveActionParams` (handled here), the runtime's `summarizeActionParams` (handled here), the lint copy door and the i18n walk (handled here), and the server-side `translateAction`, which overlays a bundle sentence when one exists and otherwise passes the authored value through unchanged, as it does for a `description` map.
