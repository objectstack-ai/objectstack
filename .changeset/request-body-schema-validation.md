---
'@objectstack/spec': patch
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

Request bodies are now checked against the schemas the API catalog declares for them (#3899, the request-side dual of #3877).

**Routes that now answer `400 VALIDATION_FAILED` + `fields[]` for a body violating their declared `requestSchema`** (previously the body was consumed raw, and a malformed one silently executed different semantics):

- `POST /data/:object/query` — body must be a QueryAST (`FindDataRequestSchema`); a garbage body used to degrade into an unfiltered full read. The path `object` is now pinned into the forwarded query (a body `object` can no longer contradict the path).
- `POST /data/:object` / `PATCH /data/:object/:id` — body must be a record object (`CreateDataRequestSchema` / `UpdateDataRequestSchema`).
- `POST /data/:object/batch` — body must be a `BatchUpdateRequestSchema` (`operation` + `records[]`).
- `POST /data/:object/createMany` — body must be a bare JSON array of records (`CreateManyDataRequestSchema`); `{ records: [...] }` (updateMany's envelope) is rejected with a pointer.
- `POST /notifications/read` — body must be `{ ids: string[] }` (`MarkNotificationsReadRequestSchema`); a misnamed key used to become `markRead(userId, [])` — a 200 no-op that never cleared the badge.

**Dispatcher automation routes now validate their bodies** (no catalog schema; hand-written guards):

- `POST /automation` and `PUT /automation/:name` require a flow-definition object, and POST requires a non-empty `name` — a mistyped `name` used to register the flow under the key `undefined` and echo 200.
- `POST /automation/:name/toggle` is strictly `{ enabled?: boolean }` — `{"enable": false}` (one letter off) used to ENABLE the flow and answer 200 `{enabled: true}`; it is now a 400 naming the offending key. An empty body still means enable.

**`QuerySchema` now declares the search contract ADR-0061 actually serves** (additive): `search` accepts the canonical bare query string as well as the structured `FullTextSearch` form, and the server-validated `searchFields` narrowing is formally declared. Previously the schema declared only the object form while every surface (and the ADR's own conformance proof) sent the string — drift that surfaced the moment request bodies started being validated.

**Catalog corrections in `@objectstack/spec` (`plugin-rest-api.zod.ts`)** — documentation-only tables:

- `DEFAULT_NOTIFICATION_ROUTES` drops the four device/preferences endpoints — those server routes were removed in #3612 (never built), yet the table kept declaring them, `requestSchema` and all.
- `DEFAULT_AUTOMATION_ROUTES`' trigger endpoint path is corrected `/trigger` → `/trigger/:name` (the mounted path; the flow name rides the path) and its `AutomationTriggerRequestSchema` declaration is removed — that schema never described this route's wire shape.
- `DEFAULT_DATA_CRUD_ROUTES` gains the `POST /:object/query` entry (mounted since forever, previously undeclared), repoints create/update to the schemas the routes actually validate (`CreateDataRequestSchema` / `UpdateDataRequestSchema` — the old `CreateRequestSchema`/`UpdateRequestSchema` names described a `{ data }` envelope the wire never had), and drops `requestSchema` from GET/DELETE entries (path/query-bound inputs; nothing can violate them as a body).
- New gates: catalog `requestSchema`/`responseSchema` strings must resolve to real exported Zod schemas, `requestSchema` may only sit on body-carrying methods, and every declared `requestSchema` on a mounted route has a violating-body → 400 conformance case (`packages/rest` + `packages/runtime` request-schema-gate suites).

Migration: clients that already send the documented shapes are unaffected. If you relied on a malformed body being silently accepted (e.g. posting `{ records: [...] }` to `createMany`, a non-boolean `enabled` to toggle, or an off-schema analytics/query body), fix the request to the declared shape — the 400's `fields[]` names each offending key.
