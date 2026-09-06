// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B; the seconds half of the pair
// documented on `api/RestApiEndpoint:timeout`. Renamed to `cacheTtlSeconds`;
// the value is unchanged. Tombstoned with `retiredKey()`; disposition and
// reasoning are that entry's, and the prescription travels in the semantic
// entry `rest-api-plugin-durations-unit-in-key`.
export const entry = 'api/RestApiEndpoint:cacheTtl';
