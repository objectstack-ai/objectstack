// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `hook-timeout-to-timeout-ms` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `hookTimeoutToTimeoutMs` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';

/**
 * `hook.timeout` → `hook.timeoutMs` (protocol 18, #14478; maintainer ruling
 * 2026-09-02, recorded on the card as "ruled B").
 *
 * The unit (milliseconds) lived only in the key's `.describe()` while the
 * body-level `timeoutMs` and `retryPolicy.backoffMs` beside it spell theirs —
 * one surface, two conventions, and an author who copied a seconds value in
 * got a limit 1000× too short with no error anywhere. The spec-source gate
 * `check:duration-unit-keys` now refuses a duration-shaped number whose unit
 * lives in prose alone, and the ruling adopted NO grandfathering: every
 * existing offender is renamed under a conversion like this one. **Retired
 * from the load path** (no alias window — 「不考虑存量」, 「短期不考虑渐进」):
 * the schema tombstones `timeout` with the rename, and this entry preserves
 * the rewrite for `os migrate meta` and the stored-row rehydration seam.
 * `renameKey` leaves an already-canonical `timeoutMs` alone and refuses a
 * pair that disagrees (#4923).
 */
const hookTimeoutToTimeoutMs: MetadataConversion = {
  id: 'hook-timeout-to-timeout-ms',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.3.0',
  surface: 'hook.timeout',
  summary: "hook key 'timeout' → 'timeoutMs' (a duration key carries its unit in its name, and this one's unit lived only in the description; the value, milliseconds, is unchanged)",
  apply(stack, emit) {
    return mapCollection(stack, 'hooks', (hook, path) => {
      const renamed = renameKey(hook, 'timeout', 'timeoutMs');
      if (!renamed) return hook;
      emit({ from: 'timeout', to: 'timeoutMs', path: `${path}.timeoutMs` });
      return renamed;
    });
  },
  fixture: {
    before: {
      hooks: [
        { name: 'audit_order', object: 'order', events: ['afterInsert'], handler: 'auditOrder', timeout: 5000 },
        // A hook that never authored the key keeps its identity (copy-on-write).
        { name: 'score_lead', object: 'lead', events: ['afterUpdate'], handler: 'scoreLead' },
      ],
    },
    after: {
      hooks: [
        { name: 'audit_order', object: 'order', events: ['afterInsert'], handler: 'auditOrder', timeoutMs: 5000 },
        { name: 'score_lead', object: 'lead', events: ['afterUpdate'], handler: 'scoreLead' },
      ],
    },
    expectedNotices: 1,
  },
};

export { hookTimeoutToTimeoutMs };
