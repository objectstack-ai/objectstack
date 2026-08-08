// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Realtime Shared Protocol
 * 
 * Shared schemas and types for real-time communication protocols.
 * This module consolidates overlapping definitions between the transport-level
 * realtime protocol (SSE/Polling/WebSocket) and the WebSocket collaboration protocol.
 * 
 * **Architecture:**
 * - `realtime-shared.zod.ts` — Shared base schemas (Presence, Event types)
 * - `realtime.zod.ts` — Transport-layer protocol (Channel, Subscription, Transport selection)
 * - `websocket.zod.ts` — Collaboration protocol (Cursor, OT editing, Advanced presence)
 * 
 * @see realtime.zod.ts for transport-layer configuration
 * @see websocket.zod.ts for collaborative editing protocol
 */

// ==========================================
// Shared Presence Status
// ==========================================

/**
 * Presence Status Enum (Unified)
 * 
 * Canonical user presence status shared across all realtime protocols.
 * Used by both transport-level presence tracking (realtime.zod.ts)
 * and WebSocket collaboration presence (websocket.zod.ts).
 * 
 * @example
 * ```typescript
 * import { PresenceStatus } from './realtime-shared.zod';
 * const status = PresenceStatus.parse('online'); // ✅
 * ```
 */
import { lazySchema } from '../shared/lazy-schema';
export const PresenceStatus = z.enum([
  'online',   // User is actively connected
  'away',     // User is idle/inactive
  'busy',     // User is busy (do not disturb)
  'offline',  // User is disconnected
]);

export type PresenceStatus = z.input<typeof PresenceStatus>;

// ==========================================
// Shared Realtime Actions
// ==========================================

/**
 * Realtime Record Action Enum (Unified)
 * 
 * Canonical action types for real-time record change events.
 * Shared between transport-level events and WebSocket event messages.
 */
export const RealtimeRecordAction = z.enum([
  'created',
  'updated',
  'deleted',
]);

export type RealtimeRecordAction = z.input<typeof RealtimeRecordAction>;

// ==========================================
// Shared Base Presence Schema
// ==========================================

/**
 * Base Presence Schema (Unified)
 * 
 * Core presence fields shared across all realtime protocols.
 * Transport-level (realtime.zod.ts) and collaboration-level (websocket.zod.ts)
 * presence schemas extend this base with protocol-specific fields.
 * 
 * @example
 * ```typescript
 * const presence = BasePresenceSchema.parse({
 *   userId: 'user-123',
 *   status: 'online',
 *   lastSeen: '2024-01-15T10:30:00Z',
 * });
 * ```
 */
export const BasePresenceSchema = lazySchema(() => z.object({
  /** User identifier */
  userId: z.string().describe('User identifier'),

  /** Current presence status */
  status: PresenceStatus.describe('Current presence status'),

  /** Last activity timestamp */
  lastSeen: z.string().datetime().describe('ISO 8601 datetime of last activity'),

  /** Custom metadata */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom presence data (e.g., current page, custom status)'),
}));

export type BasePresence = z.input<typeof BasePresenceSchema>;
