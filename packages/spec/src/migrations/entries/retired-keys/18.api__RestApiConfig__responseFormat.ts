// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20295 — ADR-0049 enforce-or-remove on the `api` sub-object of
// `RestServerConfig`, executing the `rest_api` liveness census (#14640: every
// member of the block `dead`, 0 read sites outside `normalizeConfig` and the
// normalized-config type; re-measured on origin/main 4e0f72e8, objectui at its
// pin f8a9d0fb and cloud at 96eb092 — all clean against lit controls).
// `RestApiConfigSchema` is a non-strict `z.object()`, so the route is a
// `retiredKey()` tombstone (a bare deletion would strip the key silently), the
// ledger row stays `dead` with a REMOVED note, and there is no D2 conversion: a
// `RestServerConfig` is plugin TS configuration, never a stack collection member
// or a `sys_metadata` row — the `api/RestServerConfig:openApi31` precedent, and
// the `rest-server-config-dead-keys-retired` one on the four sibling
// sub-objects. D3 semantic entry `rest-api-config-dead-keys-retired`. Registered
// under 18 for the launch-window reason its neighbours state.
//
// `responseFormat` is retired WHOLE — `envelope`, `includeMetadata` and
// `includePagination` were its only members and none was ever read, so there is
// no live member left to hold the container open (the `crud.patterns`
// precedent). A response shape is a fixed contract — each route's declared
// response schema, which the client SDK parses — not a server-wide option.
export const entry = 'api/RestApiConfig:responseFormat';
