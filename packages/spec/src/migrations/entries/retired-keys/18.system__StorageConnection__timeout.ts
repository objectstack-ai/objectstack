// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `StorageConnection.timeout` said
// "Connection timeout in milliseconds" in prose and nothing else. Renamed to
// `timeoutMs`; the value is unchanged. Tombstoned with `retiredKey()`. No D2
// conversion: `stack.zod.ts` declares no `objectStorage` collection and a storage
// connection is host configuration, not a stored metadata row.
// See `system-object-storage-durations-unit-in-key`.
export const entry = 'system/StorageConnection:timeout';
