// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module shared/retry-policy
 *
 * The **single declaration** of the exponential-backoff retry policy (#4661,
 * the #4535 C8 dual-source cluster).
 *
 * Until 17 this shape existed twice — `automation/control-flow.zod.ts` (the
 * `try_catch` node's `retry` region) and `system/job.zod.ts` (`job.retryPolicy`)
 * — under the *same exported name*, so which `RetryPolicy` a consumer got
 * depended only on whether they imported `@objectstack/spec/automation` or
 * `@objectstack/spec/system` (the #4411 trap). They were not two concepts:
 * both drive `delay = base * multiplier^(retry-1)`, and both executors
 * implemented that identical formula. What differed was the *spelling* of the
 * base delay (`retryDelayMs` vs `backoffMs`), two keys only one side had
 * (`maxRetryDelayMs` / `jitter`), and the defaults.
 *
 * ## Why this file, and why it is not in `shared/index.ts`
 *
 * The published JSON-Schema def key is `<entry namespace>/<Name>`, derived from
 * which entry barrel re-exports the const (`scripts/build-schemas.ts` iterates
 * the namespace objects). Keeping ONE declaration re-exported from both
 * `./automation` and `./system` therefore preserves *both* def keys
 * (`automation/RetryPolicy` and `system/RetryPolicy`) with an identical key set
 * — which is exactly what makes this convergence cost a single authorable key
 * instead of eight.
 *
 * It is deliberately NOT added to `shared/index.ts`: exporting it from a third
 * entry would publish a third `shared/RetryPolicy` def and add five more rows to
 * `authorable-surface.json` for a def no author ever writes directly (#4535 §1
 * already flags that file for over-collecting). Same reason `retired-key.ts`,
 * `strict-object.ts` and `connector-auth.zod.ts` sit here without a barrel line.
 *
 * The home is `shared/` rather than either domain because the two owning
 * schemas must not depend on each other: `automation/control-flow.zod.ts`
 * imports the whole `flow.zod` node/edge graph, and pulling that into
 * `system/job.zod.ts` to reach a five-field policy would be a real edge in the
 * package graph for no runtime need. This module depends on nothing but `zod`
 * and `lazySchema`.
 */

import { z } from 'zod';
import { lazySchema } from './lazy-schema';
import { retiredKey } from './retired-key';

/**
 * Exponential-backoff retry policy — the one shape for both `job.retryPolicy`
 * and a `try_catch` node's `retry` region.
 *
 * Delay before retry *n* is `min(backoffMs * backoffMultiplier^(n-1),
 * maxRetryDelayMs)`, optionally jittered.
 *
 * ## Defaults are opt-in, not opt-out (17.0.0, #4661)
 *
 * `maxRetries` defaults to **0** — declaring a retry block does not by itself
 * buy retries. The pre-17 `job.retryPolicy` defaulted to 3, so a job that wrote
 * `{ backoffMs: 5000 }` and nothing else silently got three attempts; the
 * `retry-policy-converged` conversion writes that `3` (and the old
 * `backoffMultiplier: 2`) into existing job documents, so no deployed stack
 * changes behaviour. What changes is what a NEWLY authored omission means.
 *
 * The reason to make absence mean "no retry" rather than "retry three times":
 * a retry replays whatever the attempt already did — a job handler's writes and
 * callouts, a `try` region's side effects. An implicit retry is the failure mode
 * that is hardest to catch in tests and most expensive in production, and
 * metadata written by an LLM is exactly where an unstated key hides. The same
 * reading is already recorded for flow-level retry in the protocol-17 migration
 * step (`flow-retry-max-retries-required`, #4247): an unstated count is
 * unambiguously 0, and "retry zero times" is a decision the author must state.
 */
export const RetryPolicySchema = lazySchema(() => z.object({
  maxRetries: z.number().int().min(0).max(10).default(0)
    .describe('Retry attempts after the initial one. 0 (the default) means no retry — state a count to opt in.'),
  backoffMs: z.number().int().min(0).default(1000)
    .describe('Base delay before the first retry (ms); subsequent delays multiply by backoffMultiplier'),
  backoffMultiplier: z.number().min(1).default(1)
    .describe('Exponential backoff multiplier; 1 (the default) keeps the delay flat'),
  maxRetryDelayMs: z.number().int().min(0).default(30000)
    .describe('Ceiling for a single backoff delay (ms)'),
  jitter: z.boolean().default(false)
    .describe('Randomize each delay within [50%, 100%] of its computed value — spreads a thundering herd of simultaneous retries'),

  // ── Tombstone (ADR-0087) ────────────────────────────────────────────
  // `retryDelayMs` was the automation-side spelling of `backoffMs`. It is the
  // ONE authorable key this convergence costs, and it is tombstoned rather than
  // deleted because neither owning shape is `.strict()`: a plain deletion would
  // have Zod silently strip the authored value and drop the delay back to the
  // 1000ms default, which is precisely the quiet-failure class ADR-0049 exists
  // to remove. `retry-policy-converged` rewrites the key.
  retryDelayMs: retiredKey(
    '`retryDelayMs` was removed in @objectstack/spec 17.0.0 (#4661) — the retry policy now ' +
    'has one spelling for its base delay across `job.retryPolicy` and a `try_catch` node\'s ' +
    '`retry`. Rename the key to `backoffMs`; the value (milliseconds before the first retry) ' +
    'is unchanged. `os migrate meta --from 16` rewrites it for you.',
  ),
}));

/**
 * What an author writes — every key optional, defaults unapplied.
 *
 * Note for pre-17 `@objectstack/spec/system` consumers: this used to be
 * `z.infer` (the post-parse shape, every key present) on that entry only. It is
 * now the input shape on both, matching the house `X` / `XParsed` convention
 * used by the sibling control-flow configs.
 */
export type RetryPolicy = z.input<typeof RetryPolicySchema>;

/** The post-parse shape — every key present, defaults applied. */
export type RetryPolicyParsed = z.infer<typeof RetryPolicySchema>;
