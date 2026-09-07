// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `RegistryUpstream.timeout` said
// "Request timeout in milliseconds" in prose and nothing else, beside a
// seconds-valued `syncInterval` on the same block. Its `min(1000)` bound is the
// sharpest reading of why the rule exists: under the wrong unit that floor reads
// as sixteen minutes rather than one second, and no parse can catch the mistake
// because both readings are in range. Renamed to `timeoutMs`; the value, the
// 30000 default and the min-1000 bound are unchanged. Tombstoned with
// `retiredKey()`. No D2 conversion, for its sibling's reason.
// See `system-registry-config-durations-unit-in-key`.
export const entry = 'system/RegistryUpstream:timeout';
