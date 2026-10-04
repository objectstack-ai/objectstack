---
'@objectstack/spec': minor
---

A flow screen field's help text is translatable: the `flows` translation face carries `inlineHelpText` beside `label` and `placeholder` (#17306).

Clause-②: yes (widening)

- **`TranslationDataSchema`.** `flows.<flow>.screens.<node_id>.fields.<field>` accepts `inlineHelpText`, the key the screen field itself declares (`ScreenFieldConfig.inlineHelpText`, the object field's spelling). The console's screen dialog draws that text under the control, so a translated help line now renders in the active locale.
- **`FLOW_SCREEN_FIELD_COPY_KEYS`** (`@objectstack/spec/system`) is `['label', 'placeholder', 'inlineHelpText']`. Its readers follow it without an edit: `translateFlow` overlays the key, `os i18n extract` scaffolds it, and objectui's `FlowRunner` overlays it on the field it draws. `FlowScreenFieldLike` gains the optional `inlineHelpText` member.
- **Refusals.** `help`, `helpText`, `hint`, `tooltip` and `description` on a screen field translation are still refused, and the message now names the rename to `inlineHelpText`. They used to be told that the face had no help key. `options` is still refused with its guidance.

Nothing that parsed before is refused now. A bundle that never wrote a help line is unchanged.
