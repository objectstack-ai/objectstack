---
'@object-ui/fields': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(list,detail): a change that makes other fields required asks for them in place — the kanban drop's fill-in, now shared by the list cell and the record page

Clause-②: yes (widening) — `@object-ui/fields` exports `collectRequiredWhenPromptFields`, `RequiredFieldsDialog` and their types (moved from `@object-ui/plugin-kanban`, which never exported them); nothing removed or renamed
Metadata-protocol: none

When a value about to be written makes another field's `requiredWhen` true while that field is still empty, the write is held and one dialog asks for the missing values:

- **Where:** a list cell in the select-first grid every `ListView` draws, the record page's inline Save, and the kanban drop (as before).
- **What it shows:** the record's name, the change that set it off (read-only), and one row per field to fill, with the editors the record form uses. A value typed there that makes one more field required adds that field; Save waits for it.
- **Save** writes the change and the typed values as ONE update. **Cancel** writes nothing: the list cell keeps its value; on the record page the edit session and its draft stay.
- **A refusal of that update stays in the dialog:** under the field it names, as a new row for another field the reader can fill, or at the dialog's foot.
- **Not asked for**, and written and refused as before: a field that already has a value, is hidden or read-only, that the reader may not write, or that has no in-place editor (a file, rich text, a formula). The record drawer's per-field save does not ask either.

The pre-evaluation is the one the kanban drop already used (`resolveFieldRuleState`, the evaluator the form and the server share, judged as the engine's transition gate), generalised from one key to any set of changed keys.
