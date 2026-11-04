// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `job-timeout-to-timeout-ms` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `jobTimeoutToTimeoutMs` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';

/**
 * `job.timeout` → `job.timeoutMs` (protocol 18, #14478) — the job half of the
 * rename `hookTimeoutToTimeoutMs` documents. The sibling `retryPolicy.backoffMs`
 * spelled its unit; the per-attempt limit did not. Same posture: retired from
 * the load path, tombstoned at the schema, replayable here. The fixture stays
 * clear of `retryPolicy` on purpose — `retry-policy-converged` replays on that
 * block wherever retired entries do (the fixture harness among them) and would
 * fire on it.
 */
const jobTimeoutToTimeoutMs: MetadataConversion = {
  id: 'job-timeout-to-timeout-ms',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.3.0',
  surface: 'job.timeout',
  summary: "job key 'timeout' → 'timeoutMs' (a duration key carries its unit in its name, and this one's unit lived only in the description; the value, milliseconds, is unchanged)",
  apply(stack, emit) {
    return mapCollection(stack, 'jobs', (job, path) => {
      const renamed = renameKey(job, 'timeout', 'timeoutMs');
      if (!renamed) return job;
      emit({ from: 'timeout', to: 'timeoutMs', path: `${path}.timeoutMs` });
      return renamed;
    });
  },
  fixture: {
    before: {
      jobs: [{
        name: 'nightly_health_sweep',
        schedule: { type: 'cron', expression: '0 1 * * *' },
        handler: 'sweepProjectHealth',
        timeout: 300000,
      }],
    },
    after: {
      jobs: [{
        name: 'nightly_health_sweep',
        schedule: { type: 'cron', expression: '0 1 * * *' },
        handler: 'sweepProjectHealth',
        timeoutMs: 300000,
      }],
    },
    expectedNotices: 1,
  },
};

export { jobTimeoutToTimeoutMs };
