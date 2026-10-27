// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8075 — system/message-queue.zod.ts, retired whole (ADR-0049). DLQ config,
// embedded only by `system/MessageQueueConfig` (retired in the same change)
// and consumed by nothing. ⚠️ `kernel/DeadLetterQueueEntry` is a different
// declaration (the event bus's per-event DLQ record) and is untouched —
// name adjacency is not evidence, the `system/ServerRateLimitConfig` note
// applies verbatim.
export const entry = 'system/DeadLetterQueue';
