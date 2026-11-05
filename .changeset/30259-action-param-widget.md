---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
---

feat(spec): an action param can name the widget that draws it (`widget`, same key as on a field), so a param can ask for the permission-set picker (ADR-0131 D4)

Clause-②: yes (widening)
Metadata-protocol: additive

- **`@objectstack/spec`: `ActionParamSchema.widget`**, an optional string with the same key, vocabulary and meaning as `FieldSchema.widget`. It names a registered field component, looked up as `field:` plus the name, to draw the param in the action dialog instead of the `type` default. `type` stays the value's type. The case it exists for is `widget: 'permission-ref'` on a `text` param: it lists the permission sets of the security catalog and submits the chosen machine name, the picker the grant column `sys_user_permission_set.permission_set` already uses. Like the field key it is an open string: an unregistered name is kept, and the dialog draws the `type` renderer instead. A non-string is refused. A param that does not declare the key parses exactly as before. Until now a param naming `widget` was refused as an unknown key.
- **Not read yet.** The console's param resolver does not carry the key to the dialog's widget until objectstack#30260 lands. Until then a param that declares it is drawn by its `type` renderer, and its value is submitted as before.
- **`@objectstack/platform-objects`: the action form's Params repeater offers the key** as a `Widget` column, labelled in en, zh-CN, ja-JP and es-ES.
