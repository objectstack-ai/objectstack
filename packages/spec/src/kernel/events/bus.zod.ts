// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { EventTypeDefinitionSchema } from './core.zod';
import { EventHandlerSchema, EventPersistenceSchema } from './handlers.zod';
import { EventQueueConfigSchema, EventSourcingConfigSchema } from './queue.zod';
import { EventWebhookConfigSchema, EventMessageQueueConfigSchema, RealTimeNotificationConfigSchema } from './integrations.zod';

// ==========================================
// Complete Event Bus Configuration
// ==========================================

/**
 * Event Bus Configuration Schema
 * Complete configuration for the event bus system
 * 
 * @example
 * {
 *   "persistence": { "enabled": true, "retention": 365 },
 *   "queue": { "concurrency": 20 },
 *   "eventSourcing": { "enabled": true },
 *   "webhooks": [],
 *   "messageQueue": { "provider": "kafka", "topic": "events" },
 *   "realtime": { "enabled": true, "protocol": "websocket" }
 * }
 */
import { lazySchema } from '../../shared/lazy-schema';
export const EventBusConfigSchema = lazySchema(() => z.object({
  /**
   * Event persistence
   */
  persistence: EventPersistenceSchema.optional().describe('Event persistence configuration'),
  
  /**
   * Event queue
   */
  queue: EventQueueConfigSchema.optional().describe('Event queue configuration'),
  
  /**
   * Event sourcing
   */
  eventSourcing: EventSourcingConfigSchema.optional().describe('Event sourcing configuration'),
  
  /**
   * Event replay
   */
  replay: z.object({
    enabled: z.boolean().default(true).describe('Enable event replay capability'),
  }).optional().describe('Event replay configuration'),
  
  /**
   * Webhooks
   */
  webhooks: z.array(EventWebhookConfigSchema).optional().describe('Webhook configurations'),
  
  /**
   * Message queue integration
   */
  messageQueue: EventMessageQueueConfigSchema.optional().describe('Message queue integration'),
  
  /**
   * Real-time notifications
   */
  realtime: RealTimeNotificationConfigSchema.optional().describe('Real-time notification configuration'),
  
  /**
   * Event type definitions
   */
  eventTypes: z.array(EventTypeDefinitionSchema).optional().describe('Event type definitions'),
  
  /**
   * Global handlers
   */
  handlers: z.array(EventHandlerSchema).optional().describe('Global event handlers'),
}));

export type EventBusConfig = z.input<typeof EventBusConfigSchema>;
/** Post-parse shape of {@link EventBusConfig} — defaults applied, transforms run (ADR-0122). */
export type EventBusConfigParsed = z.infer<typeof EventBusConfigSchema>;
