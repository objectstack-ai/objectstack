---
'@objectstack/plugin-approvals': patch
---

fix(approvals): the Approval Actions list and an action's record page name the step and the platform's own notes in the reader's language

Clause-②: no
Metadata-protocol: none

`sys_approval_action` read through the generic data door (Setup's Approval Actions list, an action's record page, the export) now serves, to a reader with a locale, the same text the approvals door's timeline serves:

- `step_label`: the step's label from the app's language pack (`flows.<flow>.approvals.<step>.label`), as the Approval Requests list already did. Before, the stored authoring-language snapshot was served to every reader.
- `comment` on the rows the platform writes itself: the administrators' routing note, the submitter exclusion note and the no-approver note, which are stored as data on the request, and the cancellation written when the record a pending request is about is deleted ("Auto-cancelled: the … record '…' this request is about was deleted"), now a catalog sentence (`approvalAutoCancelledRecordDeleted`, in all eleven shipped languages) composed from the request's own columns. The approvals door's timeline serves that cancellation in the reader's language too.

A comment a person wrote is served as written. A list that selects `step_label` or `comment` without the columns their text is picked by is served exactly the columns it selected. Storage is unchanged: the stored step label stays the authored text and the stored comment the English, which is what a system read, a reader with no locale and a language the pack does not hold are served. Nothing to migrate.
