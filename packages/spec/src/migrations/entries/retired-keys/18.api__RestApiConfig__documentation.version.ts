// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20294 — ruling B on #20359 (family `rest-api-documentation`, rank 8 of the
// #18900 census): the eight identity members of `api.documentation` are
// ENFORCED (they overlay the served OpenAPI `info`) and `version` alone is
// RETIRED, because the served `info.version` is the protocol version and #11646
// settled that nothing configured overrides it. Tombstoned with `retiredKey()`
// inside the live `documentation` block, next to the #20295 `enabled`
// tombstone. No D2 conversion: a `RestServerConfig` is plugin TS configuration,
// never a stack collection member or a `sys_metadata` row. D3 semantic entry
// `rest-api-documentation-version-retired`. Registered under 18 for the
// launch-window reason its neighbours state.
//
// Nested key of an inline block — no `authorable-surface/` line of its own.
export const entry = 'api/RestApiConfig:documentation.version';
