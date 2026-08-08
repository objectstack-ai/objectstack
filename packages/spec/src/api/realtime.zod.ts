// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { RealtimeRecordAction, BasePresenceSchema } from './realtime-shared.zod';

// Re-export shared types for backward compatibility
import { lazySchema } from '../shared/lazy-schema';
export { PresenceStatus, RealtimeRecordAction, BasePresenceSchema } from './realtime-shared.zod';
export type { BasePresence } from './realtime-shared.zod';

/**
 * Transport Protocol Enum
 * Defines the communication protocol for realtime data synchronization
 */
export const TransportProtocol = z.enum([
  'websocket',  // Full-duplex, low latency communication
  'sse',        // Server-Sent Events, unidirectional push
  'polling',    // Short polling, best compatibility
]);

export type TransportProtocol = z.input<typeof TransportProtocol>;

/**
 * Event Type Enum
 * Types of realtime events that can be subscribed to
 *
 * ⚠️ NOT YET ENFORCED — declared but has no runtime consumer (#3197). The
 * engine publishes realtime events under the `data.record.created/updated/deleted`
 * names from `DataEventType` (events.zod.ts), which this enum does not match,
 * and nothing ever emits `field.changed`. Subscriptions authored against these
 * values are not validated or filtered by any runtime.
 */
export const RealtimeEventType = z.enum([
  'record.created',
  'record.updated',
  'record.deleted',
  'field.changed',
]).describe('Realtime event type (not yet enforced — the runtime emits data.record.* event names instead, and field.changed is never emitted; see #3197)');

export type RealtimeEventType = z.input<typeof RealtimeEventType>;

/**
 * Subscription Event Configuration
 * Defines what events to subscribe to with optional filtering
 */
export const SubscriptionEventSchema = lazySchema(() => z.object({
  type: RealtimeEventType.describe('Type of event to subscribe to'),
  object: z.string().optional().describe('Object name to subscribe to'),
  filters: z.unknown().optional().describe('Filter conditions'),
}));
export type SubscriptionEvent = z.input<typeof SubscriptionEventSchema>;

/**
 * Subscription Schema
 * Configuration for subscribing to realtime events
 */
export const SubscriptionSchema = lazySchema(() => z.object({
  id: z.string().uuid().describe('Unique subscription identifier'),
  events: z.array(SubscriptionEventSchema).describe('Array of events to subscribe to'),
  transport: TransportProtocol.describe('Transport protocol to use'),
  channel: z.string().optional().describe('Optional channel name for grouping subscriptions'),
}));

export type Subscription = z.input<typeof SubscriptionSchema>;

/**
 * Presence Schema
 * Tracks user online status and metadata.
 * Extends the shared BasePresenceSchema for transport-level presence tracking.
 */
export const RealtimePresenceSchema = lazySchema(() => BasePresenceSchema);

export type RealtimePresence = z.input<typeof RealtimePresenceSchema>;

/**
 * Realtime Event Schema
 * Represents a realtime synchronization event
 */
export const RealtimeEventSchema = lazySchema(() => z.object({
  id: z.string().uuid().describe('Unique event identifier'),
  type: z.string().describe('Event type (e.g., record.created, record.updated)'),
  object: z.string().optional().describe('Object name the event relates to'),
  action: RealtimeRecordAction.optional().describe('Action performed'),
  payload: z.record(z.string(), z.unknown()).describe('Event payload data'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime when event occurred'),
  userId: z.string().optional().describe('User who triggered the event'),
  sessionId: z.string().optional().describe('Session identifier'),
}));

export type RealtimeEvent = z.input<typeof RealtimeEventSchema>;

/**
 * Realtime Configuration Schema
 * 
 * Configuration for enabling realtime data synchronization.
 */
export const RealtimeConfigSchema = lazySchema(() => z.object({
  /** Enable realtime sync */
  enabled: z.boolean().default(true).describe('Enable realtime synchronization'),
  
  /** Transport protocol */
  transport: TransportProtocol.default('websocket').describe('Transport protocol'),
  
  /** Default subscriptions */
  subscriptions: z.array(SubscriptionSchema).optional().describe('Default subscriptions'),
}).passthrough()); // Allow additional properties

export type RealtimeConfig = z.input<typeof RealtimeConfigSchema>;
/** Post-parse shape of {@link RealtimeConfig} — defaults applied, transforms run (ADR-0122). */
export type RealtimeConfigParsed = z.infer<typeof RealtimeConfigSchema>;
