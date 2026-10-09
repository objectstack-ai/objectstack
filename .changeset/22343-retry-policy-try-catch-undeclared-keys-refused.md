---
'@objectstack/spec': minor
---

The shared retry policy refuses a key it does not declare, and the build doors now judge a `try_catch` node's config keys like every other builtin's: a `retry.maxRetry` slip under a `try_catch` node, or on a job's `retryPolicy`, no longer passes `objectstack validate` and `objectstack compile` to be dropped or refused later.

Clause-②: no (narrowing: an undeclared key on the shared retry policy is refused at parse wherever it is written, a job's retryPolicy and a try_catch node's retry, and an undeclared try_catch config key at the build doors and the save door, where each passed)

<!-- adr-0087: registered try-catch-and-retry-policy-undeclared-keys-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** `RetryPolicySchema` — the one declaration behind `job.retryPolicy` and a `try_catch` node's `retry` — was a plain object schema, so it dropped a key it did not declare. Its defaults are opt-in (`maxRetries: 0`, `backoffMultiplier: 1`), so a dropped key fell back to "no retry" or to a flat delay: a job with `retryPolicy: { maxRetry: 3 }` parsed, deployed and never retried, and nothing said so. On a `try_catch` node the same strip kept the flow parse from judging the node's keys at all: its node type descriptor closes `retry` to five keys, so only `registerFlow`'s descriptor walk refused such a key, after `objectstack validate` and `objectstack compile` had passed it.

**What is refused.**

- **A key the retry policy does not declare**, on a job's `retryPolicy` or under a `try_catch` node's `retry`. The policy declares `maxRetries`, `backoffMs`, `backoffMultiplier`, `maxRetryDelayMs` and `jitter`. The refusal names the key and, for a near miss or a spelling borrowed from a neighbouring retry vocabulary, the declared key to write (`maxRetry` → `maxRetries`, `maxDelayMs` → `maxRetryDelayMs`, `baseDelayMs` or `initialDelayMs` → `backoffMs`, `retries` → `maxRetries`). A `maxAttempts` is answered with the off-by-one it carries: write `maxRetries` one lower. On a job it is the issue `unrecognized_keys` at `jobs.N.retryPolicy` (`defineStack` → `STACK_SCHEMA_INVALID`, 422; an artifact carrying it is refused whole at load).
- **A key a `try_catch` node's executor contract does not declare** — beside `try`, `catch`, `errorVariable` and `retry`, or under `retry` — at every door that parses a flow: `FlowSchema`, `defineFlow()`, `defineStack`, `objectstack validate`, `objectstack compile`, an artifact's parse, the metadata save door and `registerFlow`. It is the existing closed-set code `node-config-refused-by-contract`, `params: { nodeType: 'try_catch', key }`, anchored at the key (`nodes.N.config.retry.maxRetry`), in the contract's words and closed with the rename-or-remove remedy, from the same judge (`flowNodeConfigRefusals`) that already refused an undeclared key on every other builtin. `builtinNodeConfigKeysJudged('try_catch')` now answers `true`.
- **A `retryDelayMs` the load-path conversion leaves behind** under a `try_catch` node's `retry`: the conversion renames the pre-17 spelling to `backoffMs`, but keeps it when a `backoffMs` beside it holds a different value, and leaves a `null`. That copy is refused at `nodes.N.config.retry.retryDelayMs` in the tombstone's own words (rename it to `backoffMs`). Registration refused both before, as undeclared keys.

**What stays as it was.**

- Registration refuses exactly what it refused before. The descriptor walk (`validateNodeConfigKeys` in `@objectstack/service-automation`) stands aside for `try_catch` and now judges plugin node types only. A `try_catch` flow that carried such a key was already refused there, so a running flow changes nothing; the refusal now arrives as the parse's located issue instead of the walk's `Flow '…' rejected: N undeclared config key(s)` text.
- A key on a `try_catch` region object (`try`, `catch`), or on a region's nodes and edges: the region check's, at registration, as before.
- A pre-17 `retryDelayMs` alone: still renamed to `backoffMs` before the judge at every door that converts first (`defineStack`, `os validate`, `os compile`, `registerFlow`, the save door). Met by a direct `FlowSchema.parse` or `defineFlow()`, it meets its tombstone, like every other retired spelling.
- `Flow.errorHandling`, which carries the same policy keys, was already closed; a `script` node's retired keys keep the scope they had.

**Also corrected:** `Flow.errorHandling`'s refusal of a `maxAttempts` key said a bare rename to `maxRetries` would run one attempt fewer than asked for; it runs one more (`maxAttempts: 3` is 3 runs, `maxRetries: 3` is 4), and the message now says so — the prescription, `maxRetries` one lower, is unchanged.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `maxRetry`, `retries` or `attempts` | `maxRetries` |
| `maxAttempts: n` (counts the first attempt) | `maxRetries: n - 1` |
| `baseDelayMs` or `initialDelayMs` | `backoffMs` |
| `maxDelayMs` | `maxRetryDelayMs` |
| `retryDelayMs` beside a `backoffMs` | delete it, keeping the `backoffMs` you meant |
| a key nothing reads | delete it |

**The one-line fix: rename or delete the key the refusal names.**

**Who is affected, measured.** Before closing the policy, every writer of either parser was read: in this repository the showcase job and flows, the `app-todo` flows, the docs, the service READMEs, the test fixtures and the load-path conversion's output; in the pinned objectui the job preview sample and the flow designer, whose descriptor form closes `retry` to the same five keys. All of them write only declared keys, and `objectstack validate` over the showcase and `app-todo` examples stays clean. `service-job`'s `runWithPolicy` reads an already-parsed policy and parses nothing. hotcrm, deployed metadata and other repositories were not measured.

### The kit

- **The refusal.** `RetryPolicySchema` (`shared/retry-policy.zod.ts`) is a `strictObject` with a curated near-miss table; the key arm of `flowNodeConfigRefusals` in `automation/flow-node-config-refusals.ts` judges every builtin in the executor contract map, and refuses a tombstoned key the author wrote on every judged type but `script`. No new code joins `FLOW_SLOT_REFUSAL_CODES`.
- **The ledger.** The D3 semantic entry `try-catch-and-retry-policy-undeclared-keys-refused` (protocol 18). No key is removed, so there is no new tombstone, and there is no D2 conversion: the platform cannot know what an undeclared key was meant to be.
