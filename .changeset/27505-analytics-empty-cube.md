---
'@objectstack/spec': minor
'@objectstack/service-analytics': minor
---

fix(spec)!: `POST /analytics/query` and `POST /analytics/sql` refuse an empty cube name with 400 VALIDATION_FAILED, not 500, and the engine's in-process guard throws the same typed refusal (#27505)

Clause-②: no (narrowing) — `AnalyticsQueryRequestSchema.cube`, the body of the two analytics query doors, refuses the empty string, which it admitted before as "a string". Nothing is widened and no key is added, removed or renamed.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` names a cube only by a real name (`skills/objectstack-ui/SKILL.md`, `rules/dashboards.md` and the `analytics-inline-vs-dataset` eval); no file teaches an empty `cube`, and every taught use stays true.

<!-- adr-0087: registered analytics-query-empty-cube-name-refused -->

**BREAKING** accept-set narrowing at the analytics query doors (`@objectstack/spec`), and the error shape of the engine's own guard (`@objectstack/service-analytics`).

- **Before (`@objectstack/spec@18.2.0`, the last release).** `cube` was `z.string()`, so `{ "cube": "", "measures": ["x.count"] }` passed the body schema at `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql`, reached the engine, and the engine's guard threw a plain `Error` (`Cube name is required …`), which the door mapped to **500 `INTERNAL_ERROR`** — a client input mistake read as a server fault, paged operators and got retried. The same body with `cube` left out answered 400.
- **Now.** `cube` is `z.string().min(1, …)` (JSON Schema `minLength: 1`). An empty cube name is refused at the door, `400 VALIDATION_FAILED` with one `fields[]` entry `{ field: 'cube', code: 'min_length' }` reading the schema's prescription (`Name the cube to query: …`, exported as `ANALYTICS_CUBE_NAME_REQUIRED`), and the engine is never called. A missing `cube` keeps the 400 it already had; its `fields[]` code is now `required` (the door hands the body to the field mapper, so an absent key is reported as absent) where it used to read Zod's `invalid_type` for the same body.
- **`@objectstack/service-analytics`.** `AnalyticsService.query` and `generateSql` refuse an absent or empty `cube` with the same typed refusal — `code: 'VALIDATION_FAILED'`, `status: 400`, `name: 'ValidationError'`, the schema's own sentence, a `fields[]` entry at `cube` — in place of the two plain `Error` throws, so a plugin, flow or test that holds the service reads the answer the door gives, and a boundary that serves the throw (`resolveThrownHttpError`, the dispatcher's error exits) answers 400 rather than 500.
- **Not covered.** `MemoryAnalyticsService` (`@objectstack/driver-memory`), the other `IAnalyticsService` implementation, keeps its plain `Error('Cube name is required')` for the same input in this release; it is a card of its own, not this change.
- **Unchanged.** A non-empty cube name parses and runs as before. A whitespace-only name is a name no cube carries and keeps its `404 CUBE_NOT_FOUND` from the engine; this change adds no trimming rule. Nothing is stored: a cube name travels in a request, never in stack metadata, so there is no row to rewrite.
- **Who sees it.** A dashboard, client or script that sends `cube: ""` — an unset selection or a blank form field — read a 500 before and reads a 400 with the field named now. A test that pinned the old plain-Error text (`Cube name is required`) pins the envelope instead.

**The remedy.** Name the cube to query: a cube `GET /analytics/meta` lists, or a registered object name. There is no mechanical rewrite: an empty string names no cube, so the choice is the caller's.
