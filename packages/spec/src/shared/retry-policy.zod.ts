// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module shared/retry-policy
 *
 * The **single declaration** of the exponential-backoff retry policy (#4661,
 * the #4535 C8 dual-source cluster; completed for the anonymous inline blocks
 * by #4964 / #4962).
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
 * ## Why it existed FOUR times, and what the first convergence could not see
 *
 * #4661 was driven by the dual-source instrument (#4411 / #4535 C8), whose
 * question is "how many declarations publish the same exported NAME?". Two more
 * encodings of this identical concept were invisible to it **by construction**,
 * because neither has an exported name at all — both are anonymous inline
 * `z.object`s nested inside a bigger schema:
 *
 * - `automation/flow.zod.ts` → `Flow.errorHandling` (#4964) — spelled the base
 *   delay `retryDelayMs`, every other key already identical.
 * - `automation/etl.zod.ts` → `ETLPipeline.retry` (#4962; the whole L2 layer
 *   was retired at #6414, so this surface no longer exists — the convergence
 *   is recorded because it is how the divergence was FOUND) — spelled the count
 *   `maxAttempts`, defaulted it to **3** (the opposite of the opt-in reading
 *   below), and declared no `backoffMultiplier` / `maxRetryDelayMs` / `jitter`
 *   at all, so its backoff was flat, uncapped and unjittered.
 *
 * That is the campaign's "instrument misreports coverage" class, in its purest
 * form: the instrument was not broken and answered its own question exactly —
 * the question simply was not the one whose answer everybody read off it. After
 * a convergence completes, a surviving dialect reads as *reviewed and kept*.
 *
 * The surviving one of those two builds from {@link retryPolicyShape} like the
 * named surfaces do, so the three remaining surfaces share one declaration of
 * the key set, the bounds and the defaults. The only one of them that is
 * `.strict()` — `Flow.errorHandling` — keeps its own `strictObject` curation and
 * its own extra keys (`strategy`); what is shared is the *contract*, not the
 * surface's framing of it.
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
 * The retry policy's raw Zod shape — key set, bounds, defaults and prose, in
 * ONE place.
 *
 * One of the three surfaces that carry this policy cannot simply reference
 * {@link RetryPolicySchema}: `Flow.errorHandling` is `.strict()`
 * (`strictObject`, the #4001 campaign standard) and also carries `strategy` plus
 * its own `superRefine`. (`ETLPipeline.retry` was the second such surface until
 * #6414 retired the whole L2 ETL layer.) Handing it the *shape* rather than the
 * *schema* is what lets it stay strict, keep its curated unknown-key table, and
 * still have exactly one declaration of what a retry policy IS — the
 * alternative, one hand-copied key list per strict surface, is the debt #4964
 * and #4962 exist to remove.
 *
 * It is a function rather than a const for the same reason every schema here is
 * wrapped in `lazySchema`: a module-level shape would allocate its five Zod
 * nodes at import time for every consumer, including the ones that never parse
 * a retry policy.
 *
 * NOT re-exported by any barrel — see the module note above. It is an
 * intra-package construction detail, not authorable surface.
 */
export function retryPolicyShape() {
  return {
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
    // `retryDelayMs` was the automation-side spelling of `backoffMs`, on BOTH
    // `try_catch`'s `retry` (#4661) and `Flow.errorHandling` (#4964). It is
    // tombstoned rather than deleted because two of the three owning shapes are
    // not `.strict()`: a plain deletion would have Zod silently strip the
    // authored value and drop the delay back to the 1000ms default, which is
    // precisely the quiet-failure class ADR-0049 exists to remove. On the strict
    // surface the tombstone is still the better channel — it carries the
    // rename, where a bare unknown-key rejection would only carry the key.
    // `retry-policy-converged` rewrites it on the load path.
    retryDelayMs: retiredKey(
      '`retryDelayMs` was removed in @objectstack/spec 17.0.0 (#4661, #4964) — the retry policy now ' +
      'has ONE spelling for its base delay across every surface that carries it: `job.retryPolicy`, ' +
      "a `try_catch` node's `retry` and `flow.errorHandling`. " +
      'Rename the key to `backoffMs`; the value (milliseconds before the first retry) ' +
      'is unchanged. ' +
      'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
    ),
  };
}

/**
 * Exponential-backoff retry policy — the named schema for `job.retryPolicy` and
 * a `try_catch` node's `retry` region. `Flow.errorHandling` carries the same
 * contract via {@link retryPolicyShape}, which it must, being `.strict()` (see
 * that function's note). `ETLPipeline.retry` did the same until #6414 retired
 * the L2 ETL layer.
 *
 * Delay before retry *n* is `min(backoffMs * backoffMultiplier^(n-1),
 * maxRetryDelayMs)`, optionally jittered.
 *
 * ## Defaults are opt-in, not opt-out (17.0.0, #4661, #4962)
 *
 * `maxRetries` defaults to **0** — declaring a retry block does not by itself
 * buy retries. Two pre-17 surfaces defaulted it to 3: `job.retryPolicy`, so a
 * job that wrote `{ backoffMs: 5000 }` and nothing else silently got three
 * attempts, and `ETLPipeline.retry` (as `maxAttempts`). The
 * `retry-policy-converged` conversion writes that `3` (and the old
 * `backoffMultiplier: 2`) into existing job documents, so no deployed stack
 * changes behaviour. What changes is what a NEWLY authored omission means.
 *
 * The ETL half never got a conversion branch — deliberately, and now
 * permanently: an ETL pipeline was not a `defineStack` collection and
 * `etl.zod.ts` had no parse site anywhere in objectstack / objectui / cloud
 * (批 12's measurement), so there was no stored document for a D2 walker to
 * reach and writing one anyway would have been a conversion advertising
 * coverage it did not have. #6414 then retired the whole L2 layer, which took
 * `ETLPipeline.retry` with it. There is therefore NO `maxAttempts` tombstone:
 * a tombstone keeps a key unwritable on a shape that survives, and no `retry`
 * block survives to author the key into — an absence strictly stronger than a
 * tombstone. What declares the removal is `RETIRED_DEFS_BY_MAJOR` plus the D3
 * `etl-pipeline-layer-retired` semantic migration (which ABSORBED #4962's own
 * conversion entry for exactly this reason), and the door an upgrading author
 * actually hits is `tsc` — TS2724/TS2305 on every removed ETL name.
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
export const RetryPolicySchema = lazySchema(() => z.object(retryPolicyShape()));

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
