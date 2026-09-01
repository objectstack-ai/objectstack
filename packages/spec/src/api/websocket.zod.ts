// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { PresenceStatus } from './realtime-shared.zod';

// Re-export shared PresenceStatus for backward compatibility
import { lazySchema } from '../shared/lazy-schema';
export { PresenceStatus } from './realtime-shared.zod';

/**
 * WebSocket Event Protocol
 *
 * Defines the schema for WebSocket-based real-time communication in ObjectStack.
 * Supports event subscriptions, filtering, presence tracking, and collaborative editing.
 *
 * Industry alignment: Firebase Realtime Database, Socket.IO, Pusher
 *
 * ⚠️ NOT YET SERVED — this protocol is declared but no WebSocket server is
 * mounted anywhere in the runtime (#2462, #3197): `IRealtimeService.handleUpgrade`
 * is deliberately unimplemented and discovery advertises `websockets: false`.
 * These schemas define the future wire contract; nothing consumes them at
 * runtime today.
 */

// ==========================================
// Message Types
// ==========================================

/**
 * WebSocket Message Type Enum
 * Defines the types of messages that can be sent over WebSocket
 *
 * ⚠️ NOT YET SERVED — no WebSocket transport is mounted, so no runtime sends
 * or dispatches on these message types (see module note above; #3197).
 */
export const WebSocketMessageType = z.enum([
  'subscribe',       // Client subscribes to events
  'unsubscribe',     // Client unsubscribes from events
  'event',           // Server sends event to client
  'ping',            // Keepalive ping
  'pong',            // Keepalive pong response
  'ack',             // Acknowledgment of message receipt
  'error',           // Error message
  'presence',        // Presence update (user status)
  'cursor',          // Cursor position update (collaborative editing)
  'edit',            // Document edit operation (collaborative editing)
]);

export type WebSocketMessageType = z.input<typeof WebSocketMessageType>;

// ==========================================
// Event Subscription
// ==========================================

// A `FilterOperator` enum (eq/ne/gt/gte/lt/lte/in/nin/contains/startsWith/
// endsWith/exists/regex) and the `EventFilterCondition` + `EventFilterSchema`
// pair it fed lived here, reached from `EventSubscriptionSchema.filters`.
//
// Nothing imported any of it — not this repo, not objectui, not cloud — and no
// runtime ever evaluated an event filter: `matchesSubscription` matches on
// object name and event type only (see `contracts/realtime-service.ts`), and the
// subscription shape the transports actually carry is the separate, deliberately
// unvalidated `filters: z.unknown()` on `SubscriptionEventSchema`
// (`api/realtime.zod.ts`).
//
// So this was a *second* spelling of event filtering, disagreeing with both the
// live one and with `VALID_AST_OPERATORS`, and it described a capability no code
// provided: a subscriber setting `filters` received every event regardless.
//
// The `filters` key itself stays — retiring an object key needs a tombstone and
// a conversion (ADR-0104), and there is no author to migrate for a shape nothing
// validated. It now carries the same `z.unknown()` type and NOT-YET-ENFORCED
// marker as `SubscriptionEventSchema.filters`, so the two subscription surfaces
// describe event filtering identically and neither implies enforcement that does
// not exist. Whichever grows real filtering should lower onto `AST_OPERATOR_MAP`
// (`data/filter.zod.ts`) rather than reintroduce a vocabulary of its own.
// objectui#2945.

/**
 * Event Pattern Schema
 * Event name pattern that supports wildcards for subscriptions
 */
export const EventPatternSchema = lazySchema(() => z
  .string()
  .min(1)
  .regex(/^[a-z*][a-z0-9_.*]*$/, {
    message: 'Event pattern must be lowercase and may contain letters, numbers, underscores, dots, or wildcards (e.g., "record.*", "*.created", "user.login")',
  })
  .describe('Event pattern (supports wildcards like "record.*" or "*.created")'));

export type EventPattern = z.input<typeof EventPatternSchema>;

/**
 * Event Subscription Config
 * Configuration for subscribing to specific events
 */
