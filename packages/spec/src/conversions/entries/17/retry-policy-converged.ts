// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `retry-policy-converged` conversion (`toMajor: 17`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `retryPolicyConverged` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, mapFlowNodes, renameKey } from '../../walk.js';

/**
 * The retry policy converges to one declaration (protocol 17, #4661 — the
 * #4535 C8 dual-source cluster).
 *
 * `@objectstack/spec/automation` and `@objectstack/spec/system` both exported a
 * `RetryPolicy` / `RetryPolicySchema`, resolving to DIFFERENT declarations — so
 * which shape a consumer got depended only on the import path (#4411). They
 * were never two concepts: `try_catch`'s `retry` region and `job.retryPolicy`
 * both compute `delay = base * multiplier^(retry-1)`, and the two executors
 * implemented that identical formula. What differed was cosmetic and
 * accidental, and this conversion pays for both halves of the merge:
 *
 *  1. **The base delay had two spellings.** automation said `retryDelayMs`,
 *     system said `backoffMs`. `backoffMs` wins — it is what the *enforced*
 *     retry policies already spell it (`job.retryPolicy` and `hook.retryPolicy`;
 *     see the `datasource-inert-blocks-removed` note above, which leans on
 *     exactly that distinction), so the platform drops from three spellings to
 *     two rather than four. `retryDelayMs` is tombstoned (`retiredKey`) — NOT
 *     deleted — because two of the three owning shapes are not `.strict()`: a
 *     plain deletion would have Zod silently swallow the authored number and
 *     fall back to the 1000ms default, which is the quiet-failure class
 *     ADR-0049 removes.
 *
 *  2. **The defaults were opposite, and no gate can see a default.** Pre-17,
 *     `job.retryPolicy` defaulted `maxRetries: 3` / `backoffMultiplier: 2`
 *     while the automation shape defaulted 0 / 1. The merged declaration takes
 *     0 / 1 (retry is opt-in: a retry replays whatever the attempt already did,
 *     and an implicit replay of side effects is the failure mode hardest to
 *     catch in tests — the same reading already recorded for flow-level retry
 *     in `flow-retry-max-retries-required`, #4247). Taken alone that would
 *     SILENTLY stop existing jobs from retrying, and the authorable-surface
 *     gate would never notice: it compares key sets, and a default is not a key.
 *     So this conversion writes the pre-17 numbers into every existing
 *     `job.retryPolicy` that omitted them. Deployed stacks keep their exact
 *     behaviour; only a newly authored omission means "no retry".
 *
 * Jobs with no `retryPolicy` block at all are left alone — absence already
 * meant a single attempt on both sides of the change.
 *
 * ## The ONE further surface this entry grew to cover (#4964 / #4962)
 *
 * The convergence above was driven by the dual-source instrument, whose
 * question is "how many declarations share one exported NAME?". Two further
 * encodings of the identical policy were invisible to it because they were
 * anonymous inline `z.object`s with no exported name at all — and after a
 * convergence lands, a surviving dialect reads as reviewed-and-kept rather
 * than missed. One of the two is still a surface; the other went with its
 * layer:
 *
 *  - **`flow.errorHandling`** (#4964) spelled the base delay `retryDelayMs`;
 *    every other key, bound and default already matched. Step 0 below renames
 *    it, so the ONE authorable casualty of the whole convergence is still just
 *    that word — now retired everywhere it was ever legal rather than only on
 *    the two shapes #4661's instrument could see.
 *  - **`ETLPipeline.retry`** (#4962) spelled the count `maxAttempts` and
 *    defaulted it to 3. It got **no step here, deliberately** — and never will.
 *    An ETL pipeline was not a `defineStack` collection and `etl.zod.ts` had no
 *    parse site in objectstack / objectui / cloud (批 12's measurement), so
 *    there was no stored or authored document a walker could reach: a branch
 *    for it would have been dead code claiming migration coverage that does not
 *    exist, which is the ADR-0049 failure this registry is supposed to prevent,
 *    not commit. #6414 then retired the whole L2 layer, and #4962's own entry
 *    (`etl-retry-converged-onto-retry-policy`) was ABSORBED into
 *    `etl-pipeline-layer-retired` inside the same unreleased major. There is no
 *    `maxAttempts` tombstone left to carry the rename or the default change: it
 *    went with the shape that carried it, which is strictly stronger, because
 *    no `retry` block survives to author the key into. `tsc` (TS2724/TS2305 on
 *    the removed ETL names) is the whole channel. That is also why the ETL
 *    default flip 3 → 0 never needed a materialization step while the job one
 *    did: nothing was ever deployed under the old reading.
 *
 * ## Retired from the load path at 18 (#23543, ruling F2 A)
 *
 * The base-delay rename never needed the load path: every surface that carried
 * `retryDelayMs` refuses it with the rename to `backoffMs` (the
 * `RetryPolicySchema` tombstone, which a `try_catch` node's `config.retry` is,
 * and `flow.errorHandling`'s own). It stayed for the job half alone (the
 * verdict #23487 recorded): retired, the authoring funnel would stop writing
 * `maxRetries: 3` into a source block that omits it, and such a job would
 * silently drop from three retries to none — a default flip no gate can see.
 * The ruling made that drop loud instead: the job parse refuses a
 * `retryPolicy` whose `maxRetries` is omitted or 0, naming the fix
 * (`JOB_RETRY_POLICY_NO_ATTEMPTS`, `system/job.zod.ts`), so no authored job
 * changes its retry count without its author being told. An omitted
 * `backoffMultiplier` is not refused and now keeps its declared default (1):
 * it shapes the delay curve, not whether the job retries.
 *
 * The authoring funnel (`defineStack`, `os validate` / `os build` / `os lint`)
 * no longer replays it. Stored documents are the `includeRetired` seams —
 * stored-row rehydration (`applyConversionsToStoredItem`), the automation
 * engine's flow rehydration, the metadata save door's flow fallback, the
 * artifact-ingestion door inside its window — so a job stored before 17 keeps
 * the three retries it ran with. `os migrate meta --from 16` replays it too (a
 * step-17 member, carried by the D3 entry `job-retry-policy-without-attempts-refused`).
 */
