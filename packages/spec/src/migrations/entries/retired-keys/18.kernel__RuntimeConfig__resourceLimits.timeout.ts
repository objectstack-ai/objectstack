// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478 ruling B). This is the fifth
// duration on `kernel/plugin-security-advanced.zod.ts` and the one #15678
// deliberately left alone: `resourceLimits.timeout` said "Execution timeout in
// milliseconds" in a source JSDoc and "Maximum execution time" in the
// `.describe()` the reference pages publish, so the published channel named no
// unit at all and the gate listed the key in its census without judging it.
// Renamed to `timeoutMs`, the same token `SandboxConfig.process.timeoutMs` on
// this file already carries. The value is unchanged. Tombstoned with
// `retiredKey()`: the nested `resourceLimits` object is not strict, so a bare
// deletion would silently strip the key. No D2 conversion: a `RuntimeConfig` is
// the engine block of the `SandboxConfig` a host or a plugin security manifest
// constructs, never a stack collection member or a stored row — the same
// reading `kernel-plugin-security-durations-unit-in-key` recorded for the four
// keys it renamed. See `kernel-runtime-config-timeout-unit-in-key`.
export const entry = 'kernel/RuntimeConfig:resourceLimits.timeout';
