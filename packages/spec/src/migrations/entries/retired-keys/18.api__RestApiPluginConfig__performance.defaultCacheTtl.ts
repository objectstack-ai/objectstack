// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B. The plugin-wide default behind
// the per-endpoint `cacheTtl` this card also renames; leaving it bare would have
// left the DEFAULT spelled one way and the OVERRIDE another. Renamed to
// `defaultCacheTtlSeconds`; the value is unchanged. Tombstoned with
// `retiredKey()` inside the live `performance` block — a tombstone whose
// siblings must keep parsing. No D2 conversion: `RestApiPluginConfig` is the
// REST plugin's construction argument, never a stored row; the semantic entry
// `rest-api-plugin-durations-unit-in-key` carries the prescription.
export const entry = 'api/RestApiPluginConfig:performance.defaultCacheTtl';
