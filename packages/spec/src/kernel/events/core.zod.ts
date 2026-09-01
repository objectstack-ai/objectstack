// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
// [#13613] The `name` fields below carried `EventNameSchema` (a dot-notation
// grammar from shared/identifiers.zod) until ADR-0049 enforce-or-remove
// retired it: no runtime consumer ever parsed through these schemas, and the
// event vocabulary the platform actually checks is the closed literal enums
// `DataEventType` / `BulkDataEventType` (`api/events.zod.ts`). The fields stay
// as plain strings; the enums are the only event-name contract.

// ==========================================
// Event Priority
// ==========================================

/**
 * Event Priority Enum
 * Priority levels for event processing
 * Lower numbers = higher priority
 */
import { lazySchema } from '../../shared/lazy-schema';
import { EventClusterOptionsSchema } from '../cluster.zod';
export const EventPriority = z.enum([
  'critical',   // 0 - Process immediately, block if necessary
  'high',       // 1 - Process soon, minimal delay
  'normal',     // 2 - Default priority
  'low',        // 3 - Process when resources available
  'background', // 4 - Process during idle time
]);

export type EventPriority = z.input<typeof EventPriority>;

/**
 * Event Priority Values
 * Maps priority names to numeric values for sorting
 */
export const EVENT_PRIORITY_VALUES: Record<EventPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

// ==========================================
// Event Metadata
// ==========================================

/**
 * Event Metadata Schema
 * Metadata associated with every event
 */
export const EventMetadataSchema = lazySchema(() => z.object({
  source: z.string().describe('Event source (e.g., plugin name, system component)'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime when event was created'),
  userId: z.string().optional().describe('User who triggered the event'),
  tenantId: z.string().optional().describe('Tenant identifier for multi-tenant systems'),
  correlationId: z.string().optional().describe('Correlation ID for event tracing'),
  causationId: z.string().optional().describe('ID of the event that caused this event'),
  priority: EventPriority.optional().default('normal').describe('Event priority'),

  /**
   * Cluster routing & ordering options.
   *
   * Optional for backward compatibility — events without this field
   * default to `{ scope: 'local', deliverySemantics: 'best-effort' }`,
   * which is identical to the pre-v5.2 behaviour. Plugins that need
   * cross-node delivery, ordering, or persisted at-least-once semantics
   * MUST set the relevant fields.
   *
   * @see content/docs/kernel/cluster.mdx §4
   */
  cluster: EventClusterOptionsSchema.optional()
    .describe('Per-emit cluster routing & delivery options. See cluster-semantics.mdx §4.'),
}));

// ==========================================
// Event Schema
// ==========================================

/**
 * Event Type Definition Schema
 * Defines the structure of an event type
 * 
 * @example
 * {
 *   "name": "order.created",
 *   "version": "1.0.0",
 *   "schema": {
 *     "type": "object",
 *     "properties": {
 *       "orderId": { "type": "string" },
 *       "customerId": { "type": "string" },
 *       "total": { "type": "number" }
 *     }
 *   }
 * }
 */
export const EventTypeDefinitionSchema = lazySchema(() => z.object({
  name: z.string().describe('Event type name (dot notation by convention, e.g. order.created; the platform-checked event vocabulary is the closed DataEventType / BulkDataEventType enums)'),
  version: z.string().default('1.0.0').describe('Event schema version'),
  schema: z.unknown().optional().describe('JSON Schema for event payload validation'),
  description: z.string().optional().describe('Event type description'),
  deprecated: z.boolean().optional().default(false).describe('Whether this event type is deprecated'),
  tags: z.array(z.string()).optional().describe('Event type tags'),
}));

export type EventTypeDefinition = z.input<typeof EventTypeDefinitionSchema>;
/** Post-parse shape of {@link EventTypeDefinition} — defaults applied, transforms run (ADR-0122). */
export type EventTypeDefinitionParsed = z.infer<typeof EventTypeDefinitionSchema>;

/**
 * Event Schema
 * Base schema for all events in the system
 * 
 * Event names follow dot notation for namespacing (e.g., 'user.created', 'order.paid').
 * This aligns with industry standards for event-driven architectures and message queues.
 */
export const EventSchema = lazySchema(() => z.object({
  /**
   * Event identifier (for tracking and deduplication)
   */
  id: z.string().optional().describe('Unique event identifier'),
  
  /**
   * Event name
   */
  name: z.string().describe('Event name (dot notation by convention, e.g. user.created, order.paid; the platform-checked event vocabulary is the closed DataEventType / BulkDataEventType enums)'),
  
  /**
   * Event payload
   */
  payload: z.unknown().describe('Event payload schema'),
  
  /**
   * Event metadata
   */
  metadata: EventMetadataSchema.describe('Event metadata'),
}));

export type Event = z.input<typeof EventSchema>;
/** Post-parse shape of {@link Event} — defaults applied, transforms run (ADR-0122). */
export type EventParsed = z.infer<typeof EventSchema>;
