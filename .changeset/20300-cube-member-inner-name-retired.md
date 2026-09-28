---
'@objectstack/spec': minor
'@objectstack/service-analytics': patch
---

**BREAKING** — the inner `name` on an analytics cube's measures and dimensions (`MetricSchema.name`, `DimensionSchema.name`) is now refused at parse: nothing ever read it. The record key a member is declared under IS its name — the analytics API publishes it as `<cube>.<key>` and a query names it that way. Delete the inner `name`; to rename a member, rename its key.

Clause-②: no (narrowing)

`measures` and `dimensions` are records, and the key was always the member's identity: `GET /api/v1/analytics/meta` publishes every member as `${cube.name}.${key}` (in `@objectstack/service-analytics` and in `@objectstack/driver-memory`), and both SQL strategies and the in-memory driver resolve a member by indexing the bag with that key. Measured before removal, with a lit control: zero reads of a member's inner `name` in non-test source, against four reads of the neighbouring `measure.label` / `dimension.label` in the same two `getMeta` projections. So the inner `name` was a REQUIRED second copy of the identity that nothing read — and one that disagreed with its key was silently ignored (this repository's own in-memory driver fixtures authored `totalAmount: { name: 'total_amount', … }` and queried `orders.totalAmount`).

**Removed rather than enforced** (ADR-0049 enforce-or-remove; the triage verdict on the card, by the maintainer's criterion for declared-but-unenforced families): Cube.dev and LookML key a member by its declared name, with no second inner name that can disagree — and here the record key already delivered it.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `measures: { total_amount: { name: 'total_amount', label: 'Total', type: 'sum', sql: 'amount' } }` | `measures: { total_amount: { label: 'Total', type: 'sum', sql: 'amount' } }` |
| `dimensions: { status: { name: 'status', label: 'Status', type: 'string', sql: 'status' } }` | `dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } }` |
| an inner `name` that DIFFERS from its key, e.g. `totalAmount: { name: 'total_amount', … }` | nothing changes at runtime — `orders.totalAmount` was already the name every query used. Delete the inner `name`, or, if `total_amount` is the name you meant, re-key the member and update every query, dashboard and report that names `orders.totalAmount` |

**The one-line fix:** delete `name` from every metric and dimension; the key it is declared under is its name.

**What an author who still writes it sees.** `tsc` fails at the authoring site (`Metric` / `Dimension` type the key `never`), and the parse — `defineCube()`, `defineStack({ analyticsCubes })`, `PUT /api/v1/meta/analytics_cube/:name` — refuses it at `measures.<key>.name` / `dimensions.<key>.name` with the prescription:

> `measures.<metric>.name` was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — it never had an effect: the record key is the metric's name. … Delete the key. To rename a metric, rename its key in `measures` — and every query, dashboard and report that names `<cube>.<key>`. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.

`os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.

## The retirement kit

- **`retiredKey()` tombstones, not a bare deletion** — even though both member shapes are `strictObject`s (the `action.aria` posture). A bare delete would still be loud, but only as a generic unrecognized-key report that cannot carry the prescription; the tombstone types the key `never` for `tsc` and raises the upgrade text at parse. The keys therefore stay in the walked shape: both liveness rows stay `dead` with a `REMOVED` note, and the authorable-surface baseline marks `data/Metric:name` and `data/Dimension:name` `[RETIRED]`.
- **The D2 conversion `cube-member-inner-name-removed`** (protocol 18, retired from the load path) deletes the inner `name` from every metric and dimension of every `analyticsCubes[]` entry. It is owed because the key was REQUIRED, so every stored or built cube carries it. It strips a disagreeing value too — the key already won everywhere, so no query or discovery answer changes — and its notice prints both spellings (`from: name "total_amount"`, `to: (removed; the record key "totalAmount" is the name)`). Its D3 record is the semantic entry `cube-member-inner-name-retired`, which asks the author of a disagreeing name which spelling they meant.
- **The producers stop writing it** (`@objectstack/service-analytics`): the dataset compiler (`compileDataset`), `CubeRegistry.inferFromObject` and the ad-hoc query mint no longer put an inner `name` on the members of the cubes they build. The members are filed under the same keys as before, so `/analytics/meta`, `/analytics/query` and `/analytics/sql` answer exactly as they did. The package README's cube example is corrected.
- **The `measures` / `dimensions` descriptions now say it**: "keyed by metric name: the record key IS the metric's name, published and queried as `<cube>.<key>`".

## Reach, measured

- This repository, non-test: the showcase cube (`examples/app-showcase`, 8 members), the published `objectstack-ui` skill's `defineCube` example (6), the `service-analytics` README (3), and the three internal cube mints above — every one wrote the inner `name` EQUAL to its key, and all are corrected here. Test fixtures: about 300 member literals and map-built members across 84 test and fixture files in eight packages, all EQUAL to their key except 21 in `driver-memory`, which disagreed (camelCase key, snake_case inner name) and were already queried by key.
- Out-of-repo authors: NOT MEASURED.

## What an operator with a STORED cube sees

A `sys_metadata` `analytics_cube` row or a built artifact written before this release carries the inner `name` on every member. Nothing breaks at read: the conversion replays on rehydration and at the artifact door and strips it, so the cube is served canonical and parses. `os migrate meta --stored --apply` rewrites the rows.

<!-- adr-0087: registered cube-member-inner-name-removed, cube-member-inner-name-retired -->
