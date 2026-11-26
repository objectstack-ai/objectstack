---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the approvals inbox search finds a request by the record title, process label, object label and requester name its row shows

Clause-②: no
Metadata-protocol: none

The inbox search box ("Search record, process, requester…", `GET /api/v1/approvals/requests?q=`) matched only the stored machine columns (`process_name`, `object_name`, `record_id`, `submitter_id`) and, where the caller reads it unmasked, the raw snapshot. Text a row actually shows, such as a record title, a process label, a requester's name or an object label, found nothing, while a machine fragment like `crm_` found every row.

`q` now also matches the four labels a row shows, each worked out the way that caller is served it:

- the record title, as served to the caller: a title field the caller may not read, or reads masked, does not match;
- the process label in the caller's language: the translated label where the reader's language pack has one, otherwise the stored label. A reader who is shown the translation is not found by the stored text;
- the object label, chosen the same way;
- the requester's display name.

Matching stays case-sensitive, like the existing arms (`$contains`). The `q` parameter accepts the same values as before. A title that comes only from a deleted record's snapshot is not searched by this path.
