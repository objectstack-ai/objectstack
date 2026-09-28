---
'@objectstack/rest': minor
---

fix(rest): the remaining numeric query reads refuse a value they cannot read with `400 VALIDATION_FAILED`, instead of dropping it or handing on `NaN` and answering `200` (#20139)

Clause-②: no (narrowing)

**BREAKING**: shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA). The banner and the ADR-0087
disposition below carry the breaking-ness, not the level.

Five published doors still read a numeric query parameter with a bare `Number()`.
That coercion does not fail. It invents `NaN` or `0`, and the door dropped it or
served it with a `200`:
- `GET /meta/:type/:name/history?sinceSeq=abc` read the change log from the start;
- `GET /meta/:type/:name/audit?limit=abc` served the producer's default 100 events;
- `GET /meta/:type/:name/diff?from=abc` diffed a different pair of versions;
- `GET /search?perObject=abc` removed the per-object cap;
- `GET /approvals/requests?limit=abc` served the unpaged 500-row window instead of a page.

Each door now reads the parameter the way `?limit=` on import jobs, export, history and
search already does:
- **`GET /meta/:type/:name/history`** reads `sinceSeq` through
  `HistoryMetaItemRequestSchema.sinceSeq` (`z.number()`, so any finite number, as before).
- **`GET /meta/:type/:name/audit`** reads `limit` through
  `AuditMetaItemRequestSchema.limit` (`z.number()`; the implementation's `[1, 500]`
  clamp is unchanged).
- **`GET /meta/:type/:name/diff`** (`from` / `to`, and their `fromVersion` /
  `toVersion` spellings), **`GET /search`** (`perObject`) and
  **`GET /approvals/requests`** (`limit` / `offset`) declare no request schema. There the
  value must be a whole number. Each service's own range handling is unchanged.

A value the door cannot read answers `400` with the data surface's existing envelope,
`{ error, code: 'VALIDATION_FAILED', fields }`. `fields[0].field` names the parameter as
the caller spelled it, and `fields[0].code` is `invalid_type`. The service is never
called. On `GET /approvals/requests` this is a `400`, not the route's
`500 APPROVAL_REQUEST_LIST_FAILED`.

What changes, per door (every row answered `200` before):

| door | request | answered before | answers now |
|:--|:--|:--|:--|
| `GET /meta/:type/:name/history` | `?sinceSeq=abc`, `?sinceSeq=Infinity` | the change log from the start | `400`, `invalid_type` |
| `GET /meta/:type/:name/history` | `?sinceSeq=` (empty) | `sinceSeq: 0` applied as a cursor | `400`, `invalid_type` |
| `GET /meta/:type/:name/audit` | `?limit=abc`, `?limit=Infinity` | the default 100 events | `400`, `invalid_type` |
| `GET /meta/:type/:name/audit` | `?limit=` (empty) | one event | `400`, `invalid_type` |
| `GET /meta/:type/:name/diff` | `?from=abc`, `?from=Infinity` | the version before `to`, diffed instead | `400`, `invalid_type` |
| `GET /meta/:type/:name/diff` | `?to=abc` | the current body, diffed instead | `400`, `invalid_type` |
| `GET /meta/:type/:name/diff` | `?from=1.5`, `?to=2.5` | a diff against a version that cannot exist | `400`, `invalid_type` |
| `GET /search` | `?perObject=abc` | no per-object cap | `400`, `invalid_type` |
| `GET /search` | `?perObject=1.5`, `?perObject=Infinity` | a cap of 1.5 / clamped to 25 | `400`, `invalid_type` |
| `GET /approvals/requests` | `?limit=abc`, `?limit=Infinity` | the unpaged 500-row list, no `total` | `400`, `invalid_type` |
| `GET /approvals/requests` | `?limit=` (empty) | a one-row page | `400`, `invalid_type` |
| `GET /approvals/requests` | `?offset=abc` | the first page | `400`, `invalid_type` |
| `GET /approvals/requests` | `?offset=` (empty) | the service's 50-row paged mode | `400`, `invalid_type` |
| `GET /approvals/requests` | `?limit=1.5`, `?offset=1.5` | 1.5 handed to the engine | `400`, `invalid_type` |

A blank value such as `?sinceSeq=%20` is refused on every one of these doors.

**Unchanged:**
- An absent parameter keeps each door's default: the history log from the start, the
  audit trail's 100 events, previous-vs-current on `/diff`, search's 5 per object, and the
  unpaged approvals list.
- An empty `?perObject=`, `?from=` or `?to=` still means absent, as it always did there.
- Every conforming value reaches the service exactly as before, including the ranges no
  card here takes a position on: history still forwards `sinceSeq=0` or `1.5`, audit still
  forwards `limit=0` or `900` to its own clamp, `/diff` still forwards `from=0`, search
  `perObject=50` is still clamped to 25, and approvals `limit=0` / `offset=-1` still reach
  the service's own clamp.
- `GET /data/:object/export?page=` is unchanged. It sets only the export's chunk size, and
  no value of it changes the rows exported.
- `POST /meta/:type/:name/rollback` `toVersion` is unchanged. It already refused an
  unreadable value with `400 INVALID_REQUEST`.

**Fix for a caller that now gets the `400`:** send the parameter as a number (a whole
number on `/diff`, search and approvals), or omit it to get the door's default.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: no spec key, metadata property or exported symbol is added, removed or renamed, and `packages/spec` is untouched, so `objectstack migrate meta` has nothing to rewrite and no ADR-0087 registry gains a row. What narrows is the set of HTTP query values five REST doors accept, back to what their declarations (`HistoryMetaItemRequestSchema`, `AuditMetaItemRequestSchema`) or a whole-number reading already said. A query string is neither authored nor persisted. The other categories are closed on facts: `@objectstack/rest` publishes (not `unpublished`), no ADR-0087 id covers an HTTP query value (not `registered` / `already-registered`), and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
