---
"@objectstack/rest": patch
"@objectstack/service-settings": patch
"@objectstack/service-datasource": patch
---

fix(rest,service-settings,service-datasource)!: four more route modules emit the declared envelope, and the guard is now shared (#3843)

#3675 and #3689 moved `service-storage` and `service-i18n` onto the declared
response envelope (`BaseResponseSchema` + `ApiErrorSchema`). Each scoped itself
to one service, and neither asked whether the same drift existed elsewhere. It
did — in four more modules, and in two of them it was the *older* shape, the one
#3675 had already declared wrong:

| Module | before | now |
|---|---|---|
| `service-settings/settings-routes.ts` | nested `error`, no `success` on any of 5 bodies | full envelope |
| `service-datasource/admin-routes.ts` | `{ error: '<string>' }`, `message` a **sibling** | full envelope |
| `rest/external-datasource-routes.ts` | `{ error: '<string>' }` + a private `ok` | full envelope |
| `rest/package-routes.ts` | 3 of 16 bodies had `success`, 2 failures had no `error` at all | full envelope |

## Breaking: where to read things now

**Success payloads move under `data`.** The keys are unchanged — only their
depth. `unwrapResponse` in `ObjectStackClient` returns `body.data` when the flag
is present, so every SDK method (`packages.list()`, `datasources.external.*`)
resolves to exactly the object it always did. Raw `fetch` callers must add one
hop:

```
GET  /api/v1/datasources            body.datasources     → body.data.datasources
GET  /api/v1/datasources/drivers    body.drivers         → body.data.drivers
GET  /api/v1/datasources/:name      body.datasource      → body.data.datasource
GET  /api/v1/packages               body.packages        → body.data.packages
GET  /api/v1/packages/:id           body.package         → body.data.package
GET  /api/settings                  body.manifests       → body.data.manifests
GET  /api/settings/:ns              body.manifest/.values → body.data.manifest/.values
POST /…/external/validate           body.ok, body.results → body.data.ok, body.data.results
```

`SettingsNamespacePayloadSchema` and friends still describe those payloads
exactly; they now describe the envelope's `data` rather than the whole body.

**Error bodies stop being a string.** `{ error: 'datasource_admin_error',
message }` → `{ success: false, error: { code: 'datasource_admin_error',
message } }`. Read `body.error.message`, not `body.message`; read
`body.error.code`, not `body.error`. This is the asymmetry #3675 opened on: a
caller reading `body.error.message` previously got the real message from the
dispatcher and `undefined` from these routes.

**Two failures that never said why now do.** `DELETE /api/v1/packages/:id`
answered a bare `{ success: false }` and a bare
`{ success: false, failed, cleanups }`. They are now `PACKAGE_DELETE_FAILED` and
`PACKAGE_DELETE_PARTIAL`, with the per-item `failed` / `cleanups` arrays under
`error.details`.

**Codes: carried over, not renamed.** `admin-routes.ts` and
`external-datasource-routes.ts` keep their existing lowercase snake codes
(`datasource_admin_unavailable`, `external_service_unavailable`, `not_found`, …)
even though they sit beside SCREAMING_SNAKE in the already-converted siblings.
Which vocabulary wins is #3841's call — a decision about ~240 codes repo-wide —
and re-spelling nine of them here would pick that dialect by accident. Only
`package-routes.ts` needed *minted* codes, because its `error` strings were human
messages with no code to carry; those follow the SCREAMING_SNAKE the two
converted siblings emit and #3841 will re-spell them with everything else. This
is the envelope only, the same split #3687 / #3837 made deliberately.

**`POST /external/validate` keeps its `ok`.** Unlike the `{ ok: true, key }`
#3689 retired from storage — a private second word for `success` — this `ok` is a
computed verdict over the federated objects (`results.every(r => r.ok)`). The
request can succeed while the verdict is false, so the two flags are not the same
field; `ok` moves inside `data` rather than being dropped.

Consumers were taught both shapes first, so the two repos are not coupled by
merge order: objectui's `packages` readers were already tolerant
(`payload?.data ?? payload`), and its datasource page plus the generic
`type: 'api'` action runner now unwrap the envelope and read `error.message`
(the latter previously toasted `[object Object]` for any nested error).

## The guard is shared now, not copied

New private `@objectstack/route-envelope-conformance` (`packages/qa/route-envelope`)
exports one pure `checkRouteEnvelope(source) => finding[]`. Its load-bearing
assertion is structural rather than per-route: **count the `.json(` call sites**.
When every body goes through the `sendOk` / `sendError` pair, that count is fixed
at two and does not grow with the route list — so a *future* route that
hand-rolls a body fails the guard, which is the coverage a driven test can never
give.

This existed three times already as an open-coded regex block (storage error,
storage success, i18n error); the third copy was the signal it wanted lifting
(#3843 option 3, done before the conversions). All three now delegate to it, as
do the four new per-module suites. The shared version also fixes a real bug in
the copies: they stripped comments with `String.replace`, which also ate `//`
inside string literals and silently truncated the rest of that line —
`.json(` calls included. A guard that under-counts call sites passes while drift
ships, which is the failure mode this issue is about. The shared scanner
tokenizes properly and pins that case in its own suite.

**One ratchet, stated rather than hidden.** `i18n-service-plugin.ts` is declared
at `jsonCallSites: 5, successBuilders: 4`. Its error half *is* consolidated
(#3675), but each of its four read routes builds `{ success: true, data }`
inline. Those bodies are correct — that is not envelope drift — but an
unconsolidated builder is a weaker guard: a fifth read route could get the shape
wrong and only a driven test would notice. The numbers pin today's structure
exactly (a new inline body fails), and consolidating behind a `sendOk` drives
them to the 2 / 1 the other five modules use.
