---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': minor
'@objectstack/plugin-approvals': minor
'@objectstack/plugin-audit': minor
'@objectstack/plugin-security': minor
'@objectstack/plugin-sharing': minor
'@objectstack/plugin-webhooks': minor
'@objectstack/service-automation': minor
'@objectstack/service-mailbox': minor
'@objectstack/service-messaging': minor
'@objectstack/service-realtime': minor
'@objectstack/service-storage': minor
---

feat!: an object that declares `titleFormat` is refused at save and by `os validate`, with the `nameField` prescription (#29007)

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered object-title-format-refused -->

**BREAKING** accept-set narrowing on `object.titleFormat`. The key stays in the schema; what changes is which doors accept it.

- **Before.** `titleFormat` was deprecated (ADR-0079) and still accepted: a save, a publish and `os validate` all passed, with an advisory `title-format-retired` warning on the CLI only. It titled nothing. An explicit `nameField` outranks it, and the registry stamps a derived `nameField` on every object that authors none, so the record page and the list showed one field however the template was written.
- **Now.** `title-format-retired` is an error. An object definition that declares `titleFormat` is refused by `os validate`, `os build` and `os lint`, and at the metadata save gate (`422 INVALID_METADATA`): an active save, a draft promotion and a restore. A draft save still lands, and its `_diagnostics` reads `valid: false` with the refusal its publish gives. The message and the fix line are the prescription the `titleFormat` describe already carried.
- **Unchanged.** A stored object that carries `titleFormat` still parses, loads and is served; no conversion drops the key. It is refused only when it is next saved, published or restored. The title order is unchanged: `nameField`, then its alias `displayNameField`, then the derivation.
- **The platform's own objects.** The 68 system objects that declared `titleFormat` no longer do. 65 already declared the `nameField` that titles them. `sys_attachment`, `sys_audience_binding_suggestion` and `sys_notification_template` now declare the field the registry already stamped (`file_name`, `permission_set_name`, `subject`), so every record title reads as before.
- **`@objectstack/lint`.** `validateTitleFormatRetired` is a new export and a new gating registry entry. `validateRecordTitle` now reports `title-unresolvable` only.

**The remedy.** Point `nameField` at the title field and drop `titleFormat`. For a composite title that an import, a sort or a search must match, add a `text` field that declares an `expression` (computed and stored on every write) and point `nameField` at it; a `formula` with `returnType: 'text'` stays legal for a title shown for display only. The upgrade guide entry is `object-title-format-refused`.
