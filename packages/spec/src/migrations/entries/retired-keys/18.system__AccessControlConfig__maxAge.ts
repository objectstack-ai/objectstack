// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `AccessControlConfig.maxAge` said
// "CORS preflight cache duration in seconds" in prose and nothing else.
// ⚠️ This key is deliberately a RENAME and not an `externalVocabulary` marker,
// and the asymmetry with its twin is load-bearing: every bucket-CORS standard
// this value is forwarded to spells the field WITH its unit (S3 `MaxAgeSeconds`,
// GCS `maxAgeSeconds`, Azure `MaxAgeInSeconds`), so marking it would have
// exempted a DEVIATION from the cited standard rather than a mirror of it. The
// twin `shared/CorsConfig.maxAge` DID get the marker, because the Fetch response
// header it mirrors — `Access-Control-Max-Age` — genuinely carries no unit token.
// Two `maxAge` keys, opposite sides of the line; do not harmonise them. Renamed
// to `maxAgeSeconds`; the value is unchanged. Tombstoned with `retiredKey()`. No
// D2 conversion: not a stack collection member, not a stored row.
// See `system-object-storage-durations-unit-in-key`.
export const entry = 'system/AccessControlConfig:maxAge';
