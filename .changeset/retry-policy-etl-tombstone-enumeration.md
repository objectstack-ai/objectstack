---
"@objectstack/spec": patch
---

fix(spec): the `retryDelayMs` tombstone no longer points an upgrading author at the retired ETL surface (#6630)

#6414 retired the whole L2 ETL layer (`automation/etl.zod.ts`: `ETLPipeline`,
`ETLPipelineRun`, their source/destination/transformation vocabulary, four enums
and the `ETL` factory — 9 defs, 27 exported names). `shared/retry-policy.zod.ts`
was updated in exactly one stanza and left every other mention of
`ETLPipeline.retry` in the present tense — including the one string that is not
documentation.

**The author-visible half.** `retryDelayMs`'s `retiredKey()` guidance is the
upgrade channel `shared/retired-key.ts` describes in its own words ("an agent
bumping `@objectstack/spec` sees THIS string, not our docs site"). It enumerated
four surfaces on which the converged spelling applies, and the fourth — "an ETL
pipeline's `retry`" — had been deleted in the same major. An author or agent
migrating `retryDelayMs` → `backoffMs` was therefore told, by the platform's own
upgrade prescription, that a surface exists where `tsc` now reports TS2724/TS2305.
The message now names exactly the three surfaces that still carry the policy:

```
… the retry policy now has ONE spelling for its base delay across every surface
that carries it: `job.retryPolicy`, a `try_catch` node's `retry` and
`flow.errorHandling`. Rename the key to `backoffMs`; …
```

The prescription itself is unchanged — same rename, same value semantics, same
`os migrate meta --from 16` pointer — and a new pin in
`shared/retry-policy.test.ts` now asserts the enumeration in both directions
(every live surface named, no retired one named) so the string cannot drift wide
again unobserved.

**No acceptance change.** `retryPolicyShape()` and `RetryPolicySchema` keep their
exact key sets, bounds and defaults; `retryDelayMs` is still rejected, still with
a prescription. Everything else in this change is comment text: the module TSDoc
in `shared/retry-policy.zod.ts` (the four-surfaces arithmetic, the strict-surface
counts, and the paragraph that claimed a `maxAttempts` tombstone carries the ETL
migration — it does not; the tombstone went with the shape that carried it, and
`RETIRED_DEFS_BY_MAJOR` plus the D3 `etl-pipeline-layer-retired` entry are the
declaration) and the matching stanza in `conversions/registry.ts`.
