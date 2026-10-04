---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: an analytics `order` key that names no member the query selects is refused with `INVALID_FIELD` / 400 at the analytics door, on both strategies, before either runs

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the analytics door of an `order` key the query does not select. No authorable key, spelling, export or stored shape moves: `AnalyticsQuerySchema` still parses every `order` it parsed (the refusal is a runtime rule on the request, not a schema change), `CubeSchema`, `DatasetSchema` and the dashboard and report schemas are untouched, the new module is internal to the package (not exported from `index.ts`), and no stored row is read or rewritten. An unselected key had no defined meaning to preserve: the native-SQL strategy answered 500 for it, or on SQLite ordered the groups by an arbitrary row, and the ObjectQL strategy never applied `order` at all; which member a caller meant is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers an analytics order key, and this diff adds none (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept, on both strategies and every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**The rule.** Each `order` key must be a column the answer carries: one of the query's own `dimensions` entries, one of its `measures` entries, or a `timeDimensions` entry that carries a `granularity`, spelled exactly as it is selected (a `<cube>.`-qualified measure keeps its qualifier in the answer, so the bare spelling names no column beside it, and the other way round). A `timeDimensions` entry with only a `dateRange` bounds the rows and is not a column. Any other key is refused with `400 INVALID_FIELD`, naming every such key and the members the query does select, and nothing is executed. The thrown error carries `param: 'order'` and `field` (the first such key).

**Before**, measured through `POST /api/v1/analytics/query` on SQLite and PostgreSQL 16.14, for a cube that declares no join over an object whose lookup target also declares `note`:

- `dimensions: ['owner.email']` with `order: { note: 'asc' }`: native-SQL strategy `500` on both drivers (PostgreSQL 42702, `note` is ambiguous); ObjectQL strategy `200`.
- `dimensions: ['note']` with `order: { amount: 'asc' }`: native-SQL strategy `200` on SQLite, ordered by an arbitrary row's `amount`, and `500` on PostgreSQL (42803, must appear in GROUP BY); ObjectQL strategy `200`.
- `dimensions: ['note']` with `order: { 'owner.email': 'asc' }`: native-SQL strategy `500` on both drivers (PostgreSQL 42703, no such column); ObjectQL strategy `200`.

**Now** each of those answers `400 INVALID_FIELD` on both strategies and both drivers, and `POST /api/v1/analytics/sql` refuses them the same way instead of returning a statement whose `ORDER BY` cannot run.

**What to write instead.** Add the key to the query's `dimensions` (or `measures`), so the answer carries it, or drop it from `order`.

**Who is affected.** A caller that posted an `order` key it did not select. On the native-SQL strategy those queries were already a 500 everywhere but the one SQLite shape, whose order was arbitrary. No example app, shipped dashboard, report, dataset or cube authors such a key, and the console's analytics adapter sends no `order` to this route.

**Unchanged.** Ordering by a selected dimension, a selected measure or a bucketed time dimension; the dataset door (`POST /api/v1/analytics/dataset/query`), which already refused an unselected `selection.order` key with `400 DATASET_INVALID` and pushes an `order` down only when the selection selects every key; and a key naming a field the caller may not read, which keeps the `403 PERMISSION_DENIED` the field-level read gate answers for every position.
