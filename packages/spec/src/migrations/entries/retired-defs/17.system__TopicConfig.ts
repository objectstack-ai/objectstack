// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8075 — system/message-queue.zod.ts, retired whole (ADR-0049). Topic
// partitions/replication/retention/compression config, embedded only by
// `system/MessageQueueConfig` (retired in the same change) and consumed by
// nothing — leaving it behind would strand an exported schema with no
// consumer (#3950).
export const entry = 'system/TopicConfig';
