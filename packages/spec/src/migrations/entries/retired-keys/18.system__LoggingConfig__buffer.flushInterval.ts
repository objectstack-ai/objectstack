// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `buffer.flushInterval` said
// "Flush interval in milliseconds" in a source JSDoc and carried no
// `.describe()` at all, so the reference page published a bare 1000. Renamed to
// `flushIntervalMs`. The value and the 1000 default are unchanged. Tombstoned
// with `retiredKey()`: the nested `buffer` object is not strict, so a bare
// deletion would silently strip the key. ⚠️ Not the same key as
// `system/HttpDestinationConfig:batch.flushInterval`, which defaults to 5000
// and has its own row — the two spellings were identical and the defaults never
// were. No D2 conversion: no logging collection on `stack.zod.ts`, not a stored
// row. See `logging-durations-unit-in-key`.
export const entry = 'system/LoggingConfig:buffer.flushInterval';
