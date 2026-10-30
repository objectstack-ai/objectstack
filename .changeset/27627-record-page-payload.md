---
'@objectstack/spec': minor
'@objectstack/rest': minor
'@objectstack/client': minor
---

feat(rest): `POST /api/v1/data/{object}/{id}/page` answers everything a record page asks when it opens, in one request (#27627)

Clause-②: yes (widening: a new route and its request and response shapes; no existing route, key or answer changes)
Metadata-protocol: added

A record page used to open in two or three stages of requests: the record, the approval list, the access verdicts and each related list's definition first, then the approval lock and one count probe per related list. The new route answers all of it from one request:

- **The request names the parts** (`RecordPageRequestSchema`, `@objectstack/spec/api`): `expand` (the record's lookups to resolve), `related` (each related list the page draws: the child object, its relationship field to this record, an optional declared `filter`, `top` first rows, an optional `sort`), `explain` (`update` / `delete` / `transfer`), `fieldAccess` and `approvals`. The body is strict and the query-parameter set is closed and empty.
- **Every part is the read it replaces, as the same caller** (`RecordPageResponseSchema`): the record is `GET /data/{object}/{id}`; a related list is `GET /data/{child}` with the parent condition AND the declared filter, and `$count`; `fieldAccess` is `GET /data/{object}/{id}/field-access`; a verdict is `POST /security/explain` with the record id; `approvals` is `GET /approvals/requests` for the record (the pending row enriched as `GET /approvals/requests/{id}`) and the record lock. Object permissions, row-level security, sharing and field-level security therefore apply exactly as they apply to those reads.
- **A refusal stays where it belongs.** A record the caller cannot read refuses the whole request with the record read's own answer. A part whose read refuses carries that refusal (`{ code, status, message }`) in place of its answer, and the other parts are answered; a related list the caller may not read carries neither a count nor rows.
- **A related entry must be a relationship to this record**: a lookup or master-detail field of the child that references the page's object, or the request is a located `400` before anything is read.
- **Server-Timing**: the route's metadata reads are timed as a `meta` span beside `db` and `total`, under the existing gate (`OS_SERVER_TIMING=true`, or `X-OS-Debug-Timing: 1` from an admin).
- `@objectstack/client` gains `data.recordPage(object, id, request)`.
