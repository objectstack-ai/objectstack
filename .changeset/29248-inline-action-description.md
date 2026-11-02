---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): an inline action can carry `description`, the line its param dialog shows under the title

Clause-②: yes (widening)
Metadata-protocol: added

An action declared inline on a page (`element:button`'s `properties.action`, typed `InlineAction`) can now say what it does. Before, `description` on it was refused as an unknown key (`unrecognized_keys`), so a page action that collects params opened its dialog with the generic line and nothing about what confirming would do.

- **The key.** `InlineActionSchema` picks `ActionSchema`'s own `description`: a `template` slot (a bare string is shorthand for `{ dialect: 'template', source }`, with `{{ record.* }}` holes) or an inline locale map (`{ en, "zh-CN" }`), each value such a sentence. The `InlineAction` type gains it too. Nothing else is picked: `icon`, `variant`, `body`, `cancelText` and `submitText` stay unknown keys on an inline action.
- **Judged like a registered action's.** `objectstack validate`, `compile` and the publish gate now judge an inline `description` with the same rules as a registered one: a `${…}` or single-brace token, a hole over a root the runner does not bind, a hole holding logic or an unknown formatter, and a blank sentence are each an error, named at `… (element:button) · action description` (or `description.<locale>` inside a locale map).
- **Where it shows.** The console's `element:button` already forwards `description` to the action runner, and the param dialog draws it under its title. One gap remains on the console side: its inline copy localizer collapses `confirmText`, `successMessage` and `errorMessage` to the user's language but not yet `description`, so until it does, an inline locale map on `description` reaches the dialog unresolved.
