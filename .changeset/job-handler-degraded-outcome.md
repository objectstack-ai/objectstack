---
"@objectstack/spec": minor
---

feat(spec): give `JobHandler` an optional "ran, but the work did not happen" report (#6617)

`JobHandler` had exactly two states — it threw, or it did not — so a run that
completed without accomplishing anything was recorded as `success`,
indistinguishable from one that did the work. The motivating case is #5529's
wait-wake handler: when its store is unavailable it fires the shot at nothing,
returns normally, and `sys_job_run` says the wake succeeded.

This is the **spec half** of the maintainer's B-minimal ruling on #5548. The
handler's return type widens:

```ts
export interface JobRunOutcome {
  outcome: 'completed' | 'degraded';
  reason?: string;
}

export type JobHandler =
  (context: { jobId: string; data?: unknown }) => Promise<void | JobRunOutcome>;
```

**`degraded` is not a failure and does not trigger a retry.** Failure and retry
remain driven exclusively by a rejected promise (`runWithPolicy` retries on
throw), so a resolved outcome — whatever it says — never re-runs the job and
never surfaces as an error. A handler that wants a retry must still throw. That
separation is the point of the ruling: making these handlers throw instead was
rejected precisely because it would change failure semantics that third-party
`IJobService` implementations already build retry behaviour on.

**Nothing to migrate — this is additive on both sides.**

- Existing `Promise< void >` handlers are unchanged, byte for byte. Reporting
  nothing means exactly what it means today: no throw implies success.
- Existing `IJobService` implementations are unchanged. This widens a *return*
  type rather than adding a member to the handler context, so no implementation
  has to grow anything; an adapter that ignores the resolved value keeps its
  current behaviour. (A `ctx.reportOutcome` callback would have forced every
  third-party implementation to construct a new context member — which is why
  the return-value shape was chosen.)

Consuming the report — mapping `degraded` onto a `sys_job_run.status` distinct
from `success` — is the services half, tracked in #5548, and is deliberately not
wired here: the shipped adapters currently discard the resolved value, which is
what makes landing the contract first safe.