const retryPolicyConverged: MetadataConversion = {
  id: 'retry-policy-converged',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.errorHandling.retryDelayMs / flow.node.config.retry.retryDelayMs / job.retryPolicy.maxRetries / job.retryPolicy.backoffMultiplier',
  summary:
    "retry policy unified across job.retryPolicy, try_catch retry and flow.errorHandling: base delay 'retryDelayMs' → 'backoffMs', " +
    "and the pre-17 job defaults (maxRetries 3, backoffMultiplier 2) written out explicitly now that the merged default is 0 / 1: two declarations that differed only by accident became one, and retry is opt-in because a retry replays whatever the attempt already did",
  apply(stack, emit) {
    // ── 0. flows: errorHandling.retryDelayMs → errorHandling.backoffMs ─
    //
    // The FLOW-LEVEL retry policy (#4964). Same rename as the try_catch node
    // below and for the same reason, reached one level up: `errorHandling`
    // hangs off the flow document, not off a node, so `mapFlowNodes` walks
    // straight past it — which is a small echo of why this divergence survived
    // #4661 at all. `renameKey` leaves an already-canonical `backoffMs` alone;
    // when BOTH spellings are present it now (#4923) deletes `retryDelayMs`
    // only if it repeats the same number, and otherwise keeps both rather than
    // guessing which delay the author meant — the strict block then rejects
    // naming both. This entry relied on the shared helper's semantics rather
    // than open-coding its own precisely so it would move with that ruling,
    // and it did: no change was needed here.
    const withErrorHandling = mapCollection(stack, 'flows', (flow, path) => {
      const eh = flow.errorHandling;
      if (!eh || typeof eh !== 'object' || Array.isArray(eh)) return flow;
      const renamed = renameKey(eh as Record<string, unknown>, 'retryDelayMs', 'backoffMs');
      if (renamed === null) return flow;
      emit({ from: 'retryDelayMs', to: 'backoffMs', path: `${path}.errorHandling.backoffMs` });
      return { ...flow, errorHandling: renamed };
    });

    // ── 1. try_catch nodes: retry.retryDelayMs → retry.backoffMs ──────
    const withFlows = mapFlowNodes(withErrorHandling, (node, path) => {
      if (node.type !== 'try_catch') return node;
      const config = node.config;
      if (!config || typeof config !== 'object' || Array.isArray(config)) return node;
      const configDict = config as Record<string, unknown>;
      const retry = configDict.retry;
      if (!retry || typeof retry !== 'object' || Array.isArray(retry)) return node;
      const renamed = renameKey(retry as Record<string, unknown>, 'retryDelayMs', 'backoffMs');
      if (renamed === null) return node;
      emit({ from: 'retryDelayMs', to: 'backoffMs', path: `${path}.config.retry.backoffMs` });
      return { ...node, config: { ...configDict, retry: renamed } };
    });

    // ── 2. jobs: materialize the pre-17 implicit defaults ─────────────
    return mapCollection(withFlows, 'jobs', (job, path) => {
      const policy = job.retryPolicy;
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return job;
      const policyDict = policy as Record<string, unknown>;
      let next = policyDict;
      if (next.maxRetries === undefined) {
        next = { ...next, maxRetries: 3 };
        emit({
          from: 'maxRetries unset (implied 3)',
          to: 'maxRetries: 3',
          path: `${path}.retryPolicy.maxRetries`,
        });
      }
      if (next.backoffMultiplier === undefined) {
        next = { ...next, backoffMultiplier: 2 };
        emit({
          from: 'backoffMultiplier unset (implied 2)',
          to: 'backoffMultiplier: 2',
          path: `${path}.retryPolicy.backoffMultiplier`,
        });
      }
      return next === policyDict ? job : { ...job, retryPolicy: next };
    });
  },
  fixture: {
    before: {
      flows: [{
        name: 'sync_orders',
        // Flow-LEVEL policy (#4964) — one level up from the nodes, so the node
        // walk below never sees it.
        errorHandling: { strategy: 'retry', maxRetries: 3, retryDelayMs: 2000 },
        nodes: [
          { id: 'n1', type: 'start' },
          {
            id: 'n2',
            type: 'try_catch',
            config: {
              try: { nodes: [], edges: [] },
              retry: { maxRetries: 3, retryDelayMs: 500, jitter: true },
            },
          },
          // Already canonical — left alone, contributes no notice.
          {
            id: 'n3',
            type: 'try_catch',
            config: { try: { nodes: [], edges: [] }, retry: { maxRetries: 2, backoffMs: 250 } },
          },
        ],
      }, {
        // Flow-level block already canonical — left alone, no notice.
        name: 'roll_up',
        errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 100 },
        nodes: [{ id: 'n1', type: 'start' }],
      }],
      jobs: [
        // Omits both defaults — both get written out.
        { name: 'nightly_sync', schedule: { type: 'cron', expression: '0 0 * * *' }, handler: 'jobs.ts:sync', retryPolicy: { backoffMs: 5000 } },
        // States both — untouched.
        { name: 'hourly_roll', schedule: { type: 'cron', expression: '0 * * * *' }, handler: 'jobs.ts:roll', retryPolicy: { maxRetries: 1, backoffMultiplier: 3 } },
        // No policy block at all — absence already meant one attempt.
        { name: 'weekly_purge', schedule: { type: 'cron', expression: '0 0 * * 0' }, handler: 'jobs.ts:purge' },
      ],
    },
    after: {
      flows: [{
        name: 'sync_orders',
        errorHandling: { strategy: 'retry', maxRetries: 3, backoffMs: 2000 },
        nodes: [
          { id: 'n1', type: 'start' },
          {
            id: 'n2',
            type: 'try_catch',
            config: {
              try: { nodes: [], edges: [] },
              retry: { maxRetries: 3, jitter: true, backoffMs: 500 },
            },
          },
          {
            id: 'n3',
            type: 'try_catch',
            config: { try: { nodes: [], edges: [] }, retry: { maxRetries: 2, backoffMs: 250 } },
          },
        ],
      }, {
        name: 'roll_up',
        errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 100 },
        nodes: [{ id: 'n1', type: 'start' }],
      }],
      jobs: [
        { name: 'nightly_sync', schedule: { type: 'cron', expression: '0 0 * * *' }, handler: 'jobs.ts:sync', retryPolicy: { backoffMs: 5000, maxRetries: 3, backoffMultiplier: 2 } },
        { name: 'hourly_roll', schedule: { type: 'cron', expression: '0 * * * *' }, handler: 'jobs.ts:roll', retryPolicy: { maxRetries: 1, backoffMultiplier: 3 } },
        { name: 'weekly_purge', schedule: { type: 'cron', expression: '0 0 * * 0' }, handler: 'jobs.ts:purge' },
      ],
    },
    // sync_orders' flow-level rename, n2's node-level rename, plus
    // nightly_sync's two materialized defaults.
    expectedNotices: 4,
  },
};

export { retryPolicyConverged };
