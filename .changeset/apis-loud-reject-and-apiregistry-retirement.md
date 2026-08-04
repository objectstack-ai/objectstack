---
"@objectstack/spec": major
"@objectstack/core": major
"@objectstack/plugin-hono-server": major
"@objectstack/runtime": major
"@objectstack/metadata-protocol": patch
---

feat(spec,core,runtime)!: declarative `apis:` refuses loudly instead of parsing into silence; the `ApiRegistry` family retires (#4936, #4939)

The declarative API-endpoint surface was **zero-execution end to end**, and said nothing
about it. Metadata loading worked perfectly — a stack declared `apis:`, `defineStack`
accepted it, and `GET /api/v1/meta/api` returned every endpoint with every key intact.
The execution side never fired once. On a real boot (showcase, 47 plugins) both declared
paths answered a bare `404 {"error":"Not found"}` — not even the dispatcher's semantic
404, because **no route was ever mounted** for a declared path, so the request died at
Hono's `notFound`. Behind that, the dispatcher's `handleApiEndpoint` branch resolved the
metadata service and called `matchEndpoint` on it — a method **no implementation in the
repo has ever provided**. The branch returned "not handled" on every request ever served.

So every key on `ApiEndpointSchema` was declared ≠ enforced: `path`/`method` (never
mounted), `type`/`target`/`objectParams` (never executed), `cacheTtl`,
`inputMapping`/`outputMapping`, `rateLimit`, `summary`/`description` — and
**`authRequired`**, a security semantic that parsed green and gated nothing at all. That
is false compliance, the failure ADR-0049 exists to stop, not debt.

## BREAKING — a non-empty `apis:` is now rejected

Metadata that parsed cleanly before is now **refused at publish/validate**, with the
prescription in the rejection itself:

```
apis: `apis:` (declarative ApiEndpoint) is DECLARED BUT NOT EXECUTABLE in this runtime,
so a non-empty array is rejected instead of silently accepted (#4936). …
```

**FROM → TO.** `apis: [ …endpoints… ]` → `apis: []` (or delete the key; both are still
accepted, and an empty array is not a special case). To actually serve the route today,
mount it **in code** — a plugin manifest `contributes.routes` entry, or an `http.server`
route. That is now the only honest path, and the one `examples/app-showcase` uses
(`src/system/server/recalc-endpoint.ts`).

The refusal lives on `ObjectStackDefinitionSchema` itself, which is the single choke
point every path runs through — `defineStack`, the metadata plugin's artifact ingestion,
`os validate`, the lint scorer and `EnvironmentArtifactSchema`. There is no path that
forgot to check.

**The `ApiEndpoint` vocabulary is deliberately KEPT.** Retiring it was considered and
rejected: endpoint shapes are an industry-stable form, so a retirement would only mean
re-introducing the identical schema later. Your endpoint definitions stay valid TypeScript
and stay in the spec; only *authoring them into a stack* is refused, and only until the
executor lands. Keep them commented next to your stack — that is what the showcase does.
The executor (route mounting + endpoint matching + per-key wiring for
`authRequired`/`cacheTtl`/`inputMapping`/`outputMapping`/`rateLimit`) is tracked by
**#5040**, which replaces this rejection with real execution.

## BREAKING — the `ApiRegistry` / `ApiEndpointRegistration` family is removed (#4939)

The repo carried a **second**, unrelated declaration shape for "an API endpoint":
`ApiEndpointRegistrationSchema` and the ~500-line `ApiRegistry` service that
`createApiRegistryPlugin()` registered under `api-registry`. Nothing composed it — every
assembly site lived in `packages/core/examples/`, with no registration in
`packages/runtime`, `packages/cli` or any `examples/app-*`, and a real boot carried no
such service. The whole family was therefore inert, including
`ApiEndpointRegistration.requiredPermissions`, whose docs promised **in the present tense**
that "the gateway layer automatically validates these permissions" while no gateway read
it. Two declaration shapes, both dead; this retirement converges them on one.

Removed from `@objectstack/spec/api`: `ApiEndpointRegistration(Schema)`,
`ApiRegistry(Schema)`, `ApiRegistryEntry(Schema)`, `ApiMetadataSchema`,
`ApiParameterSchema`, `ApiResponseSchema`, `ApiDiscoveryQuerySchema`,
`ApiDiscoveryResponseSchema`, `ApiProtocolType`, `HttpStatusCode`,
`ObjectQLReferenceSchema`, `SchemaDefinition` (12 JSON-Schema defs, 67 authorable keys).
Removed from `@objectstack/core`: `ApiRegistry`, `createApiRegistryPlugin`.
Removed from `@objectstack/plugin-hono-server`: the `useApiRegistry` option — it was
defaulted to `true` and read by nothing, configuring a service that was never composed.

**FROM → TO.** There is no replacement shape to migrate to, because nothing executed the
old one: delete the registration objects. If you were assembling an `ApiRegistryEntry`,
you were building a value only your own code read — keep it as your own type. Declarative
endpoints have one vocabulary now, `ApiEndpointSchema`.

`ConflictResolutionStrategy` **survives** the removal and moved to
`@objectstack/spec/api`'s `router.zod` — same name, same four values
(`error`/`priority`/`first-wins`/`last-wins`), same import path. It is pinned there by two
independent ratchets and is not part of the retired surface.

## Also in this change

- **BREAKING (`@objectstack/runtime`):** `HttpDispatcher.handleApiEndpoint()` is deleted,
  along with its now-orphaned private `callData` delegate, and `/__api-endpoint` leaves
  `LEGACY_CHAIN_PREFIXES` and the route ledger. The method was public, so this is an API
  removal — but it returned `{ handled: false }` for every call it ever received, so no
  caller can observe a behaviour change beyond the missing symbol. Delete the call.
  Absence is now loud (ADR-0076): the surface is refused at authoring rather than 404ing
  at runtime with dead code behind it.
- `examples/app-showcase` no longer declares endpoints, and its coverage manifest no
  longer claims the capability is `demonstrated` — that entry read "executed by the runtime
  dispatcher (handleApiEndpoint)", which was exactly the advertise-what-you-don't-deliver
  claim Prime Directive #10 forbids.
- The endpoint-level `rateLimit` tracking pointers left by #4910/#5006 now name **#5040**,
  the live executor card, instead of #4936, which closes with this change.
