---
'@objectstack/spec': minor
'@objectstack/service-job': patch
---

feat(spec)!: a job `retryPolicy` block whose `maxRetries` is omitted or 0 is refused, and `retry-policy-converged` leaves the load path

Clause-②: yes (narrowing)

**BREAKING (authoring):** `maxRetries` has defaulted to 0 since 17, so a `job.retryPolicy` block that omits it, or writes 0, buys no retry: the job runs once. Through 17 the loader hid that by writing the pre-17 `maxRetries: 3` and `backoffMultiplier: 2` into such a block with a notice. At 18 the ADR-0087 D2 conversion `retry-policy-converged` is retired from the load path (`retiredAfter: '17.7.0'`), and the job parse refuses the block at `retryPolicy.maxRetries`, at every door that parses an authored job (`defineStack`, `os validate`, `os build`, and `os lint` when the config calls it): "A retry block with no attempts is no retry block: state `maxRetries` ≥ 1, for example 3, or delete the block." The rule is the job's, the same one `flow.errorHandling` applies to `strategy: 'retry'`; the shared `RetryPolicySchema` is unchanged, so a `try_catch` node's `retry` region is judged as before.

Migration:

- `retryPolicy: {}` or `retryPolicy: { backoffMs: 5000 }` → `retryPolicy: { maxRetries: 3, backoffMs: 5000 }` (3 is the count such a block ran with before 17), or delete the block if the job should run once.
- `retryPolicy: { maxRetries: 0, … }` → delete the block: a job with no `retryPolicy` is a single attempt.

What an author who still writes it sees: `defineStack` throws `STACK_SCHEMA_INVALID` (422) with one issue at `jobs.N.retryPolicy.maxRetries` carrying the prescription above, and `os validate` prints the same issue. Nothing is rewritten silently any more.

Not refused: a block that states `maxRetries` and omits `backoffMultiplier`. It keeps the declared default of 1, a flat delay, where the loader used to write 2. State `backoffMultiplier: 2` to keep the old exponential curve.

Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand. For such a block the edit writes both pre-17 numbers (`maxRetries: 3`, `backoffMultiplier: 2`). The D3 entry `job-retry-policy-without-attempts-refused` states the decision left to you: keep the written count, or delete the block.

The flow half of the conversion (`retryDelayMs` → `backoffMs` on `flow.errorHandling` and a `try_catch` node's `retry`) needed nothing more: both surfaces already refuse `retryDelayMs` with the rename to `backoffMs`.

Stored metadata needs no edit. Stored-row rehydration, the automation engine's flow rehydration, the metadata save door's flow fallback and the artifact-ingestion door inside its window still replay the conversion, so a job row stored without a count keeps loading with the three retries it ran with.

`@objectstack/service-job`: a comment-only change in `runWithPolicy`, whose `maxRetries` default is now reached only by a caller that builds the options by hand.

<!-- adr-0087: registered job-retry-policy-without-attempts-refused -->