export const EventSubscriptionSchema = lazySchema(() => z.object({
  subscriptionId: z.string().uuid().describe('Unique subscription identifier'),
  events: z.array(EventPatternSchema).describe('Event patterns to subscribe to (supports wildcards, e.g., "record.*", "user.created")'),
  objects: z.array(z.string()).optional().describe('Object names to filter events by (e.g., ["account", "contact"])'),
  /**
   * ⚠️ NOT YET ENFORCED — no runtime evaluates a payload filter.
   * `matchesSubscription` matches on object name and event type only
   * (`contracts/realtime-service.ts`), so a subscription carrying `filters`
   * receives every event its patterns match. Deliberately `unknown` for the
   * same reason as `SubscriptionEventSchema.filters` (`api/realtime.zod.ts`):
   * validating a shape nothing reads would imply an enforcement that does not
   * exist. objectui#2945.
   */
  filters: z.unknown().optional().describe('Filter conditions for event payloads (not yet enforced — the runtime filters by object name and event type only)'),
  channels: z.array(z.string()).optional().describe('Channel names for scoped subscriptions'),
}));

export type EventSubscription = z.input<typeof EventSubscriptionSchema>;

/**
 * Unsubscribe Request
 * Request to unsubscribe from events
 */
export const UnsubscribeRequestSchema = lazySchema(() => z.object({
  subscriptionId: z.string().uuid().describe('Subscription ID to unsubscribe from'),
}));

export type UnsubscribeRequest = z.input<typeof UnsubscribeRequestSchema>;

// ==========================================
// Presence Tracking
// ==========================================

/**
 * Presence Status Enum
 * Re-exported from realtime-shared.zod.ts for backward compatibility
 */
export const WebSocketPresenceStatus = PresenceStatus;

export type WebSocketPresenceStatus = z.input<typeof WebSocketPresenceStatus>;

/**
 * Presence State Schema
 * Tracks real-time user presence and activity
 */
