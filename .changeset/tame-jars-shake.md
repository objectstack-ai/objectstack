---
'@objectstack/spec': minor
'@objectstack/platform-objects': minor
---

feat(spec,platform-objects): add `degraded` to the job status vocabulary (#7072)

`JobExecutionStatus` and the two `sys_job*` selects now carry a fifth value,
`degraded` — "the run finished, but its work did not happen". This is the
consumer-side half of the `JobRunOutcome` producer shape #6617 shipped on
`contracts/job-service.ts`, and it executes the 2026-08-08 maintainer ruling on
#5548 verbatim:

> **Vocabulary stays minimal** — one additional outcome meaning "completed
> without accomplishing the work". ⛔ Do not open an enum family; a second key
> would need its own pull.

Three declaration sites had to move together, because the two platform-object
selects are *enforced* — ObjectQL's record validator refuses an
out-of-vocabulary `select` value with `invalid_option`, and `DbJobAdapter`
swallows that rejection in a best-effort `try/catch`. A value legal in the spec
enum but absent from the selects would therefore be a silently dropped write
that leaves the run row `running` forever, not a type error:

- `packages/spec/src/system/job.zod.ts` — `JobExecutionStatus`
- `packages/platform-objects/src/audit/sys-job-run.object.ts` — `status`
- `packages/platform-objects/src/audit/sys-job.object.ts` — `last_status`

**`degraded` is not a failure and never retries.** Retry and failure are driven
exclusively by a rejected handler promise, so a resolved
`{ outcome: 'degraded' }` never re-runs the job.

A degraded run's `reason` rides the existing `error` / `last_error` columns and
leaves `failure_count` flat — the ruling's minimal-vocabulary spirit applied to
columns as to enum members. The cost is recorded in the TSDoc at the enum: a
column labelled "Error" may carry a non-error operator note whenever
`status === 'degraded'`, so readers must gate on the status first.

Additive only: no existing value changed meaning, and nothing yet produces
`degraded` — wiring `DbJobAdapter` to map the outcome is #5548, which this
unblocks. Locale bundles (en / zh-CN / ja-JP / es-ES) carry the new option.
