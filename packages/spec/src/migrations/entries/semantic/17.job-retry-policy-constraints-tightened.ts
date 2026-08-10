// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'job-retry-policy-constraints-tightened',
  surface: 'job.retryPolicy.maxRetries (> 10) / job.retryPolicy.backoffMultiplier (< 1)',
  replacement: 'maxRetries <= 10, and backoffMultiplier >= 1',
  reason:
    'The converged RetryPolicy (#4661) keeps the automation side\'s bounds, which the job '
    + 'side never had: `maxRetries` is capped at 10 and `backoffMultiplier` floored at 1. '
    + 'Neither has a lossless rewrite. Clamping `maxRetries: 20` to 10 would halve a '
    + 'retry budget its author chose, and a `backoffMultiplier` below 1 describes a delay '
    + 'that SHRINKS on each attempt — retrying a failing dependency ever faster, which is '
    + 'the opposite of backoff and was never a shape the engine meant to offer. Both now '
    + 'fail at parse time with the bound named, rather than being silently reinterpreted. '
    + 'Choosing the replacement count (or accepting the cap) is the author\'s call.',
  acceptanceCriteria:
    'Every job declaring `retryPolicy` parses: no `maxRetries` above 10 and no '
    + '`backoffMultiplier` below 1 remain, and each adjusted value was re-chosen knowing a '
    + 'retry re-runs the handler with its writes and callouts. No job fails to register '
    + 'with the retry-policy bound prescription.',
};
