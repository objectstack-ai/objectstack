---
"@objectstack/spec": major
"@objectstack/service-automation": major
---

**The retry policy's last two dialects converge** (#4964 `flow.errorHandling`, #4962
`ETLPipeline.retry`).

#4661 converged the retry policy onto one declaration. It converged the two shapes that
published the **same exported name** (`RetryPolicy` from `./automation` and `./system` —
the #4411 trap), because that is the question the dual-source instrument asks. Two more
encodings of the identical concept were outside its vision *by construction*: both are
anonymous inline `z.object`s nested in a bigger schema, with no exported name to collide.

The cost of the gap fell on the author who did the right thing. `shared/retry-policy.zod.ts`
tombstoned `retryDelayMs` and told them to write `backoffMs` — and `flow.errorHandling`
then **rejected** `backoffMs` and demanded `retryDelayMs`. Reading the newer file was
punished, and which file an AI author reads first is arbitrary.

All four surfaces — `job.retryPolicy`, a `try_catch` node's `retry`, `flow.errorHandling`
and an ETL pipeline's `retry` — now build from one shared shape.

## FROM → TO

### `flow.errorHandling` (#4964)

| | FROM | TO |
|---|---|---|
| base delay | `retryDelayMs`, min 0, default 1000 | **`backoffMs`**, min 0, default 1000 |
| `maxRetries` / `backoffMultiplier` / `maxRetryDelayMs` / `jitter` | *(already identical)* | unchanged |
| `strategy` | `'fail' \| 'retry' \| 'continue'` | unchanged — it selects *whether* the policy runs, so it stays outside it |

One key, one word, no default changes. Every other key, bound and default already
matched the converged policy, which is exactly why the divergence survived a release:
it looked reviewed.

### `ETLPipeline.retry` (#4962)

| | FROM | TO |
|---|---|---|
| count | `maxAttempts`, min 0, **default 3**, unbounded | **`maxRetries`**, 0–**10**, **default 0** |
| base delay | `backoffMs`, default **60000** | `backoffMs`, default **1000** |
| `backoffMultiplier` | *(absent)* | ≥1, default 1 |
| `maxRetryDelayMs` | *(absent)* | default 30000 |
| `jitter` | *(absent)* | default false |

## What you must change

**1. Rename `retryDelayMs` → `backoffMs`** in any `flow.errorHandling` block. The value
(milliseconds before the first retry) is unchanged. The old spelling is **tombstoned**,
not deleted, so it rejects with the rename rather than being silently stripped, and
`os migrate meta --from 16` (the `retry-policy-converged` conversion, now with a
flow-level branch) rewrites it for you.

**2. Rename `maxAttempts` → `maxRetries`** in any `ETLPipeline.retry` block. **The number
does not change** — both counted the retries *after* the initial attempt. Do **not**
subtract one: that adjustment belongs to `integration/connector.zod.ts`'s
identically-spelled `RetryConfig.maxAttempts`, which *includes* the first attempt and is
deliberately **not** part of this convergence.

**3. If an ETL pipeline relied on the implicit retry count, write it out.** `retry: {}`
used to mean three re-runs 60s apart; it now means **none**. State `maxRetries: 3` (and
`backoffMs: 60000` for the old delay) to keep the old behaviour.

## Why the ETL default flips to 0

Not merely to follow #4661. An ETL destination is a foreign system *by definition* — a
warehouse, an API, someone else's database. A silent retry against a non-idempotent
destination is a **duplicate write**: a second invoice, a second export, a second
webhook. Default 0 makes retrying something an author states, and thereby claims
idempotency for. An unstated key is precisely where LLM-authored metadata hides this.

## Migration surface

**`flow.errorHandling`** is live: `service-automation`'s `retryExecution` reads the key
(it now destructures `backoffMs`), and the D2 conversion covers stored and authored
flows, so no deployed stack changes behaviour.

**`ETLPipeline.retry` has an empty migration surface today, and that is why now was the
moment.** `etl.zod.ts` has no parse site in objectstack / objectui / cloud (批 12's
measurement) and an ETL pipeline is not a `defineStack` collection, so there is no stored
document a conversion could walk — it deliberately gets a tombstone and **no** D2 step,
rather than a walker advertising coverage that does not exist. Once an ETL engine lands,
flipping this default stops being a schema edit and becomes a behaviour change to every
deployed pipeline.

## Also

The two automation retry surfaces now carry the **same** curated unknown-key table, so an
author learns one lesson instead of two, and `retry-policy.test.ts` gains a
concept-level guard: all four surfaces are asserted to expose the same key set and the
same defaults, by parse rather than by inspecting how each obtains them. Adding a fifth
retry surface without wiring it to the shared shape now fails a test — which is the check
that would have caught both of these issues, and the one the name-based scan could never be.