export const PresenceStateSchema = lazySchema(() => z.object({
  userId: z.string().describe('User identifier'),
  sessionId: z.string().uuid().describe('Unique session identifier'),
  status: WebSocketPresenceStatus.describe('Current presence status'),
  lastSeen: z.string().datetime().describe('ISO 8601 datetime of last activity'),
  currentLocation: z.string().optional().describe('Current page/route user is viewing'),
  device: z.enum(['desktop', 'mobile', 'tablet', 'other']).optional().describe('Device type'),
  customStatus: z.string().optional().describe('Custom user status message'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional custom presence data'),
}));

export type PresenceState = z.input<typeof PresenceStateSchema>;

/**
 * Presence Update Request
 * Client request to update presence status
 */
export const PresenceUpdateSchema = lazySchema(() => z.object({
  status: WebSocketPresenceStatus.optional().describe('Updated presence status'),
  currentLocation: z.string().optional().describe('Updated current location'),
  customStatus: z.string().optional().describe('Updated custom status message'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
}));

export type PresenceUpdate = z.input<typeof PresenceUpdateSchema>;

// ==========================================
// Collaborative Editing Protocol
// ==========================================

/**
 * Cursor Position Schema
 * Represents a cursor position in a document
 */
export const CursorPositionSchema = lazySchema(() => z.object({
  userId: z.string().describe('User identifier'),
  sessionId: z.string().uuid().describe('Session identifier'),
  documentId: z.string().describe('Document identifier being edited'),
  position: z.object({
    line: z.number().int().nonnegative().describe('Line number (0-indexed)'),
    column: z.number().int().nonnegative().describe('Column number (0-indexed)'),
  }).optional().describe('Cursor position in document'),
  selection: z.object({
    start: z.object({
      line: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
    }),
    end: z.object({
      line: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
    }),
  }).optional().describe('Selection range (if text is selected)'),
  color: z.string().optional().describe('Cursor color for visual representation'),
  userName: z.string().optional().describe('Display name of user'),
  lastUpdate: z.string().datetime().describe('ISO 8601 datetime of last cursor update'),
}));

export type CursorPosition = z.input<typeof CursorPositionSchema>;

/**
 * Edit Operation Type Enum
 * Types of edit operations for collaborative editing
 */
export const EditOperationType = z.enum([
  'insert',      // Insert text at position
  'delete',      // Delete text from range
  'replace',     // Replace text in range
]);

export type EditOperationType = z.input<typeof EditOperationType>;

/**
 * Edit Operation Schema
 * Represents a single edit operation on a document
 * Supports Operational Transformation (OT) for conflict resolution
 */
export const EditOperationSchema = lazySchema(() => z.object({
  operationId: z.string().uuid().describe('Unique operation identifier'),
  documentId: z.string().describe('Document identifier'),
  userId: z.string().describe('User who performed the edit'),
  sessionId: z.string().uuid().describe('Session identifier'),
  type: EditOperationType.describe('Type of edit operation'),
  position: z.object({
    line: z.number().int().nonnegative().describe('Line number (0-indexed)'),
    column: z.number().int().nonnegative().describe('Column number (0-indexed)'),
  }).describe('Starting position of the operation'),
  endPosition: z.object({
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
  }).optional().describe('Ending position (for delete/replace operations)'),
  content: z.string().optional().describe('Content to insert/replace'),
  version: z.number().int().nonnegative().describe('Document version before this operation'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime when operation was created'),
  baseOperationId: z.string().uuid().optional().describe('Previous operation ID this builds upon (for OT)'),
}));

export type EditOperation = z.input<typeof EditOperationSchema>;

/**
 * Document State Schema
 * Represents the current state of a collaborative document
 */
export const DocumentStateSchema = lazySchema(() => z.object({
  documentId: z.string().describe('Document identifier'),
  version: z.number().int().nonnegative().describe('Current document version'),
  content: z.string().describe('Current document content'),
  lastModified: z.string().datetime().describe('ISO 8601 datetime of last modification'),
  activeSessions: z.array(z.string().uuid()).describe('Active editing session IDs'),
  checksum: z.string().optional().describe('Content checksum for integrity verification'),
}));

export type DocumentState = z.input<typeof DocumentStateSchema>;

// ==========================================
// WebSocket Messages
// ==========================================

/**
 * Base WebSocket Message
 * All WebSocket messages extend this base structure
 */
const BaseWebSocketMessage = z.object({
  messageId: z.string().uuid().describe('Unique message identifier'),
  type: WebSocketMessageType.describe('Message type'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime when message was sent'),
});

/**
 * Subscribe Message
 * Client sends this to subscribe to events
 */
export const SubscribeMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('subscribe'),
  subscription: EventSubscriptionSchema.describe('Subscription configuration'),
}));

export type SubscribeMessage = z.input<typeof SubscribeMessageSchema>;

/**
 * Unsubscribe Message
 * Client sends this to unsubscribe from events
 */
export const UnsubscribeMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('unsubscribe'),
  request: UnsubscribeRequestSchema.describe('Unsubscribe request'),
}));

export type UnsubscribeMessage = z.input<typeof UnsubscribeMessageSchema>;

/**
 * Event Message
 * Server sends this when a subscribed event occurs
 */
export const EventMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('event'),
  subscriptionId: z.string().uuid().describe('Subscription ID this event belongs to'),
  // [#13613] Carried `EventNameSchema` until ADR-0049 enforce-or-remove
  // retired it — no runtime consumer ever parsed through this schema, and the
  // platform-checked event vocabulary is the closed DataEventType /
  // BulkDataEventType enums (api/events.zod.ts).
  eventName: z.string().describe('Event name (dot notation by convention; the platform-checked event vocabulary is the closed DataEventType / BulkDataEventType enums)'),
  object: z.string().optional().describe('Object name the event relates to'),
  payload: z.unknown().describe('Event payload data'),
  userId: z.string().optional().describe('User who triggered the event'),
}));

export type EventMessage = z.input<typeof EventMessageSchema>;

/**
 * Presence Message
 * Presence update message
 */
export const PresenceMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('presence'),
  presence: PresenceStateSchema.describe('Presence state'),
}));

export type PresenceMessage = z.input<typeof PresenceMessageSchema>;

/**
 * Cursor Message
 * Cursor position update for collaborative editing
 */
export const CursorMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('cursor'),
  cursor: CursorPositionSchema.describe('Cursor position'),
}));

