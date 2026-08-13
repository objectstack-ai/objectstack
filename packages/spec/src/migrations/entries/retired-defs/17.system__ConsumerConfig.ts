// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8075 — system/message-queue.zod.ts, retired whole (ADR-0049). Consumer
// group config (groupId / offset reset / auto-commit / poll size), embedded
// only by `system/MessageQueueConfig` (retired in the same change) and
// consumed by nothing.
export const entry = 'system/ConsumerConfig';
