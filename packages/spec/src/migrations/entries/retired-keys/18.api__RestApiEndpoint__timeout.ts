// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B. `RestApiEndpoint.timeout`
// (milliseconds) sat THREE LINES above `cacheTtl` (seconds), each unit named
// only in its describe: one shape, two units, no way to tell them apart at the
// authoring site. Renamed to `timeoutMs`; the value is unchanged. Tombstoned
// with `retiredKey()` on this non-strict shape, beside the `handlerStatus`
// tombstone already there. No D2 conversion: a `RestApiEndpoint` is REST-plugin
// route-registration configuration, never a stack collection member (the
// `rest-api-endpoint-handler-status-retired` precedent on this very shape); the
// semantic entry `rest-api-plugin-durations-unit-in-key` carries the
// prescription.
export const entry = 'api/RestApiEndpoint:timeout';
