// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8075 — system/message-queue.zod.ts, retired whole (ADR-0049). The
// six-value broker provider enum, embedded only by
// `system/MessageQueueConfig` (retired in the same change). Not the same
// declaration as `kernel/EventMessageQueueConfig.provider` — that is its own
// INLINE `z.enum` (same six values, never a reference to this def) and is
// untouched.
export const entry = 'system/MessageQueueProvider';
