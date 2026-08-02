---
"@objectstack/spec": major
---

**Retry policy converges onto one declaration** (#4661 — the #4535 C8 dual-source cluster).

`@objectstack/spec/automation` and `@objectstack/spec/system` both exported
`RetryPolicySchema` / `RetryPolicy`, resolving to **different declarations** — so the
shape you got depended only on which entry you imported (the #4411 trap). They were
never two concepts: the `try_catch` node's `retry` region and `job.retryPolicy` both
compute `delay = base * multiplier^(retry-1)`, and both executors implemented that
identical formula. There is now one declaration, re-exported by both entries, carrying
the union of what the two sides could express.

## FROM → TO

| | FROM `./automation` | FROM `./system` | TO (both entries) |
|---|---|---|---|
| base delay | `retryDelayMs`, min 0, default 1000 | `backoffMs`, positive, default 1000 | **`backoffMs`**, min 0, default 1000 |
| `maxRetries` | 0–10, default **0** | ≥0 unbounded, default **3** | 0–**10**, default **0** |
| `backoffMultiplier` | ≥**1**, default **1** | positive, default **2** | ≥**1**, default **1** |
| `maxRetryDelayMs` | default 30000 | *(absent)* | default 30000 |
| `jitter` | default false | *(absent)* | default false |
| `RetryPolicy` type | `z.input` | `z.infer` | `z.input` (+ new `RetryPolicyParsed` for `z.infer`) |

## What you must change

**1. Rename `retryDelayMs` → `backoffMs`** in any `try_catch` node's `retry` block.
The value (milliseconds before the first retry) is unchanged. The old spelling is
**tombstoned**, not deleted — it rejects with the rename prescription instead of being
silently swallowed, because neither owning schema is `.strict()`. Automated:

```
os migrate meta --from 16
```

**2. Nothing for existing jobs — but read this if you author new ones.** `maxRetries`
now defaults to **0** and `backoffMultiplier` to **1**, where `job.retryPolicy`
previously defaulted to 3 and 2. Left alone that would silently stop deployed jobs from
retrying, so the `retry-policy-converged` conversion **writes the pre-17 numbers
explicitly into every existing `job.retryPolicy`** that omitted them:

```jsonc
// before                          // after `os migrate meta`
{ "backoffMs": 5000 }              { "backoffMs": 5000, "maxRetries": 3, "backoffMultiplier": 2 }
```

Deployed stacks therefore keep their exact behaviour. What changes is what a **newly
authored** omission means: declaring a retry block without `maxRetries` now means *no
retry*. Retry is opt-in because a retry replays whatever the attempt already did — a job
handler's writes and callouts, a `try` region's side effects — and an implicit replay is
the failure mode hardest to catch in tests and most expensive in production. (The same
reading is already recorded for flow-level retry in `flow-retry-max-retries-required`,
#4247.)

> This defaults change is the part **no gate can see**: the authorable-surface ratchet
> compares key sets, and a default is not a key. It is called out here because a
> changeset is the only channel that carries it.

**3. Two bounds now apply to jobs that did not have them** — `maxRetries` is capped at
**10** and `backoffMultiplier` floored at **1**. Both fail loudly at parse time rather
than being silently reinterpreted; neither has a lossless rewrite, so they are recorded
as the `job-retry-policy-constraints-tightened` semantic migration note. A multiplier
below 1 described a delay that *shrinks* on each attempt — retrying a failing dependency
ever faster, the opposite of backoff.

**4. `import type { RetryPolicy } from '@objectstack/spec/system'` is now the input
shape** (every key optional) rather than the post-parse shape. Use the new
`RetryPolicyParsed` where you need defaults applied.

## Not related to `mapping.errorPolicy` (#4509 / #4664, same release)

17.0.0 also retires `mapping.errorPolicy`, whose values included `'retry'`. That is a
different thing on a different type: an inert enum on the stored **mapping**, whose
prescription is "error handling on the import path belongs to the import REQUEST's own
options". It does **not** migrate to a `retryPolicy` block, and nothing in this change
affects it.

## What you gain

`job.retryPolicy` accepts **`maxRetryDelayMs`** (ceiling on a single backoff delay) and
**`jitter`** (randomize each delay into [50%, 100%]). Both are enforced by
`runWithPolicy`, not merely declared — jitter is what stops a fleet of jobs that failed
on one outage from retrying in lockstep.
