// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #14478 (maintainer ruling B: a duration key carries its unit in its NAME) —
// the D3 entry of the `job-timeout-to-timeout-ms` family (ruling B on #17152:
// one D3 entry per retirement family, even when D2 is lossless). The job half
// of the hook rename, with its own audience: whoever schedules background work.
export const entry: SemanticMigration = {
  id: 'job-timeout-unit-in-key',
  surface: 'job.timeout — the per-attempt time limit of a scheduled job',
  replacement: '`timeoutMs` — the same per-attempt limit, in milliseconds, beside the sibling '
    + '`retryPolicy.backoffMs` that already spelled its unit.',
  reason: 'The D2 conversion `job-timeout-to-timeout-ms` renames `timeout` to `timeoutMs` in author '
    + 'sources and wherever the chain is replayed, keeping the value, and the rename is lossless: '
    + 'the key always meant milliseconds. The judgment is whether the author knew that. The unit lived '
    + 'only in the description while `retryPolicy.backoffMs` beside it spelled its own, so one '
    + 'job definition carried two conventions; a seconds value copied in — `timeout: 300` for a '
    + 'five-minute job — became a 300-millisecond limit with no error, and the rename carries the '
    + '300 over unchanged. A limit that short fails every attempt and burns the retry budget, '
    + 'which is easy to misread as a flaky job. Only the author can say which unit each value was '
    + 'written in, and code that builds job definitions in TypeScript is outside the chain\'s '
    + 'reach.',
  acceptanceCriteria: 'No job carries `timeout`; the parse refuses it with the rename. Every '
    + '`timeoutMs` value is the per-attempt limit the author intends in milliseconds — a job meant '
    + 'to be allowed five minutes reads `timeoutMs: 300000`. An attempt that runs past its '
    + '`timeoutMs` fails with a timeout and is retried under `retryPolicy`, and an attempt that '
    + 'finishes inside it succeeds as before. No code reads or writes `timeout` on a job '
    + 'definition.',
  relevantWhen: { kind: 'stack-declares', keys: ['jobs'] },
};
