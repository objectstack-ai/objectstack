---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/types': patch
'@object-ui/plugin-designer': patch
---

feat(studio): the field inspector, the field designer and the object's settings write Field change values instead of Track history

Clause-②: yes (widening)
Metadata-protocol: none

Old → new values show on the record activity by default, and an object or a single field can turn them off. The Studio now writes that setting where an author looks for it:

- **Field inspector.** The "Track history" box is gone. In its place, "Field change values" offers Default, On and Off. Default leaves the field's `fieldHistory` unset and names what it means for this field on this object: "Default (On)" for most types, "Default (Off)" for a media, JSON or credential field, and "Default (Off)" for every field when the object turns values off, with a note saying so. On and Off write `fieldHistory: true` and `false`; choosing Default after Off removes the key. A stored `trackHistory` is kept as it is and never written.
- **Field designer** (`@object-ui/plugin-designer`). The drawer's "Track History" switch, which wrote `trackHistory: false` on every save, is replaced by "Field Change Values" with the same three choices: Default (named "Default (On)" or "Default (Off)" for the type in the drawer, and it follows a type change), On, Off. A stored `trackHistory` is carried through an edit and never written. `DesignerFieldDefinition` (`@object-ui/types`, with its zod mirror) gains an optional `fieldHistory`, and both designer save paths (`MetadataFieldsPage`, `MetadataService.saveFields`) carry it; Default sends no key, which removes a stored one.
- **Object settings.** The Features card gains "Field change values" (`enable.fieldHistory`). Unticking it writes `false`; ticking it again removes the key rather than writing `true`, since unset already means on. Sibling `enable` keys are kept.

The inspector and the metadata form's Field History control share one module for the three choices, what each writes and their wording; the field designer cannot import it (the app shell depends on the designer) and shares the rule itself, `resolveFieldHistory` from `@objectstack/spec/data`. New Studio strings `designer.field.fieldHistory`, `designer.field.fieldHistoryObjectOff`, `engine.studio.settings.capFieldHistory` and `engine.studio.settings.capFieldHistoryDesc` (en, zh); `designer.field.trackHistory` is removed with the box it labelled. In the language packs, `appDesigner.fieldDesigner.trackHistory` is replaced by `appDesigner.fieldDesigner.fieldHistory`, `fieldHistoryDefault`, `fieldHistoryOn` and `fieldHistoryOff`, in all eleven locales.
