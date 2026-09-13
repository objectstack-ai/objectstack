// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `retry.initialDelay` said
// "Initial retry delay in milliseconds" in a source JSDoc and carried no
// `.describe()` at all, so the reference page published a bare 1000. Renamed to
// `initialDelayMs` — already attested as a key-position declaration 5 times on
// this tree. The value and the 1000 default are unchanged. Tombstoned with
// `retiredKey()`: the nested `retry` object is not strict, so a bare deletion
// would silently strip the key. No D2 conversion: no logging collection on
// `stack.zod.ts`, not a stored row. See `logging-durations-unit-in-key`.
export const entry = 'system/HttpDestinationConfig:retry.initialDelay';
