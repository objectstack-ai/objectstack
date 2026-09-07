---
"@objectstack/runtime": patch
---

fix(runtime): `AppPlugin` threads the authored `job.timeoutMs` to the scheduler as `timeoutMs` (#14478)

The declarative job door passes `{ retryPolicy, timeoutMs }` to
`IJobService.schedule`, following the `@objectstack/spec` rename of the
authored key and of the `JobScheduleOptions` contract key that carries it. Same
value, same per-attempt limit.
