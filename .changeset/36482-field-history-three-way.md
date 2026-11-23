---
'@objectstack/spec': patch
'@objectstack/plugin-audit': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the Field History setting offers Default, On and Off, and Default says what it resolves to

Clause-②: yes (widening)
Metadata-protocol: none

The Field History setting on the field form, on each row of the object form's field list, and in the object's capabilities is now a three-way choice instead of a switch. Default leaves the setting unset, so the field (or object) follows the platform, and it names what that means for the row: "Default (On)" for most field types, "Default (Off)" for a media or JSON field unless the field opts in with Track History, and for a credential field always. On and Off write `true` and `false` as before. A setting turned off can now be returned to Default, which removes the key.

`@objectstack/spec/data` exports `resolveFieldHistory(field, object)` and `FIELD_HISTORY_DEFAULT_OFF_TYPES`: whether a changed field's old → new values show on the activity timeline, and the types that are off by default. The activity writer in `@objectstack/plugin-audit` now asks this predicate instead of its own copy of the type list, so the default the form shows and what the writer keeps cannot disagree. Behaviour of the writer is unchanged.
