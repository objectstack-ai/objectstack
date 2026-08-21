// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10414 — ADR-0049 enforce-or-remove (triage routed REMOVE; the #10298 shape
// one level up). `filters` was a declared, authorable per-metric raw-SQL
// filter (`filters: [{ sql: string }]`) with ZERO consumers, measured with a
// positive control: no `.filters` read in `service-analytics` or any driver's
// non-test code while the neighbouring `format` key IS read
// (`analytics-service.ts`, `dataset-compiler.ts`).
// `NativeSQLStrategy.resolveMeasureSql` and
// `ObjectQLStrategy.resolveMeasureAggregation` both wrap the metric's `sql` in
// the aggregate and never look at `filters` — so a hand-authored cube's
// `filters: [{ sql: "stage = 'closed_won'" }]` parsed, registered, and
// silently returned the UNFILTERED aggregate under the author's metric name.
// The raw-SQL fragment also ran against the platform's structured
// FilterCondition direction (it cannot be parameterized, re-targeted per
// driver dialect, or walked by `packages/lint/src/filter-walk.ts`); the
// dataset path was repaired separately through its own structured channel
// (#10411), which left this key inert with the dataset half fixed around it.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
// `MetricSchema` is `strictObject`, so the route is strict deletion + a
// `guidance` entry carrying the prescription (no retiredKey tombstone — the
// key is out of the walked shape entirely). Sources are rewritten by the D2
// conversion `metric-filters-removed`, which strips the key from every metric
// in `analyticsCubes[].measures`.
export const entry = 'data/Metric:filters';
