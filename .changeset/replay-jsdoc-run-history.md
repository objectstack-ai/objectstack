---
"@objectstack/spec": patch
---

fix(spec): `IJobService` JSDoc stops calling `sys_job_run` "the audit trail" — it's job run history (#9673)

`packages/spec/src/contracts/job-service.ts` called the storage `replay()` and
`JobRunOutcome.reason` write to "the execution audit trail" / "the audit
trail" in three spots. The binding #9633 ruling: `sys_job_run` is **job run
history**, not the audit trail — `sys_audit_log` is the audit surface, with
its own opt-in, writer and retention. Published `.d.ts` tooltip text pointing
readers at the wrong subsystem was exactly the conflation that ruling
rejected.

Wording only — `reason?`, `replay?()` and their runtime behavior are
unchanged. `replay`'s JSDoc also gains the caveat #9673 suggested: recording
anything durable depends on an adapter that persists run history at all
(e.g. `DbJobAdapter`'s `recordRuns` option), since #9633 made that
conditional where the prose previously read as unconditional.
