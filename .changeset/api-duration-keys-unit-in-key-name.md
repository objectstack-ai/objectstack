---
"@objectstack/spec": minor
"@objectstack/runtime": patch
---

feat(spec)!: the twelve `api/` duration keys carry their unit in the key name (#15677, ruling B on #14478)

<!-- adr-0087: registered api-endpoint-cache-ttl-to-cache-ttl-seconds, api-error-retry-after-unit-in-key, api-runtime-config-durations-unit-in-key, device-request-response-interval-unit-in-key, rest-api-plugin-durations-unit-in-key, websocket-durations-unit-in-key -->

**BREAKING** — twelve published `api/` duration keys are renamed and tombstoned.
Shipped as `minor` under the repo's launch-window convention for breaking
changes; the hand-migration prescriptions are registered under protocol major
18. Maintainer ruling B on #14478 (2026-09-02, decision batch #43, 「同意」).

`check:duration-unit-keys` makes a duration-shaped `z.number()` carry its unit
in the key NAME, never only in its `.describe()` prose, and grandfathers no
existing offender. Stack card 1/6 (#15676) landed the rule's two structural
exemptions; this card clears the `api/` directory against it. Measured with the
gate itself: `src/api/**` goes from 12 offenders to **0**, and the whole-tree
count falls **48 → 36**.

## FROM → TO

| key | replacement | unit |
|:--|:--|:--|
| `ApiEndpoint.cacheTtl` | `cacheTtlSeconds` | seconds |
| `DataLoaderConfig.cacheTtl` | `cacheTtlSeconds` | seconds |
| `DeviceRequestResponse.interval` | `intervalSeconds` | seconds |
| `EnhancedApiError.retryAfter` | `retryAfterSeconds` | seconds |
| `RestApiEndpoint.timeout` | `timeoutMs` | milliseconds |
| `RestApiEndpoint.cacheTtl` | `cacheTtlSeconds` | seconds |
| `RestApiPluginConfig.performance.defaultCacheTtl` | `defaultCacheTtlSeconds` | seconds |
| `RouteDefinition.timeout` | `timeoutMs` | milliseconds |
| `WebSocketConfig.reconnectInterval` | `reconnectIntervalMs` | milliseconds |
| `WebSocketConfig.pingInterval` | `pingIntervalMs` | milliseconds |
| `WebSocketConfig.timeout` | `timeoutMs` | milliseconds |
| `WebSocketServerConfig.heartbeatInterval` | `heartbeatIntervalMs` | milliseconds |

**Every value is unchanged** — only key names move. Every old spelling is a
`retiredKey()` tombstone, so it fails `tsc` at the authoring site (input type
`never`) and fails the parse with the rename prescription rather than a bare
unrecognized-key error.

## ⚠️ `ApiError.retryAfter` — the wire envelope, and what it does NOT touch

Ruling B put this key explicitly in scope with its own BREAKING note: the
runtime-emitted measurements are read by humans and agents even though nobody
authors them. A consumer meets two retry-after values on one 429 — this
ADR-0112 envelope field, always delta-seconds, and the HTTP `Retry-After`
header, which per RFC 9110 §10.2.3 may carry delta-seconds **or** an HTTP-date.
Spelled identically they read as one value in two places.

**The HTTP `Retry-After` response header is a separate, unchanged surface.** Its
name is fixed outside this repo and nothing here touches it. Do not "fix" the
header to match the envelope, and do not read a surviving `retry-after` in
transport code as leftover work.

## Dispositions — one D2 conversion, five semantic entries

Justified per key rather than defaulted. **`ApiEndpoint.cacheTtl` is the only
one of the twelve that gets an ADR-0087 D2 conversion**
(`api-endpoint-cache-ttl-to-cache-ttl-seconds`), because `apis:` is a stack
collection (`apis: z.array(ApiEndpointSchema)`) and `api` is a registered
metadata kind stored as a row, so the conversion chain has a seam that sees it.
`os migrate meta --from 17` lists the mechanical edits.

The other eleven are wire payloads and construction arguments — a device-flow
response body, an error envelope, REST-plugin route registration, a batch-loader
config, a router registration, WebSocket client/server configuration. None is
ever a stack collection member or a `sys_metadata` row, so no conversion seam
runs on them and each carries a **semantic** entry instead: this is the
disposition `api/RestApiEndpoint:handlerStatus` already holds on one of these
very shapes, and what ruling B prescribes for a runtime-emitted key.

## `DeviceRequestResponse.interval` is a rename, not an external-vocabulary mirror

Attributed to RFC 8628 by the campaign card; the attribution fails against the
schema's own evidence. `DeviceRequestResponseSchema` does not mirror RFC 8628 as
a set — `code` is not `device_code`, `verificationUrl` is not
`verification_uri`, `expiresAt` is not `expires_in` (a different name *and* a
different type, an ISO-8601 instant where the RFC carries a relative lifetime).
A schema that already renames every RFC field it carries into house style cannot
claim the standard fixes the one name it left bare. Renamed rather than marked
deliberately: a wrongly marked key is exempted permanently and silently, while a
wrongly renamed one is visible.

## Readers moved in the same PR, at the same magnitude

`@objectstack/runtime`'s policy chain (`computeCacheControl` now reads
`endpoint.cacheTtlSeconds`), the publish gate's issue path
(`apis.N.cacheTtlSeconds`), the built-in REST route tables, the showcase
example, dogfood fixtures, `liveness/api.json` (renamed row plus a `dead`
tombstone row) and the `objectstack-api` skill. The `ApiEndpoint` alias table is
retargeted onto the live key — an alias must point at a key the schema really
accepts, and `cacheTtl` now accepts nothing.