export type CursorMessage = z.input<typeof CursorMessageSchema>;

/**
 * Edit Message
 * Document edit operation for collaborative editing
 */
export const EditMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('edit'),
  operation: EditOperationSchema.describe('Edit operation'),
}));

export type EditMessage = z.input<typeof EditMessageSchema>;

/**
 * Acknowledgment Message
 * Server acknowledges receipt of a message
 */
export const AckMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('ack'),
  ackMessageId: z.string().uuid().describe('ID of the message being acknowledged'),
  success: z.boolean().describe('Whether the operation was successful'),
  error: z.string().optional().describe('Error message if operation failed'),
}));

export type AckMessage = z.input<typeof AckMessageSchema>;

/**
 * Error Message
 * Server sends error information
 */
export const ErrorMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('error'),
  code: z.string().describe('Error code'),
  message: z.string().describe('Error message'),
  details: z.unknown().optional().describe('Additional error details'),
}));

export type ErrorMessage = z.input<typeof ErrorMessageSchema>;

/**
 * Ping Message
 * Keepalive ping from client or server
 */
export const PingMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('ping'),
}));

export type PingMessage = z.input<typeof PingMessageSchema>;

/**
 * Pong Message
 * Keepalive pong response
 */
export const PongMessageSchema = lazySchema(() => BaseWebSocketMessage.extend({
  type: z.literal('pong'),
  pingMessageId: z.string().uuid().optional().describe('ID of ping message being responded to'),
}));

export type PongMessage = z.input<typeof PongMessageSchema>;

/**
 * WebSocket Message Union
 * Discriminated union of all WebSocket message types
 */
export const WebSocketMessageSchema = lazySchema(() => z.discriminatedUnion('type', [
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  EventMessageSchema,
  PresenceMessageSchema,
  CursorMessageSchema,
  EditMessageSchema,
  AckMessageSchema,
  ErrorMessageSchema,
  PingMessageSchema,
  PongMessageSchema,
]));

export type WebSocketMessage = z.input<typeof WebSocketMessageSchema>;

// ==========================================
// Connection Configuration
// ==========================================

/**
 * WebSocket Connection Config
 * Configuration for WebSocket connections
 */
export const WebSocketConfigSchema = lazySchema(() => z.object({
  url: z.string().url().describe('WebSocket server URL'),
  protocols: z.array(z.string()).optional().describe('WebSocket sub-protocols'),
  reconnect: z.boolean().optional().default(true).describe('Enable automatic reconnection'),
  reconnectInterval: z.number().int().positive().optional().default(1000).describe('Reconnection interval in milliseconds'),
  maxReconnectAttempts: z.number().int().positive().optional().default(5).describe('Maximum reconnection attempts'),
  pingInterval: z.number().int().positive().optional().default(30000).describe('Ping interval in milliseconds'),
  timeout: z.number().int().positive().optional().default(5000).describe('Message timeout in milliseconds'),
  headers: z.record(z.string(), z.string()).optional().describe('Custom headers for WebSocket handshake'),
}));

export type WebSocketConfig = z.input<typeof WebSocketConfigSchema>;
/** Post-parse shape of {@link WebSocketConfig} — defaults applied, transforms run (ADR-0122). */
export type WebSocketConfigParsed = z.infer<typeof WebSocketConfigSchema>;

// ==========================================
// Simplified Collaboration API
// ==========================================

/**
 * Simplified WebSocket Event Schema
 * 
 * A simplified event schema for basic WebSocket communication.
 * Complements the comprehensive WebSocketMessageSchema above for simpler use cases.
 * 
 * @example Subscribe to channel
 * ```typescript
 * {
 *   type: 'subscribe',
 *   channel: 'record.account.123',
 *   payload: { events: ['created', 'updated'] },
 *   timestamp: Date.now()
 * }
 * ```
 * 
 * @example Data change notification
 * ```typescript
 * {
 *   type: 'data-change',
 *   channel: 'record.account.123',
 *   payload: { id: '123', action: 'updated', data: {...} },
 *   timestamp: Date.now()
 * }
 * ```
 */
