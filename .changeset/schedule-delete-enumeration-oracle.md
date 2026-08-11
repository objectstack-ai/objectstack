---
"@objectstack/plugin-reports": patch
"@objectstack/spec": patch
"@objectstack/rest": patch
---

fix(plugin-reports): `DELETE /api/v1/reports/schedules/:scheduleId` stops telling a caller whether a schedule id exists

`DELETE /api/v1/reports/schedules/:scheduleId` answered differently depending on
whether the target id **existed**, which let any authenticated caller enumerate
other owners' report schedules by probing ids and reading the status code:

| Target | Before | After |
| --- | --- | --- |
| Another owner's schedule id | `404 REPORT_NOT_FOUND` | `404 REPORT_NOT_FOUND` (unchanged) |
| A schedule id that does not exist | `204 No Content` | `404 REPORT_NOT_FOUND` |
| A schedule whose report row is gone | `404 REPORT_NOT_FOUND` | `404 REPORT_NOT_FOUND` (unchanged) |
| Your own schedule | `204 No Content` | `204 No Content` (unchanged) |

This is the same defect #7523 closed on the sibling `DELETE /reports/:id`, in the
costume that card explicitly warned about: there the split was 500-vs-204 and
loud, here it was 404-vs-204 and read as correct. The route was in fact cited by
#7523's investigation as the example of the *right* shape, because it does route
its catch through `handleValidation` — which is why the cross-owner arm is a
clean 404 rather than a 500. Only the cross-owner arm was ever probed (QA run
#7515); the unknown-id arm was not, so the surviving half went unseen and
`packages/rest/src/rest.test.ts` pinned its `204` green.

`ReportService.unscheduleReport()` carried the intent — *"others get a not-found
so the delete neither fires nor reveals the schedule's existence"* — and a hole
one line wide above it: `if (!schedule) return; // idempotent`. Idempotence is
only harmless where every caller may see the row; with a cross-owner arm that
throws, resolving quietly *is* the tell.

Both deny arms are now one decision, taken before the delete fires, by the
predicate already blind to the difference between them: `canAccessReport` is
false for a schedule that does not exist, for one whose report is gone, and for
one owned by somebody else alike. A single throw site means a single message, so
the route's single `handleValidation` call emits a single response — status and
body cannot drift apart.

Unlike `deleteReport`, this could not be pre-empted in the route. That one
collapses its arms with `getReport()`, which is already blind to the same
difference (#2980); the caller here presents a `scheduleId`, and `IReportService`
exposes no by-id schedule read to be blind with (`listSchedules` is keyed by
`reportId`). The blinding therefore lives in the service, and
`IReportService.unscheduleReport` now states it as a contract obligation rather
than leaving each implementation to rediscover it.

Deleting a schedule you own still answers `204`. Deleting one you cannot see is
now `404` instead of a silent `204` — the cost of closing the oracle, and in line
with the cross-owner GET / run / upsert-overwrite / delete arms, which all
already answer 404. A system/dispatcher context deleting an id with no row now
gets `REPORT_NOT_FOUND` too, where it previously resolved; no caller in the repo
relies on that (the route is the only production caller).

Tests assert the two deny arms' responses are **EQUAL** rather than pinning each
arm's status separately, so the plausible half-fix cannot pass through them — a
mutation that answers both arms 404 with different bodies leaves every per-arm
status assertion green and turns the equality assertions red.
