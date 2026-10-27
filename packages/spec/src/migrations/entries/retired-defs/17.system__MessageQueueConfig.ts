// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8075 — system/message-queue.zod.ts, retired whole (ADR-0049
// enforce-or-remove; fork (b) of the #8075 census, accepted 2026-08-12). The
// top-level broker-administration config, carrying a required inline
// `sasl.password` credential when `sasl` was present. Zero consumers outside
// packages/spec repo-wide; no `message_queue` metadata type; the connector
// 'message_queue' ConnectorType enum value never referenced this schema. The
// consumed near-namesake `kernel/EventMessageQueueConfig`
// (`EventBusConfigSchema.messageQueue`) deliberately carries NO credential
// field and is untouched. Route 3: no tombstone, no D2 conversion — this
// table plus the D3 `external-lookup-message-queue-families-retired` are the
// declaration.
export const entry = 'system/MessageQueueConfig';
