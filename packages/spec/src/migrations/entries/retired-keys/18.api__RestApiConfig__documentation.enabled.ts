// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20295 — ADR-0049 enforce-or-remove on the `api` sub-object of
// `RestServerConfig`, executing the `rest_api` liveness census (#14640: 0 read
// sites outside `normalizeConfig` and the normalized-config type; re-measured on
// origin/main 4e0f72e8, objectui at its pin f8a9d0fb and cloud at 96eb092 — all
// clean against lit controls). Tombstoned with `retiredKey()` inside the live
// `documentation` block — a tombstone whose siblings keep parsing, because only
// this member retires here. No D2 conversion: a `RestServerConfig` is plugin TS
// configuration, never a stack collection member or a `sys_metadata` row. D3
// semantic entry `rest-api-config-dead-keys-retired`. Registered under 18 for the
// launch-window reason its neighbours state.
//
// `documentation.enabled` was a second on/off switch for the OpenAPI document:
// `api.enableOpenApi` decides the mount, and this key was consulted nowhere.
// Nested key of an inline block — no `authorable-surface/` line of its own.
export const entry = 'api/RestApiConfig:documentation.enabled';
