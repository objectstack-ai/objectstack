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

**Codes follow ADR-0112.** #3841 settled the vocabulary while this was in review:
`error.code` is SCREAMING_SNAKE and `ApiErrorSchema.code` is now the closed
`ErrorCode` union, so an unregistered code fails schema parse. Generic conditions
reuse the STANDARD catalog rather than becoming registered synonyms of it, per the
ledger's own guidance:

```
datasource_admin_unavailable  → SERVICE_UNAVAILABLE      (standard)
external_service_unavailable  → SERVICE_UNAVAILABLE      (standard)
not_found / PACKAGE_NOT_FOUND → RESOURCE_NOT_FOUND       (standard)
PUBLISH_FIELDS_MISSING        → MISSING_REQUIRED_FIELD   (standard)
INTERNAL                      → INTERNAL_ERROR           (standard)
datasource_admin_error        → DATASOURCE_ADMIN_ERROR   (registered)
external_import_error         → EXTERNAL_IMPORT_ERROR    (registered)
PUBLISH_MANIFEST_INVALID      → PACKAGE_MANIFEST_INVALID (registered)
PUBLISH_FAILED                → PACKAGE_PUBLISH_FAILED   (registered)
PACKAGE_DELETE_PARTIAL / PACKAGE_DELETE_FAILED / SETTINGS_ACTION_FAILED (registered)
```

Which service is unavailable is carried by `message`. The seven registered codes are
added to `ERROR_CODE_LEDGER` under their owning packages — including a new
`@objectstack/service-datasource` entry.

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

`scripts/check-route-envelope.mjs` + `pnpm check:route-envelope`, wired into
`lint.yml` alongside the nine sibling `check:*` guards. Its load-bearing assertion
is structural rather than per-route: **it counts the response write sites per
module.** When every body goes through the `sendOk` / `sendError` pair that count
is fixed at two and does not grow with the route list — so a *future* route that
hand-rolls a body fails the guard. That is the coverage a driven-body test can
never give, since it can only drive the routes that existed the day it was
written.

This existed three times already as an open-coded regex block (storage error,
storage success, i18n error). Lifting it did more than deduplicate: a per-package
scan **structurally cannot notice a module nobody thought to convert**, and going
repo-wide found two the moment it ran — neither is in #3843's hand-written survey:

- `plugin-sharing/share-link-routes.ts` — the fifth drifting module. No body
  carries `success`, and one answers `{ ok: true }`, the private second word #3689
  retired from storage. Filed as #3983 and pinned by the guard; converting it is
  breaking for share-link consumers and needs its own sweep.
- `metadata/routes/hmr-routes.ts` — declared **exempt** with a reason (dev-only
  SSE endpoint, not on the SDK surface), not skipped. Three states, deliberately —
  conformant / ratcheted / exempt — because that is the honest classification
  ADR-0049 asks for. A route module the scan finds but the table does not declare
  is an **error**, never a default: applying `2 / 1 / 1` to an unknown module would
  let a new one pass by coincidence.

It also drops the regex for the TypeScript AST, fixing two real bugs the copies
had. They stripped comments with `String.replace`, whose line-comment pattern also
ate `//` inside string literals and truncated the rest of that line — response
writes included. And `.json(` does not mean "write a response": `hmr-routes.ts`
calls `c.req.json()` twice to READ a request body, which a textual count reports as
two unenveloped responses. Comments and literals are not AST tokens, and
request-vs-response is a property of the callee, so both disappear. The script
carries a `--self-test` pinning each case — the nine sibling guards have none, but
both of these bugs survived a review of the regex version.

**The i18n ratchet, stated rather than hidden.** `i18n-service-plugin.ts` is
declared at `responses: 5, ok: 4, err: 1` with a ratchet pointing at #3973. Its
error half *is* consolidated (#3675), but each of its four read routes builds
`{ success: true, data }` inline. Those bodies are correct — that is not envelope
drift — but an unconsolidated builder is a weaker guard: a fifth read route could
get the shape wrong and only a driven test would notice. The numbers pin today's
structure exactly (a new inline body fails) and drop to the conformant `2 / 1 / 1`
when #3973 lands.
