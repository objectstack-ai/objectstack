---
"@objectstack/service-job": patch
---

fix(services): `DbJobAdapter.replay()` honours `recordRuns` — an operator who switched run history off stops accumulating replay rows (#9633)

`recordRuns` is the on/off switch for `sys_job_run` history, and it had exactly
two `startRun` call sites. The gate landed on one of them: `wrap()`'s
per-attempt row was gated, `replay()`'s synthetic row was not. So a deployment
that set `recordRuns: false` wrote nothing for any scheduled or triggered
execution and **one complete row for every replay** — a table the operator
believes is switched off, filling slowly and exclusively with `trigger: 'replay'`
rows, the least representative sample of a job's history and one with no
non-replay rows beside it for context.

The carve-out was never designed. `replay()`'s synthetic row exists to force the
`trigger: 'replay'` tag that `IJobService.trigger` cannot carry back; the flag
simply arrived later and landed on one of the two writers. It is closed rather
than documented: one flag, one meaning, no second de-facto rule at a call site.
If an operator-initiated replay needs to be auditable when routine history is
off, the principled home for that is `sys_audit_log` — which has its own opt-in,
writer and retention — not an exception to a history switch.

**Behaviour change, user-visible:** with `recordRuns: false`, `replay()` now
writes no `sys_job_run` row. The handler still executes, and `sys_job`'s own
`last_run_at` / `last_status` / `run_count` / `failure_count` counters still
update — the flag has never gated those. With the default (`true`) nothing
changes: the synthetic row is still written, still tagged `trigger: 'replay'`,
and still carries the terminal status read off the inner execution.

All three of `replay()`'s arms are gated, not just the insert — the terminal
status arm, the success arm and the catch arm — so the flag cannot leave a
dangling `running` half-row with no `completed_at`, which would be worse than
either original behaviour.
