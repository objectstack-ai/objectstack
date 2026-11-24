---
'@object-ui/fields': patch
'@object-ui/plugin-detail': patch
---

feat(detail): the record header's stage menu asks for the fields a stage needs through the shared fill-in dialog

Clause-②: no
Metadata-protocol: none

The stage menu beside the record's name now opens the same dialog the list cell, the record page's inline Save and the kanban drop open (`RequiredFieldsDialog`, with `collectRequiredWhenPromptFields` judging which fields to ask for), and its own copy of the pre-check and field form is gone:

- **What it shows:** the record's name and the move (「阶段：赢单」, read-only), then the fields the stage makes required while they are still empty. A stage that needs nothing opens the same dialog as the move's confirmation, with Move focused so Enter confirms.
- **Move** writes the stage and the typed values as ONE update; **Cancel** writes nothing. A value typed there that makes one more field required adds that field, and Move waits for it.
- **A refusal stays in the dialog** and the stage does not move: under the field it names, as a new row for another field the reader can fill, or at the foot (someone else changed the record, which is then re-read; a permission or other refusal as the stage line it was before).
- **Now not asked for, and refused as before:** a field with no in-place editor (rich text, a file, a formula). The menu's old form did not ask whether a field has one; the shared pre-check never offers such a field.

`record:path`'s stage press keeps its plain confirmation.
