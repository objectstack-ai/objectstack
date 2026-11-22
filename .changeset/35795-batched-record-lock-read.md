---
'@objectstack/spec': patch
'@objectstack/rest': patch
'@objectstack/plugin-approvals': patch
'@objectstack/client': patch
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

fix(approvals, list): a list cell no longer opens an editor before it knows the record's approval lock, and the list reads the locks of a page in one request

Clause-②: yes (widening)
Metadata-protocol: none

**What a list user sees.** On a list that edits in place, a double-click, Enter, F2 or a typed key on a cell whose record's approval lock or edit permission is still being read no longer opens an editor that the server would then refuse on save. The cell says "Checking whether this record can be edited…", and when the answer arrives the same edit goes ahead by itself (with the typed key), or the cell says why it does not: the record is locked while it is in approval, or the reader has no permission to edit it. Selecting another cell in the meantime drops the wait. Moving the selection with the arrow keys no longer sends a lock request per row: the first cell selected on a page asks the locks of every row on it at once.

**New route.** `POST /api/v1/approvals/records/:object/locks` with the body `{ "recordIds": ["<id>", ...] }` (at least one id, at most `APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS`, 200) answers `{ success: true, data: { records: [{ recordId, locked }] } }`, one entry per id in order. `locked` is what `GET /api/v1/approvals/records/:object/:recordId/lock` answers for that id, and `null` where that route answers 404: a record the caller cannot read and one that does not exist answer alike. Any other body (a key other than `recordIds`, an empty list, a non-string or blank id, more ids than the cap) and any query parameter are refused whole with `400 VALIDATION_ERROR`, never trimmed. A deployment whose approvals service does not implement the read answers `501`.

**Contract and SDK.** `IApprovalService` gains the optional member `getRecordLocks(object, recordIds, context)`, entry `i` answering `recordIds[i]` exactly as `getRecordLock` does; the approvals plugin implements it in two reads whatever the page size (the caller's read of the ids, then one pending-request lookup judged by the record-lock hook's own judgement). `@objectstack/spec/contracts` exports `APPROVAL_RECORD_LOCKS_MAX_RECORD_IDS`. `@objectstack/client` gains `client.approvals.getRecordLocks(object, recordIds)`.

**Components.** `GridCellFacts` (the select-first table's per-cell facts) gains the optional `checking: { text, settled }`: while present, an edit asked on the cell shows `text` and is asked again when `settled` settles; a toggle, paste or clear shows `text` and writes nothing. A host that sets no `checking` sees no change.
