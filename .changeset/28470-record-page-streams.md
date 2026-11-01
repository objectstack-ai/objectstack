---
'@objectstack/spec': patch
'@objectstack/rest': patch
---

feat(rest): the record page payload carries the record's discussion, activity and attachments, and the related rows' names (#28470)

Clause-②: yes (widening)
Metadata-protocol: none

`POST /api/v1/data/{object}/{id}/page` answers the reads a record page still made on its own after the payload arrived. Each new part is the read it replaces, asked as the same caller behind that object's own exposure gate, and each is refused on its own:

- **`related[].expand`** (request): the lookups of a related list's rows to resolve, as that list read's own `$expand`. The rows carry the referenced records the caller may read in place of their ids, so no name lookup follows the payload.
- **`discussion: true`** (request) → **`discussion`** (response): `{ comments, reactions }` — the record's comment thread (`sys_comment` where `thread_id` is `{object}:{id}`, oldest first, no page size) and those comments' `sys_comment_reaction` rows (oldest first). The reactions carry their own refusal, which leaves the comments answered.
- **`activity: { top }`** (request, 1–200) → **`activity`** (response): `{ total, records }` — the record's newest `sys_activity` rows with their count, `actor_id` expanded.
- **`attachments: { top }`** (request, 0–100) → **`attachments`** (response): `{ total, records }` — the record's newest `sys_attachment` rows with their count.

A stream part is its rows or its refusal (`RecordPageStreamRefusalSchema`), never both and never neither. The body stays strict, the query-parameter set stays empty, and a record the caller cannot read still refuses the whole request. New exports in `@objectstack/spec/api`: `RecordPageActivityRequestSchema`, `RecordPageAttachmentsRequestSchema`, `RecordPageStreamRowsSchema`, `RecordPageStreamRefusalSchema`, `RecordPageDiscussionSchema`, `RecordPageDiscussionReactionsSchema`, `RECORD_PAGE_MAX_ACTIVITY_ROWS`, `RECORD_PAGE_MAX_ATTACHMENT_ROWS`, and their types.
