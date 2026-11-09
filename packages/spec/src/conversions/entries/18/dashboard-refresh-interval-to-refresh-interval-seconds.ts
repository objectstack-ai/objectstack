// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `dashboard-refresh-interval-to-refresh-interval-seconds`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `dashboardRefreshIntervalToRefreshIntervalSeconds` and lists it where
// it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';

/**
 * `dashboards[].refreshInterval` → `refreshIntervalSeconds` (protocol 18,
 * #15680 for #14478) — the `ui` half of the same rename
 * {@link hookTimeoutToTimeoutMs} documents, and the one key in this whole stack
 * whose CONSUMER lives in another repository.
 *
 * Three rename-hint aliases already pointed at the old spelling — `refresh`,
 * `autoRefresh`, `pollInterval` — which is the measure of how many spellings
 * authors reach for; none of them named a unit either, so every door into the
 * key left the cadence ambiguous. All three were repointed at the schema in the
 * same edit, so an author arriving through any of them is now prescribed the
 * unit-carrying name.
 *
 * ⚠️ objectui's dashboard renderer reads this key and multiplies by 1000, and
 * republishes it as a registry input the console offers to authors. That reader
 * could not move in this PR, so unlike every other rename in this card the
 * consumer lags by a release: this conversion is what keeps stored dashboards
 * and `os migrate meta` correct in the meantime.
 *
 * Same posture as its siblings: retired from the load path, tombstoned at the
 * schema, replayable here.
 */
const dashboardRefreshIntervalToRefreshIntervalSeconds: MetadataConversion = {
  id: 'dashboard-refresh-interval-to-refresh-interval-seconds',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.3.0',
  surface: 'dashboard.refreshInterval',
  summary: "dashboard key 'refreshInterval' → 'refreshIntervalSeconds' (a duration key carries its unit in its name, and this one's unit lived only in the description; the value, seconds, is unchanged)",
  apply(stack, emit) {
    return mapCollection(stack, 'dashboards', (dashboard, path) => {
      const renamed = renameKey(dashboard, 'refreshInterval', 'refreshIntervalSeconds');
      if (!renamed) return dashboard;
      emit({ from: 'refreshInterval', to: 'refreshIntervalSeconds', path: `${path}.refreshIntervalSeconds` });
      return renamed;
    });
  },
  fixture: {
    before: {
      dashboards: [
        { name: 'sales_overview', label: 'Sales Overview', widgets: [], refreshInterval: 300 },
        // A dashboard that never authored the key keeps its identity (copy-on-write).
        { name: 'ops_overview', label: 'Ops Overview', widgets: [] },
      ],
    },
    after: {
      dashboards: [
        { name: 'sales_overview', label: 'Sales Overview', widgets: [], refreshIntervalSeconds: 300 },
        { name: 'ops_overview', label: 'Ops Overview', widgets: [] },
      ],
    },
    expectedNotices: 1,
  },
};

export { dashboardRefreshIntervalToRefreshIntervalSeconds };
