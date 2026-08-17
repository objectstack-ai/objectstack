---
"@objectstack/core": patch
---

fix(qa): `HttpTestAdapter` resolves the Data Protocol mount from the server's `/discovery`, and falls back to the convention loudly (#7983)

The record-shaped `os test` action types (`create_record`, `read_record`,
`update_record`, `delete_record`, `query_records`) built their URLs from the
**defaults** of `RestApiConfigSchema.apiPath` and
`CrudEndpointsConfigSchema.dataPrefix`, because the adapter is handed an origin
and nothing else. A deployment that moved the mount got a 404 that reads like the
suite author's own URL mistake rather than a platform limitation.

The adapter now asks the server, following the `getRoute` precedent in
`@objectstack/client`: **one memoised `GET {apiBase}/discovery` per run** (`os
test` builds one adapter for the whole run), addressing whatever `routes.data`
advertises, with the schema-derived convention as the fallback. Measured on a
booted stack (REST route generator + dispatcher bridge), before and after:

| deployment | before | after |
|---|---|---|
| stock | created | created |
| `crud.dataPrefix: '/objects'` | `HTTP Error 404` | created |
| `api.apiPath: '/api/2026-01'` | `HTTP Error 404` | `HTTP Error 404`, now naming the mount |

The `apiPath` row is **not** closed, and the reason is structural: `apiPath`
moves the base that `/discovery` is itself mounted under, so the document that
would name the new mount sits behind the prefix that is missing. The one
discovery document at a fixed path does not rescue it — `/.well-known/objectstack`
advertises the **dispatcher's** `${prefix}/data`, measured as `/api/v1/data`
under all three configs above — so it is deliberately not probed: trusting it
would attach a false provenance ("discovery told us") to the same 404.

Instead that case degrades loudly. Falling back to the convention prints a
warning naming the mount it will address, the probe that failed and the remedy,
and every 404/405 from a record action now carries the mount it addressed and
where that mount came from. `api_call` is unchanged, issues no probe, and remains
the escape hatch for a host the probe cannot reach.
