---
'@objectstack/spec': minor
'@objectstack/plugin-audit': minor
'@objectstack/platform-objects': patch
'@objectstack/metadata-core': patch
'@objectstack/cloud-connection': patch
'@objectstack/plugin-sharing': patch
'@objectstack/service-automation': patch
'@objectstack/service-messaging': patch
'@objectstack/service-realtime': patch
---

feat(audit): a record's activity stream shows each changed field's old → new values by default, and a reader is served only the changes of fields they may read

Clause-②: yes (widening)
Metadata-protocol: semantic

A record's activity stream now shows `Field: old → new` for every changed field, on every object, unless the object or the field turns it off. Before, values showed only for a field that declared `trackHistory: true`. Every other change was named by its field label alone.

- **New `enable.fieldHistory`, with no default.** Absent: values show. `false`: off for the object, and a change names its fields only. It has no default so that a parsed body never writes one. A built artifact or a stored definition therefore gets values when it is upgraded, with no rebuild.
- **`enable.trackHistory: false` alone no longer turns values off.** The flag keeps its meaning: with `true`, the default record page shows the compliance ledger's field changes to a reader the ledger serves, and the derived `history` API verb is served. To keep an object's activity free of values, write `enable: { fieldHistory: false }`. Every platform object that wrote `trackHistory: false` now also writes `fieldHistory: false`.
- **Field `trackHistory`:** absent shows the values, `false` names the change without them, `true` shows them. A credential field (`secret`, and `password` off better-auth objects) never shows values, because both sides are the same mask. A media or structured-JSON field (`image`, `file`, `avatar`, `video`, `audio`, `signature`, `composite`, `repeater`, `record`, `location`, `address`, `code`, `json`, `vector`) shows them only with an explicit `true`.
- **Who reads a value:** the field-change code (`metadata.summary_message`) is now served to readers. It is narrowed change by change with the same field answer as `metadata.old` and `metadata.new`. A reference field's change is kept only for a reader served the referenced record's title. When a reader is not served some of a summary's changes, the summary is rebuilt from the changes they are served instead of being dropped whole. The full audit ledger is not widened.
- **A long value no longer fails the activity insert.** The stored summary is fitted to `sys_activity.summary`'s `maxLength` (500): each side is cut first, then trailing changes are left out. The code keeps every change, with each side capped at 1,000 characters.

To keep an object's activity free of values, set `enable: { fieldHistory: false }` on it. For one field, set `trackHistory: false` on that field.
