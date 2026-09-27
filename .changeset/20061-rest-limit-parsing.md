---
'@objectstack/rest': minor
---

fix(rest): four published doors refuse a `?limit=` they cannot read with `400 VALIDATION_FAILED`, instead of substituting, clamping or dropping it and answering `200` (#20061, #20062)

Clause-②: no (narrowing)

**BREAKING**: shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA). The banner and the ADR-0087
disposition below carry the breaking-ness, not the level.

`GET /data/import/jobs`, `GET /data/:object/export`, `GET /meta/:type/:name/history`
and `GET /search` read `?limit=` with a bare `Number()`. That coercion does not
fail. It invents a value, and the door served it with a `200`:
- `?limit=0` on the import-job history answered the 50-row default against a
  declaration of `min(1).max(200)`;
- `?limit=abc` on the export downloaded one row;
- on the metadata history it returned the whole change log;
- on search it removed the overall cap.

Since `@objectstack/client` sends `limit` exactly as the caller wrote it, the door
is the only place such a value can be refused.

Each door now reads the parameter against its own declaration:
- **`GET /data/import/jobs`** reads `limit` and `offset` through
  `ListImportJobsRequestSchema` (`limit` `int().min(1).max(200)`, default 50;
  `offset` `int().min(0)`, default 0).
- **`GET /meta/:type/:name/history`** reads `limit` through
  `HistoryMetaItemRequestSchema.limit` (`z.number()`, so any finite number, as
  before).
- **`GET /data/:object/export`** and **`GET /search`** declare no request schema.
  There `limit` must be a whole number. Their range handling is unchanged: the
  export floor of 1 and cap of 50000, and search's `[1, 100]` clamp.

A value outside the declaration answers `400` with the data surface's existing
envelope, `{ error, code: 'VALIDATION_FAILED', fields }`. `fields[0].field` names
the parameter. `fields[0].code` is the ADR-0114 member for the failed constraint:
`invalid_type` for a value that is not a number (or not a whole one, where one is
required), `min_value` or `max_value` for one outside a declared bound. The
service is never called.

What changes, per door (every row answered `200` before):

| door | request | answered before | answers now |
|:--|:--|:--|:--|
| `GET /data/import/jobs` | `?limit=0`, `?limit=-3` | 50 rows / 1 row | `400`, `min_value` |
| `GET /data/import/jobs` | `?limit=201`, `?limit=500` | 200 rows | `400`, `max_value` |
| `GET /data/import/jobs` | `?limit=abc`, `?limit=1.5`, `?limit=Infinity` | 50 / 1.5 / 200 rows | `400`, `invalid_type` |
| `GET /data/import/jobs` | `?offset=-1`, `?offset=abc`, `?offset=1.5` | offset 0 / 0 / 1.5 | `400`, `min_value` / `invalid_type` |
| `GET /data/:object/export` | `?limit=abc`, `?limit=` (empty) | a one-row export | `400`, `invalid_type` |
| `GET /data/:object/export` | `?limit=1.5`, `?limit=Infinity` | limit 1.5 / capped to 50000 | `400`, `invalid_type` |
| `GET /meta/:type/:name/history` | `?limit=abc`, `?limit=Infinity` | the whole change log | `400`, `invalid_type` |
| `GET /meta/:type/:name/history` | `?limit=` (empty) | zero events | `400`, `invalid_type` |
| `GET /search` | `?limit=abc` | no overall cap | `400`, `invalid_type` |
| `GET /search` | `?limit=1.5`, `?limit=Infinity` | a cap of 1.5 / 100 | `400`, `invalid_type` |

A blank value such as `?limit=%20` is refused on every door.

**Unchanged:**
- An absent `limit` keeps each door's default: 50 jobs, a 10000-row export, the
  full history, search's 20.
- An empty `?limit=` on the import-job history and on search still means absent,
  as it always did there.
- Every conforming value reaches the service exactly as before, including the
  ranges no card here takes a position on: export `?limit=0` still exports one
  row, search `?limit=500` is still clamped to 100, and history still forwards
  `0` or `1.5` because its declaration admits them.

**Fix for a caller that now gets the `400`:** send `limit` as a whole number, within
the declared range where the door declares one (`1`–`200` for import jobs), or
omit it to get the door's default.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: no spec key, metadata property or exported symbol is added, removed or renamed, and `packages/spec` is untouched, so `objectstack migrate meta` has nothing to rewrite and no ADR-0087 registry gains a row. What narrows is the set of HTTP query values four REST doors accept, back to what their declarations (`ListImportJobsRequestSchema`, `HistoryMetaItemRequestSchema`) or a whole-number reading already said. A query string is neither authored nor persisted. The other categories are closed on facts: `@objectstack/rest` publishes (not `unpublished`), no ADR-0087 id covers an HTTP query value (not `registered` / `already-registered`), and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
