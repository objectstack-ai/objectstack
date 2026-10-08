// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #10414 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `metric-filters-removed` family (ruling B on #17152: one D3 entry per
// retirement family, even when D2 is lossless). The unknown-keys entry
// `analytics-authorable-unknown-keys-refused` names the conversion only in
// passing; this is the family's own entry. The strip preserves observed
// behaviour exactly — which is the problem: the observed behaviour was an
// unfiltered number under a filtered name.
export const entry: SemanticMigration = {
  id: 'cube-metric-filters-retired',
  surface: 'analyticsCubes[].measures.<metric>.filters — the per-metric raw-SQL filter list',
  replacement: 'One of the two filters that ARE applied: a `where` condition at query time, or an '
    + 'ADR-0021 dataset measure with a structured `filter`. (A third channel — folding the condition '
    + 'into the metric\'s own `sql` expression — left with `cube-member-sql-expression-retired`: a '
    + 'member\'s `sql` is a column reference.)',
  reason: 'The D2 conversion `metric-filters-removed` deletes `filters` from every cube metric, and '
    + 'the delete is lossless in the narrow sense: neither SQL strategy ever read the key, so a '
    + 'metric authored with `filters: [{ sql: "stage = \'closed_won\'" }]` already returned the '
    + 'UNFILTERED aggregate under the author\'s metric name, and still does. That is exactly why the '
    + 'strip does not finish the job. The author wrote a condition because they wanted a filtered '
    + 'number; every dashboard, report and export reading that metric has been showing a larger '
    + 'one. Only the author can say which of the two live mechanisms expresses the condition '
    + 'they meant — a query-time `where` changes every query, a dataset measure moves the metric '
    + 'to the governed layer — and whether numbers already published from the unfiltered metric '
    + 'need to be revisited.',
  acceptanceCriteria: 'No cube metric carries `filters`; the parse refuses the key by name. For '
    + 'each metric that carried one, the author has either re-expressed the condition through one '
    + 'of the two live mechanisms or decided the unfiltered aggregate is what they want — and '
    + 'renamed the metric if its name promised the filter. With the condition re-expressed, a query '
    + 'over a fixture where the condition excludes rows returns the filtered aggregate (strictly '
    + 'smaller for a positive sum over excluded rows), not the unfiltered one.',
  relevantWhen: { kind: 'stack-declares', keys: ['analyticsCubes'] },
};
