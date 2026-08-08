---
"@objectstack/plugin-reports": patch
"@objectstack/rest": patch
---

fix(reports): owner-gate the saved-report schedule routes (#2980)

The report read/run/delete routes are owner-isolated (a caller may only touch a
report they own, denied as `REPORT_NOT_FOUND` to avoid leaking that the id
exists), but the two schedule routes bypassed that gate: `unscheduleReport` and
`listSchedules` took the caller `context` as `_context` and never consulted it,
querying under the system context (RLS-bypassing). Any authenticated caller
could therefore delete another owner's report schedule — a cross-owner
destructive write — or list another owner's schedules (leaking recipient
addresses and cron), by supplying an id.

Both now resolve the schedule's parent report and require the caller to own it,
mirroring the sibling routes:

- **`unscheduleReport`** loads the schedule, then its report, and deletes only
  when `canAccessReport` holds; a cross-owner attempt throws `REPORT_NOT_FOUND`
  (mapped to `404` by the REST layer, deny-as-404 anti-enumeration), while a
  genuinely-absent schedule stays idempotent. `scheduleReport` (create) was
  already gated via `getReport`, so only the delete/list doors were open.
- **`listSchedules`** returns an empty list to any non-system caller who cannot
  access the report it is scoped to — the same non-leaking posture as
  `listReports`. The scheduler's system context still sees every schedule.

No authoring-surface or metadata change; existing owner-path behavior is
unchanged.
