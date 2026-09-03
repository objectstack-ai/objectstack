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
// `routes.excludeObjects`: same shape as `includeObjects` — an excluded
// object was still mounted. The one customer-visible member of the family:
// `RestServerConfigSchema`'s own `@example` advertised
// `routes: { excludeObjects: ['system_log'] }`; corrected in the same change.
export const entry = 'api/RouteGenerationConfig:excludeObjects';
