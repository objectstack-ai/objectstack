// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23543 F2 — the job default flip's one D3 entry. The D2 half is
// `retry-policy-converged` (protocol 17), which wrote the pre-17
// `maxRetries: 3` / `backoffMultiplier: 2` into every job retry block the chain
// could reach and is now retired from the load path. It carries no
// `conversionIds`: since #25767 protocol 17 is MIGRATION_SUPPORT_FLOOR, so no
// step of the chain replays that conversion, and `os migrate meta` lists this
// entry as the hand edit it is — with the choice no conversion can make for the
// author: whether a job that never stated a count should retry at all.
export const entry: SemanticMigration = {
  id: 'job-retry-policy-without-attempts-refused',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface: 'job.retryPolicy declared with maxRetries omitted or 0 (system/job.zod.ts)',
  replacement:
    '`retryPolicy: { maxRetries: N, … }` with N ≥ 1 (for example 3, the count such a block ran with '
    + 'before 17), or no `retryPolicy` block at all for a single attempt',
  reason:
    'A maintainer ruling retired the job half of `retry-policy-converged` from the load path at 18. '
    + '`maxRetries` has defaulted to 0 since 17, so a `retryPolicy` block that omits it (or writes 0) buys '
    + 'no retry: the job runs once. Through 17 the loader hid that by writing the pre-17 `maxRetries: 3` '
    + 'and `backoffMultiplier: 2` into such a block with a notice. At 18 the job parse refuses the block '
    + 'at `retryPolicy.maxRetries` instead, at `objectstack validate`, `objectstack build` and '
    + '`defineStack`, so under `objectstack lint` too when the config calls it: "a retry block with no '
    + 'attempts is no retry block". The D2 conversion belongs to protocol 17, the migration floor, so '
    + '`objectstack migrate meta` applies no edit for it and prints each block in your metadata sources '
    + 'that omits the count, or writes 0, among the refusals left after the chain. Stored jobs keep '
    + 'loading with the pre-17 numbers, because every rehydration seam replays the conversion. Decide '
    + 'per job, by hand: write `maxRetries: 3` and `backoffMultiplier: 2` to keep the retries the job '
    + 'ran with before 17, or delete the block if the job should run once. A block that already '
    + 'states `maxRetries` and omits `backoffMultiplier` is not refused, and its delay is now flat '
    + '(multiplier 1) where the loader used to write 2: state `backoffMultiplier: 2` to keep the old '
    + 'curve.',
  acceptanceCriteria:
    '`objectstack validate` reports no refusal at a `jobs[].retryPolicy.maxRetries` path; every job that '
    + 'should retry states `maxRetries` (1 to 10) in its block, every job that should run once has no '
    + 'block, and a failing run is attempted the stated number of extra times.',
};
