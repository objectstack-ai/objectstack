// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15678 (stack card 3/6 of #14478) — ruling B. `EventPersistence.retention`
// said "Days to retain persisted events" in prose and nothing else. Renamed to
// `retentionDays`; the value is unchanged. Tombstoned with `retiredKey()`. No
// D2 conversion: an `EventPersistence` hangs off `EventBusConfig`, the event
// bus's construction argument — never a stack collection member (`stack.zod.ts`
// declares no `eventBus` key) and never a stored sys_metadata row, so the
// conversion chain has no seam that would see one. The semantic entry
// `kernel-event-bus-retention-unit-in-key` carries the prescription.
export const entry = 'kernel/EventPersistence:retention';
