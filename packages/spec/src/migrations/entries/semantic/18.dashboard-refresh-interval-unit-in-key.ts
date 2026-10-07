// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15680 (stack card of #14478, maintainer ruling B: a duration key carries its
// unit in its NAME) — the D3 entry of the
// `dashboard-refresh-interval-to-refresh-interval-seconds` family (ruling B on
// #17152: one D3 entry per retirement family, even when D2 is lossless). The
// one key of that stack whose reader lives in another repository, released on
// its own schedule — so besides the unit check, the author owes a look at the
// running console.
export const entry: SemanticMigration = {
  id: 'dashboard-refresh-interval-unit-in-key',
  surface: 'dashboard.refreshInterval — the auto-refresh cadence of a dashboard',
  replacement: '`refreshIntervalSeconds` — the same cadence, in seconds, with the unit in the key '
    + 'name. The old rename hints (`refresh`, `autoRefresh`, `pollInterval`) now point at it.',
  reason: 'The D2 conversion `dashboard-refresh-interval-to-refresh-interval-seconds` renames '
    + '`refreshInterval` to `refreshIntervalSeconds` in the `dashboards` collection and on stored '
    + 'dashboard rows, keeping the value, and the rename is lossless: the key always meant seconds. '
    + 'Two judgments remain. First, the unit: nothing in the old name said seconds, and three '
    + 'other spellings authors reached for named no unit either, so a value written in '
    + 'milliseconds — `refreshInterval: 30000` meant as thirty seconds — asked for a refresh about '
    + 'every eight hours, and the rename keeps 30000. Second, the reader: the dashboard renderer ships '
    + 'in the separately released console, and when this rename landed it still read the old '
    + 'key, so a console that has not yet moved sees no cadence and starts no timer. A dashboard '
    + 'that stops refreshing after the upgrade is that lag, not a wrong value — which only a look '
    + 'at the running console can tell apart.',
  acceptanceCriteria: 'No dashboard carries `refreshInterval`; the parse refuses it with the rename. '
    + 'Every `refreshIntervalSeconds` value is the cadence the author intends in seconds — a '
    + 'dashboard meant to refresh every thirty seconds reads `refreshIntervalSeconds: 30`. In the '
    + 'console the deployment runs, an open dashboard re-queries its widgets at that cadence; '
    + 'where it does not, the console build predates the renderer\'s move to the new key, and the '
    + 'author has recorded that until the console is upgraded.',
  relevantWhen: { kind: 'stack-declares', keys: ['dashboards'] },
};
