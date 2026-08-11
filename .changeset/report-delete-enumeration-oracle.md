---
"@objectstack/rest": patch
---

fix(rest): `DELETE /api/v1/reports/:id` stops telling a caller whether a report id exists

`DELETE /api/v1/reports/:id` answered differently depending on whether the target
id **existed**, which let any authenticated caller enumerate other users' saved
reports by probing ids and reading the status code:

| Target | Before | After |
| --- | --- | --- |
| Another owner's report id | `500 REPORT_DELETE_FAILED` | `404 REPORT_NOT_FOUND` |
| An id that does not exist | `204 No Content` | `404 REPORT_NOT_FOUND` |
| Your own report | `204 No Content` | `204 No Content` (unchanged) |

The service layer was never wrong. `deleteReport()` returns early for an unknown
id and throws `REPORT_NOT_FOUND` for a report the caller does not own — with the
intent written down in the source: *"others get a not-found so the delete neither
fires nor reveals the report's existence"*. **The route discarded it.** Its catch
went straight to `res.status(500)` and never reached the file-local
`handleValidation`, which maps `REPORT_NOT_FOUND*` to 404 — the sibling
`DELETE /reports/schedules/:scheduleId` in the same file does call it, which is
why that route was already correct.

Rewiring that catch is necessary but **not sufficient**: it maps the cross-owner
arm to 404 while an unknown id still answers 204, which is the same oracle in a
quieter costume — 404-vs-204 discriminates on existence exactly as well as
500-vs-204 did. So the two deny arms are now answered by **one** response, before
the delete fires, using the call this surface already keeps blind to the
difference: `getReport()` returns null for an unknown id and for another owner's
id alike (#2980). That response is emitted by `handleValidation` from a
synthesised `REPORT_NOT_FOUND` — the same code path the thrown arm takes — so the
status and the body cannot drift apart. Both arms also now do identical work (one
visibility read, no delete, no `logError`), where the cross-owner arm previously
threw and logged and the unknown one did neither.

**Behaviour change for existing clients.** Deleting a report you own still answers
`204`, and the SDK's `reports.delete()` is unaffected on that path. What changes
is deleting an id you *cannot see*: previously a silent, idempotent `204`, now a
`404 REPORT_NOT_FOUND` — so a client that re-issues a delete for a report already
deleted (or never present) now sees an error where it saw success. That is the
cost of closing the oracle, and it puts delete in line with the rest of the
surface: cross-owner `GET`, `run`, upsert-overwrite and unschedule all already
answer 404 for the same input.
