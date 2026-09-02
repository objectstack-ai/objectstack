---
"@objectstack/spec": patch
---

chore(spec): govern the four `RestServerConfig` sub-objects in the liveness ledger (#14369)

The `liveness/` ledgers ship inside this package's npm tarball (they are named in
`files`), so this is a published-data change even though no runtime behaviour
moves, no schema key changes spelling, and `packages/spec/src/api/rest-server.zod.ts`
is not edited at all.

Four new ledger files — `crud_endpoints.json`, `metadata_endpoints.json`,
`batch_endpoints.json`, `route_generation.json` — classify all 32 authorable
properties of `CrudEndpointsConfigSchema`, `MetadataEndpointsConfigSchema`,
`BatchEndpointsConfigSchema` and `RouteGenerationConfigSchema`, the four
`RestServerConfig` sub-objects a host writes when it constructs the REST server.
They are enrolled through the gate's `SPEC_ONLY_SCHEMAS` override, the route
`query` / `qa` / `manifest` already take: server configuration is neither a
metadata item nor a request body nor a manifest, so no registry has ever held it
and no ratchet rooted in one could ask who reads it.

Seventeen properties are `live` with a symbol-anchored consumer and a producer
pointer at the normalizer that threads the authored value into `this.config`.
Fifteen are `dead` — the ten keys the census filed with this card measured, with
the two container keys (`crud.patterns`, `routes.overrides`) expanded into a row
per member. `routes` is dead entire: `excludeObjects: ['sys_log']` excludes
nothing and `nameTransform: 'plural'` still mounts every route under the raw
object name. `metadata.endpoints.schema` and `batch.operations.upsertMany` are
switches for routes that were never built — no path ending in `/schema` is
mounted anywhere in `packages/rest/src`, and the protocol has no `upsertManyData`
counterpart to its three sibling batch methods.

What this records, and what it deliberately does not. #11984 made
`RestServer.normalizeConfig` PARSE and CONSUME these four sub-objects instead of
casting them, so an out-of-enum or out-of-range value is now refused at
construction. That settles accept/reject and nothing else: executing a declared
contract does not give a key a consumer. No key is removed, enforced, deprecated
or re-described here. The enforce-or-remove call per dead key (ADR-0049) is a
follow-up on the human floor — the enforce route is a feature per key, and
`routes.excludeObjects` is advertised in `RestServerConfigSchema`'s own
`@example`, which makes its removal a capability retirement rather than a cleanup.

Rooted on the four sub-schemas rather than on `RestServerConfigSchema` itself,
which is measurement rather than taste: the ledger walk drills exactly ONE level,
so with the whole config as the root the sub-objects would BE the drilled level
and `metadata.endpoints.schema` / `batch.operations.upsertMany` would have no row
of their own — their container's blanket `live` (three of four members gate a real
route mount) silently covering a dead key, which is the #4956 shape in the file
written to end it. `RestApiConfigSchema` (the fifth sub-object, `api`) is not
enrolled: its consumption seam is still validate-only and is the subject of its
own card, so a census of it would record a half that is about to move.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or re-described: this change adds ledger rows and a gate enrolment, and every key it classifies keeps the exact spelling, type, default and describe() it had. There is no source for `objectstack migrate meta` to rewrite, because no author's config becomes invalid or becomes valid as a result. -->
