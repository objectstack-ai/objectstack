---
"@objectstack/service-job": patch
---

fix(service-job): `runWithPolicy` and the DB job adapter read `JobScheduleOptions.timeoutMs` (#14478)

The per-attempt time limit is read from `options.timeoutMs`, following the
`@objectstack/spec` rename of both the authored `job.timeoutMs` and the
`JobScheduleOptions` contract key that carries it. Same value, same per-attempt
race, same `JobTimeoutError`; `withoutPolicy` strips the renamed key so the
timer adapter downstream never runs a second budget.
