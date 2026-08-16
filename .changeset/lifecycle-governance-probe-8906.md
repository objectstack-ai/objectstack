---
'@objectstack/objectql': patch
---

lifecycle: a failed governance row-count probe is no longer indistinguishable from a quiet object

`LifecycleService.checkGovernance()` probed each declared object's row count and swallowed
every failure with a bare `catch { continue }`. A driver outage therefore read exactly like
an object with nothing to alert on: no `quota-exceeded`, no `growth`, nothing logged, and
nothing in the sweep report — and because the failed object also dropped out of the count
map that becomes the next sweep's baseline, the next sweep could not alert on growth for it
either.

The probe now discriminates by error type through the shared `isMissingTableError`
predicate. An unprovisioned table is truthful emptiness and stays silent; every other
failure is reported per object in the sweep report's existing `errors` list and logged at
`warn`, both naming the lost growth baseline. No new report field, no new error code, and
the sweep is still isolated — one object's failed probe never costs the others their
governance.
