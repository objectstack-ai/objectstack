// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14691 — ADR-0049 enforce-or-remove on the `RestServerConfig` sub-objects,
// executing the #14369 liveness census (15 `dead` rows across the `crud` /
// `metadata` / `batch` / `routes` sub-schemas; 0 read sites in `packages/rest`
// outside `normalizeConfig` and the normalized-config type; objectui @d4c6a86
// clean; cloud @9b6abe0f2fd5 clean STRUCTURALLY — cloud never authors a
// `RestServerConfig` at all, #14796). All four sub-schemas are non-strict
// `z.object()`s, so the route is a `retiredKey()` tombstone (a bare deletion
// would strip the key silently), the ledger rows stay `dead` with a REMOVED
// note, and there is no D2 conversion: a `RestServerConfig` is plugin TS
// configuration (REST plugin constructor / `plugin-hono-server` `restConfig`),
// never a stack collection member or a `sys_metadata` row — the
// `api/RestServerConfig:openApi31` (#4579) precedent. D3 semantic entry
// `rest-server-config-dead-keys-retired`. Registered under 18, not 17: the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// `crud.patterns`: every CRUD route is mounted from the fixed method/path
// pairs in `registerCrudEndpoints`; a custom pattern was validated and never
// read. Not enforced, because the mounted paths ARE the contract the client
// SDK, the discovery document and the served /openapi.json describe — a
// per-operation method/path knob would make every one of them lie. The live
// door for a custom path or method is a declarative `api` endpoint. Its value
// def `api/CrudEndpointPattern` leaves with it (RETIRED_DEFS_BY_MAJOR[18]); its
// four ledger child rows collapse into the one `patterns` row. Closes #14365's
// question about the record's input type — there is no record left to reshape.
export const entry = 'api/CrudEndpointsConfig:patterns';
