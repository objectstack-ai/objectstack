// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ==========================================
// Event Queue
// ==========================================

/**
 * Event Queue Configuration Schema
 * Configuration for async event processing queue
 * 
 * @example
 * {
 *   "name": "event_queue",
 *   "concurrency": 10,
 *   "retryPolicy": {
 *     "maxRetries": 3,
 *     "backoffStrategy": "exponential"
 *   }
 * }
 */
import { lazySchema } from '../../shared/lazy-schema';
export const EventQueueConfigSchema = lazySchema(() => z.object({
  /**
   * Queue name
   */
  name: z.string().default('events').describe('Event queue name'),
  
  /**
   * Concurrency
   */
  concurrency: z.number().int().min(1).default(10).describe('Max concurrent event handlers'),
  
  /**
   * Retry policy
   */
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).default(3).describe('Max retries for failed events'),
    backoffStrategy: z.enum(['fixed', 'linear', 'exponential']).default('exponential')
      .describe('Backoff strategy'),
    initialDelayMs: z.number().int().positive().default(1000).describe('Initial retry delay'),
    maxDelayMs: z.number().int().positive().default(60000).describe('Maximum retry delay'),
  }).optional().describe('Default retry policy for events'),
  
  /**
   * Dead letter queue
   */
  deadLetterQueue: z.string().optional().describe('Dead letter queue name for failed events'),
  
  /**
   * Enable priority processing
   */
  priorityEnabled: z.boolean().default(true).describe('Process events based on priority'),
}));

export type EventQueueConfig = z.input<typeof EventQueueConfigSchema>;
/** Post-parse shape of {@link EventQueueConfig} — defaults applied, transforms run (ADR-0122). */
export type EventQueueConfigParsed = z.infer<typeof EventQueueConfigSchema>;

// ==========================================
// Event Replay
// ==========================================

/**
 * Event Replay Configuration Schema
 * Configuration for replaying historical events
 * 
 * @example
 * {
 *   "fromTimestamp": "2024-01-01T00:00:00Z",
 *   "toTimestamp": "2024-01-31T23:59:59Z",
 *   "eventTypes": ["order.created", "order.updated"],
 *   "speed": 10
 * }
 */
export const EventReplayConfigSchema = lazySchema(() => z.object({
  /**
   * Start timestamp
   */
  fromTimestamp: z.string().datetime().describe('Start timestamp for replay (ISO 8601)'),
  
  /**
   * End timestamp
   */
  toTimestamp: z.string().datetime().optional().describe('End timestamp for replay (ISO 8601)'),
  
  /**
   * Event types to replay
   */
  eventTypes: z.array(z.string()).optional().describe('Event types to replay (empty = all)'),
  
  /**
   * Event filters
   */
  filters: z.record(z.string(), z.unknown()).optional().describe('Additional filters for event selection'),
  
  /**
   * Replay speed multiplier
   */
  speed: z.number().positive().default(1).describe('Replay speed multiplier (1 = real-time)'),
  
  /**
   * Target handlers
   */
  targetHandlers: z.array(z.string()).optional().describe('Handler IDs to execute (empty = all)'),
}));

export type EventReplayConfig = z.input<typeof EventReplayConfigSchema>;
/** Post-parse shape of {@link EventReplayConfig} — defaults applied, transforms run (ADR-0122). */
export type EventReplayConfigParsed = z.infer<typeof EventReplayConfigSchema>;

// ==========================================
// Event Sourcing
// ==========================================

/**
 * Event Sourcing Configuration Schema
 * Configuration for event sourcing pattern
 * 
 * Event sourcing stores all changes to application state as a sequence of events.
 * The current state can be reconstructed by replaying the events.
 * 
 * @example
 * {
 *   "enabled": true,
 *   "snapshotInterval": 100,
 *   "retention": 365
 * }
 */
export const EventSourcingConfigSchema = lazySchema(() => z.object({
  /**
   * Enable event sourcing
   */
  enabled: z.boolean().default(false).describe('Enable event sourcing'),
  
  /**
   * Snapshot interval
   */
  snapshotInterval: z.number().int().positive().default(100)
    .describe('Create snapshot every N events'),
  
  /**
   * Snapshot retention
   */
  snapshotRetention: z.number().int().positive().default(10)
    .describe('Number of snapshots to retain'),
  
  /**
   * Event retention
   */
  retention: z.number().int().positive().default(365)
    .describe('Days to retain events'),
  
  /**
   * Aggregate types
   */
  aggregateTypes: z.array(z.string()).optional()
    .describe('Aggregate types to enable event sourcing for'),
  
  /**
   * Storage configuration
   */
  storage: z.object({
    type: z.enum(['database', 'file', 's3', 'eventstore']).default('database')
      .describe('Storage backend'),
    options: z.record(z.string(), z.unknown()).optional().describe('Storage-specific options'),
  }).optional().describe('Event store configuration'),
}));

export type EventSourcingConfig = z.input<typeof EventSourcingConfigSchema>;
/** Post-parse shape of {@link EventSourcingConfig} — defaults applied, transforms run (ADR-0122). */
export type EventSourcingConfigParsed = z.infer<typeof EventSourcingConfigSchema>;
