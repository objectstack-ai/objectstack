// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B. `SandboxConfig.process.timeout`
// said "Process timeout in ms" in prose and nothing else. Renamed to
// `timeoutMs`; the value is unchanged. Tombstoned with `retiredKey()` inside
// the live `process` block. ⚠️ Note for anyone grepping this file: the
// neighbouring `RuntimeConfig.resourceLimits.timeout` is a DIFFERENT key and is
// not covered by this entry. It was never "outside the gate's population", the
// reason this note gave until #15939: its unit lived in a source JSDoc only
// ("Execution timeout in milliseconds") while the `.describe()` the reference
// pages publish read "Maximum execution time" and named none, so
// `check:duration-unit-keys` listed the key in its census and never judged it.
// Ruling A on #15939 remediated that JSDoc-channel population per file, so that
// key is renamed to `timeoutMs` as well — landed, not pending — under its own
// entry `kernel/RuntimeConfig:resourceLimits.timeout`; see
// `kernel-runtime-config-timeout-unit-in-key` for its record.
// No D2 conversion: a `SandboxConfig` is the isolation argument a host or a
// plugin security manifest constructs, never a stack collection member or a
// stored row. See
// `kernel-plugin-security-durations-unit-in-key`.
export const entry = 'kernel/SandboxConfig:process.timeout';