export const WebSocketEventSchema = lazySchema(() => z.object({
  type: z.enum([
    'subscribe',       // Client subscribes to channel
    'unsubscribe',     // Client unsubscribes from channel
    'data-change',     // Data modification event
    'presence-update', // User presence change
    'cursor-update',   // Cursor position change (collaborative editing)
    'error',           // Error message
  ]).describe('Event type'),
  channel: z.string().describe('Channel identifier (e.g., "record.account.123", "user.456")'),
  payload: z.unknown().describe('Event payload data'),
  timestamp: z.number().describe('Unix timestamp in milliseconds'),
}));

export type WebSocketEvent = z.input<typeof WebSocketEventSchema>;

/**
 * Simplified Presence State Schema
 * 
 * A simplified presence schema for basic user presence tracking.
 * Complements the comprehensive PresenceStateSchema for simpler integrations.
 * 
 * Use this for basic presence features. For advanced features like device tracking,
 * custom status, and session management, use the comprehensive PresenceStateSchema above.
 * 
 * @example User online
 * ```typescript
 * {
 *   userId: 'user123',
 *   userName: 'John Doe',
 *   status: 'online',
 *   lastSeen: Date.now(),
 *   metadata: { currentPage: '/dashboard' }
 * }
 * ```
 */
export const SimplePresenceStateSchema = lazySchema(() => z.object({
  userId: z.string().describe('User identifier'),
  userName: z.string().describe('User display name'),
  status: z.enum(['online', 'away', 'offline']).describe('User presence status'),
  lastSeen: z.number().describe('Unix timestamp of last activity in milliseconds'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional presence metadata (e.g., current page, custom status)'),
}));

export type SimplePresenceState = z.input<typeof SimplePresenceStateSchema>;

/**
 * Simplified Cursor Position Schema
 * 
 * A simplified cursor position schema for basic collaborative editing.
 * Complements the comprehensive CursorPositionSchema for simpler use cases.
 * 
 * Use this for basic cursor sharing. For advanced features like selections,
 * color coding, and document versioning, use the comprehensive CursorPositionSchema above.
 * 
 * @example Cursor in text field
 * ```typescript
 * {
 *   userId: 'user123',
 *   recordId: 'account_456',
 *   fieldName: 'description',
 *   position: 42,
 *   selection: { start: 42, end: 57 }
 * }
 * ```
 */
export const SimpleCursorPositionSchema = lazySchema(() => z.object({
  userId: z.string().describe('User identifier'),
  recordId: z.string().describe('Record identifier being edited'),
  fieldName: z.string().describe('Field name being edited'),
  position: z.number().describe('Cursor position (character offset from start)'),
  selection: z.object({
    start: z.number().describe('Selection start position'),
    end: z.number().describe('Selection end position'),
  }).optional().describe('Text selection range (if text is selected)'),
}));

export type SimpleCursorPosition = z.input<typeof SimpleCursorPositionSchema>;

/**
 * WebSocket Server Configuration Schema
 * 
 * Server-side configuration for WebSocket services.
 * Controls features like presence tracking, cursor sharing, and connection management.
 * 
 * @example Production configuration
 * ```typescript
 * {
 *   enabled: true,
 *   path: '/ws',
 *   heartbeatInterval: 30000,
 *   reconnectAttempts: 5,
 *   presence: true,
 *   cursorSharing: true
 * }
 * ```
 */
export const WebSocketServerConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable WebSocket server'),
  path: z.string().default('/ws').describe('WebSocket endpoint path'),
  heartbeatInterval: z.number().default(30000).describe('Heartbeat interval in milliseconds'),
  reconnectAttempts: z.number().default(5).describe('Maximum reconnection attempts for clients'),
  presence: z.boolean().default(false).describe('Enable presence tracking'),
  cursorSharing: z.boolean().default(false).describe('Enable collaborative cursor sharing'),
}));

export type WebSocketServerConfig = z.input<typeof WebSocketServerConfigSchema>;
/** Post-parse shape of {@link WebSocketServerConfig} — defaults applied, transforms run (ADR-0122). */
export type WebSocketServerConfigParsed = z.infer<typeof WebSocketServerConfigSchema>;
