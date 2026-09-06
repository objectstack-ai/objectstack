// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B: the unit lives in the key NAME.
// `DataLoaderConfig.cacheTtl` named seconds only in its describe. Renamed to
// `cacheTtlSeconds`; the value is unchanged. Tombstoned with `retiredKey()`
// because the shape is not `.strict()`. No D2 conversion: a `DataLoaderConfig`
// is a per-request batch-loader construction argument, never a stack collection
// member or a stored row, so the chain has no seam (the `kernel/Manifest:loading`
// precedent); the semantic entry `api-runtime-config-durations-unit-in-key`
// carries the prescription.
export const entry = 'api/DataLoaderConfig:cacheTtl';
