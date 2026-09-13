// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15939 ruling A (per-file remediation of #14478). `batch.flushInterval` said
// "Flush interval in milliseconds" in a source JSDoc and carried no
// `.describe()` at all, so the reference page published a bare 5000. Renamed to
// `flushIntervalMs` — the family's own spelling, 272 key-position `*Ms:`
// declarations in `packages/spec/src` and `flushIntervalMs` already declared on
// `kernel/events/integrations.zod.ts`. The value and the 5000 default are
// unchanged. Tombstoned with `retiredKey()`: the nested `batch` object is not
// strict, so a bare deletion would silently strip the key. ⚠️ Not the same key
// as `system/LoggingConfig:buffer.flushInterval`, which defaults to 1000 and
// has its own row. No D2 conversion: no logging collection on `stack.zod.ts`,
// not a stored row. See `logging-durations-unit-in-key`.
export const entry = 'system/HttpDestinationConfig:batch.flushInterval';
