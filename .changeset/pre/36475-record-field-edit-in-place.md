---
'@object-ui/plugin-detail': patch
---

feat(plugin-detail): on the record page a click on a field's value edits that field alone and saves it when you move on

Clause-②: no
Metadata-protocol: none

On the default record page's field list (the full page, the side preview, a phone and the wide page's pinned column), a click on an editable value no longer turns the whole record into a form with a Save / Cancel bar. Only that value becomes an editor, drawn over it, so the other fields and the page stay as they are, and no bar appears:

- A typed value (text, number, amount, percent, email, phone, URL) saves on Enter or a click elsewhere; Esc discards it and writes nothing.
- A multi-line text saves on Ctrl/Cmd+Enter or a click elsewhere; Enter starts a new line.
- A single select, a date, a record or a person opens its panel at once and saves on the pick; a multi-select saves when you move on. These are the list cell's editors (`FieldEditWidget` with `inCell`).
- A check flips and saves on the click.
- An unchanged value writes nothing.

The write is the one the save bar makes: one guarded update carrying that field only, then the record is read again, so the fields whose visibility, read-only state or requirement depend on it are judged anew. A refused save keeps the editor open with the typed value and the server's reason under the field; a conflicting change opens the same reload / overwrite dialog, and a value that makes other fields required asks for them first. Esc in the editor inside the side preview cancels the edit and leaves the preview open.

Unchanged: the header's Edit (the whole record as a form with its Save and Cancel), the list's cell editing, and pages an author laid out (a double-click or the pencil there). `InlineEditSaveBar` gains `face="field"` (no bar, its dialogs only) and `saveRef` (its save, for that host to call); the default stays the bar.
