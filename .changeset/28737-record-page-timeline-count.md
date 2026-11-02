---
'@objectstack/spec': minor
'@objectstack/rest': minor
---

feat(rest): the record page payload serves the record's 动态 count, so the activity part asks only the panel's rows (#28737)

Clause-②: yes (widening)
Metadata-protocol: added

`POST /api/v1/data/{object}/{id}/page` counts the record's 动态 stream on the server, so a record page no longer reads 200 activity rows to name a count.

- **`timeline: { discussion, activity, fieldChanges }`** (request) → **`timeline`** (response): `{ total }` — the number of entries the record's 动态 stream holds for the caller, from the sources named: the comment thread (`sys_comment`), the activity rows the stream draws (`sys_activity` without the types in `RECORD_TIMELINE_UNDRAWN_ACTIVITY_TYPES`) and the ledger's field changes (`sys_audit_log` writes). With field changes counted, the activity's `updated` rows step aside for them, as the stream does. Each source is counted as the caller's own read, behind its object's exposure gate; a refused comment or activity read refuses the part (`RecordPageStreamRefusalSchema`), a refused ledger read counts no field change, and a source the boot does not register holds no entry.

`RECORD_PAGE_MAX_ACTIVITY_ROWS` stays 200 and `RecordPageActivityRequestSchema` keeps its bounds: the 动态 tab still asks the window it draws. New exports in `@objectstack/spec/api`: `RecordPageTimelineRequestSchema`, `RecordPageTimelineCountSchema`, `RECORD_TIMELINE_UNDRAWN_ACTIVITY_TYPES`, `RECORD_TIMELINE_UPDATE_ACTIVITY_TYPE`, and their types. The console's activity reading maps exactly those undrawn types to no entry, so the server's count and the drawn stream share one definition.
