// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `timeout` said "Timeout in
// milliseconds" in a source JSDoc and carried no `.describe()` at all, so the
// reference page published a bare 30000. Renamed to `timeoutMs` — already
// attested as a key-position declaration 30 times on this tree. The value and
// the 30000 default are unchanged. Tombstoned with `retiredKey()`:
// `HttpDestinationConfig` is not strict, so a bare deletion would silently
// strip the key. ⚠️ The one TOP-LEVEL key of this card's four, so this is the
// one whose `authorable-surface/` and `authorable-defaults/` rows move — that
// ratchet records `schema.properties` one level deep. No D2 conversion: no
// logging collection on `stack.zod.ts`, not a stored row. See
// `logging-durations-unit-in-key`.
export const entry = 'system/HttpDestinationConfig:timeout';
