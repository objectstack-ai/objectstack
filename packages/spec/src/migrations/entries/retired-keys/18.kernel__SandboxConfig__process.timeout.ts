// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B. `SandboxConfig.process.timeout`
// said "Process timeout in ms" in prose and nothing else. Renamed to
// `timeoutMs`; the value is unchanged. Tombstoned with `retiredKey()` inside
// the live `process` block. ⚠️ Note for anyone grepping this file: the
// neighbouring `RuntimeConfig.resourceLimits.timeout` is a DIFFERENT key whose
// describe names no unit at all, so it is inside the gate's census and outside
// its verdict, and is untouched here. ⚠️ Its unit is not missing, only
// unpublished: the JSDoc two lines above it says milliseconds. That divergence
// is what #15939 filed and what `check:duration-unit-keys` was ruled to refuse
// (2026-09-07, decision batch #65) — so this key is a rename waiting on that
// gate change, not a key that has nothing to fix.
// No D2 conversion: a `SandboxConfig` is the isolation argument a host or a
// plugin security manifest constructs, never a stack collection member or a
// stored row. See
// `kernel-plugin-security-durations-unit-in-key`.
export const entry = 'kernel/SandboxConfig:process.timeout';
