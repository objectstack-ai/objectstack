---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the field inspector and the object's settings write Field change values instead of Track history

Clause-②: yes (widening)
Metadata-protocol: none

Old → new values show on the record activity by default, and an object or a single field can turn them off. The Studio now writes that setting where an author looks for it:

- **Field inspector.** The "Track history" box is gone. In its place, "Field change values" offers Default, On and Off. Default leaves the field's `fieldHistory` unset and names what it means for this field on this object: "Default (On)" for most types, "Default (Off)" for a media, JSON or credential field, and "Default (Off)" for every field when the object turns values off, with a note saying so. On and Off write `fieldHistory: true` and `false`; choosing Default after Off removes the key. A stored `trackHistory` is kept as it is and never written.
- **Object settings.** The Features card gains "Field change values" (`enable.fieldHistory`). Unticking it writes `false`; ticking it again removes the key rather than writing `true`, since unset already means on. Sibling `enable` keys are kept.

The three choices, what each writes and their wording are shared with the metadata form's Field History control, so the two surfaces cannot drift. New Studio strings `designer.field.fieldHistory`, `designer.field.fieldHistoryObjectOff`, `engine.studio.settings.capFieldHistory` and `engine.studio.settings.capFieldHistoryDesc` (en, zh); `designer.field.trackHistory` is removed with the box it labelled.
