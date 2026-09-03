---
"@objectstack/spec": minor
"@objectstack/rest": minor
---

feat(spec): retire the ten inert `RestServerConfig` keys the liveness ledger recorded as `dead` (#14691, ADR-0049 enforce-or-remove)

<!-- adr-0087: registered rest-server-config-dead-keys-retired -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the prescription is registered
under protocol major 18, where `os migrate meta` users will look).

#14369 enrolled the four `RestServerConfig` sub-objects (`crud`, `metadata`,
`batch`, `routes`) in the spec liveness ledger and found 15 of their 32 rows
`dead`: parsed, defaulted and normalized into the REST server's config by
`normalizeConfig` (#11984) and never read back. This change is the
enforce-or-remove call on every one of them, taken per family, and every
family resolved to REMOVE — each promised capability either already exists at
its proper seat or would contradict a fixed contract. The closed-set cloud
sweep (#14796, `objectstack-ai/cloud` @ `9b6abe0f2fd5`) returned zero hits,
structurally: cloud never authors a `RestServerConfig`.

**What is refused:** authoring any of the ten keys below. Each is a
`retiredKey()` tombstone (all four sub-schemas are non-strict `z.object()`s,
so a plain deletion would have silently stripped the key), so authoring it is
a `tsc` error and a parse error carrying the prescription — and, because
`RestServer` parses these sub-objects at construction (#11984),
`new RestServer(...)` / `createRestApiPlugin().start()` now refuse a config
that carries one, naming the sub-object, the key and the declaring schema.

**FROM → TO** (delete the key in every case; none ever had an effect to preserve):

- `crud.patterns` → the mounted CRUD paths are the contract the client SDK, the
  discovery document and the served `/openapi.json` all describe; `crud.dataPrefix`
  moves them deployment-wide. An endpoint on a custom path or method is a
  declarative `api` endpoint (`type: 'object_operation'`). Its value schema
  `CrudEndpointPatternSchema` / type `CrudEndpointPattern` are removed with it
  (no other consumer; `CrudOperation` stays — `GeneratedEndpoint.operation` reads it).
- `crud.objectParamStyle` → the object name is always a path segment.
- `metadata.cacheTtl` → `metadata.enableCache` is the live switch (it selects the
  protocol's `getMetaItemCached` path, which takes no TTL); a declarative `api`
  endpoint's `cacheTtl` is the key that reaches the wire. The unbounded negative
  TTL this key accepted goes with it.
- `metadata.endpoints.schema` → gated `GET /meta/:type/:name/schema`, which does
  not exist; `endpoints.types` / `items` / `item` gate real mounts and stay.
- `batch.operations.upsertMany` → gated `POST /data/:object/upsertMany`, which
  was never built; upsert is an operation type of the generic
  `POST /data/:object/batch` endpoint (`BatchOperationType` `'upsert'`), gated
  by `batch.enableBatchEndpoint`.
- `batch.defaultAtomic` → atomicity is the per-request `options.atomic`
  (ADR-0119 D4, opt-in); a server-side default that flipped it silently would
  change the failure semantics of callers who send nothing, which that ADR
  refused. Callers that need all-or-nothing send `options: { atomic: true }`.
- `routes.includeObjects` / `routes.excludeObjects` / `routes.overrides`
  (`enabled` / `basePath` / `operations`) → per-object API exposure is declared
  ON the object and enforced by the REST data surface: `enable.apiEnabled: false`
  hides it (404), `enable.apiMethods` whitelists its operations (405). The data
  base path is deployment-wide (`crud.dataPrefix`).
- `routes.nameTransform` → the object `name` is the canonical id on every
  surface, the REST path segment included; there is no URL transform to configure.

**What stays, byte-identical:** every live key of the four sub-objects —
`crud.operations.*`, `crud.dataPrefix`, `metadata.prefix` / `enableCache` /
`maskObjectFields` / `endpoints.types|items|item`, `batch.maxBatchSize` /
`enableBatchEndpoint` / `operations.createMany|updateMany|deleteMany` — with
its default and its mount. The mounted REST surface does not change: none of
the ten keys ever reached it. `@objectstack/rest`'s normalized config no longer
carries the retired keys (they were written and never read), and the #11984
pins of their accept/reject behaviour are reversed to refusal pins, by design.

The retirement kit: `retiredKey()` tombstones on the four sub-schemas;
`RestServerConfigSchema`'s `@example` no longer advertises
`routes: { excludeObjects: [...] }`; ledger rows kept `dead` with a REMOVED
note and `evidenceScope: cross-repo` (the two container rows collapse into one
each, since their child keys left the walked shape); `RETIRED_KEYS_BY_MAJOR[18]`
× 10 and `RETIRED_DEFS_BY_MAJOR[18]` `api/CrudEndpointPattern`; D3 semantic
entry `rest-server-config-dead-keys-retired`. No D2 conversion: a
`RestServerConfig` is plugin TS configuration (REST plugin constructor /
`plugin-hono-server` `restConfig`), never a stack collection member or a
`sys_metadata` row (the `openApi31` precedent, #4579), so there is no source
for the chain to rewrite and the prescription carries no `os migrate meta`
sentence.
