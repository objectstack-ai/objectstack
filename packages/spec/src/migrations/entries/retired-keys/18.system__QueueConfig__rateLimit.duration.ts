// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. `QueueConfig.rateLimit.duration`
// said "Duration in milliseconds" in prose and nothing else — while
// `TaskResult.durationMs`, ninety lines earlier in the SAME file, already spelled
// the identical measurement correctly. The counter-example was in the file, which
// is what makes this one a drift rather than a convention. Renamed to
// `durationMs`; the value is unchanged. Tombstoned with `retiredKey()`. No D2
// conversion: `stack.zod.ts` declares `jobs`, not `queues`, and a queue config is
// worker host configuration rather than a stored metadata row.
// See `system-worker-queue-rate-limit-duration-unit-in-key`.
export const entry = 'system/QueueConfig:rateLimit.duration';
