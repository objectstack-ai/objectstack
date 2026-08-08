// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Real-Time Collaboration Protocol
 * 
 * Defines schemas for real-time collaborative editing in ObjectStack.
 * Supports Operational Transformation (OT), CRDT (Conflict-free Replicated Data Types),
 * cursor sharing, and awareness state for collaborative applications.
 * 
 * Industry alignment: Google Docs, Figma, VSCode Live Share, Yjs
 */

// ==========================================
// Operational Transformation (OT)
// ==========================================

/**
 * OT Operation Type Enum
 * Types of operations in Operational Transformation
 */
import { lazySchema } from '../shared/lazy-schema';
export const OTOperationType = z.enum([
  'insert',      // Insert characters at position
  'delete',      // Delete characters at position
  'retain',      // Keep characters (used for composing operations)
]);

export type OTOperationType = z.input<typeof OTOperationType>;

/**
 * OT Operation Component
 * Single component of an OT operation
 */
export const OTComponentSchema = lazySchema(() => z.discriminatedUnion('type', [
  z.object({
    type: z.literal('insert'),
    text: z.string().describe('Text to insert'),
    attributes: z.record(z.string(), z.unknown()).optional().describe('Text formatting attributes (e.g., bold, italic)'),
  }),
  z.object({
    type: z.literal('delete'),
    count: z.number().int().positive().describe('Number of characters to delete'),
  }),
  z.object({
    type: z.literal('retain'),
    count: z.number().int().positive().describe('Number of characters to retain'),
    attributes: z.record(z.string(), z.unknown()).optional().describe('Attribute changes to apply'),
  }),
]));

export type OTComponent = z.input<typeof OTComponentSchema>;

/**
 * OT Operation Schema
 * Represents a complete OT operation
 * Based on the OT algorithm used by Google Docs and other collaborative editors
 */
export const OTOperationSchema = lazySchema(() => z.object({
  operationId: z.string().uuid().describe('Unique operation identifier'),
  documentId: z.string().describe('Document identifier'),
  userId: z.string().describe('User who created the operation'),
  sessionId: z.string().uuid().describe('Session identifier'),
  components: z.array(OTComponentSchema).describe('Operation components'),
  baseVersion: z.number().int().nonnegative().describe('Document version this operation is based on'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime when operation was created'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional operation metadata'),
}));

export type OTOperation = z.input<typeof OTOperationSchema>;

/**
 * OT Transform Result
 * Result of transforming one operation against another
 */
export const OTTransformResultSchema = lazySchema(() => z.object({
  operation: OTOperationSchema.describe('Transformed operation'),
  transformed: z.boolean().describe('Whether transformation was applied'),
  conflicts: z.array(z.string()).optional().describe('Conflict descriptions if any'),
}));

export type OTTransformResult = z.input<typeof OTTransformResultSchema>;

// ==========================================
// CRDT (Conflict-free Replicated Data Types)
// ==========================================

/**
 * CRDT Type Enum
 * Types of CRDTs supported
 */
export const CRDTType = z.enum([
  'lww-register',    // Last-Write-Wins Register
  'g-counter',       // Grow-only Counter
  'pn-counter',      // Positive-Negative Counter
  'g-set',           // Grow-only Set
  'or-set',          // Observed-Remove Set
  'lww-map',         // Last-Write-Wins Map
  'text',            // CRDT-based Text (e.g., Yjs, Automerge)
  'tree',            // CRDT-based Tree structure
  'json',            // CRDT-based JSON (e.g., Automerge)
]);

export type CRDTType = z.input<typeof CRDTType>;

/**
 * Vector Clock Schema
 * Tracks causality in distributed systems
 */
export const VectorClockSchema = lazySchema(() => z.object({
  clock: z.record(z.string(), z.number().int().nonnegative()).describe('Map of replica ID to logical timestamp'),
}));

export type VectorClock = z.input<typeof VectorClockSchema>;

/**
 * LWW-Register Schema
 * Last-Write-Wins Register CRDT
 */
export const LWWRegisterSchema = lazySchema(() => z.object({
  type: z.literal('lww-register'),
  value: z.unknown().describe('Current register value'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime of last write'),
  replicaId: z.string().describe('ID of replica that performed last write'),
  vectorClock: VectorClockSchema.optional().describe('Optional vector clock for causality tracking'),
}));

export type LWWRegister = z.input<typeof LWWRegisterSchema>;

/**
 * Counter Operation Schema
 * Operations for Counter CRDTs
 */
export const CounterOperationSchema = lazySchema(() => z.object({
  replicaId: z.string().describe('Replica identifier'),
  delta: z.number().int().describe('Change amount (positive for increment, negative for decrement)'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime of operation'),
}));

export type CounterOperation = z.input<typeof CounterOperationSchema>;

/**
 * G-Counter Schema
 * Grow-only Counter CRDT
 */
export const GCounterSchema = lazySchema(() => z.object({
  type: z.literal('g-counter'),
  counts: z.record(z.string(), z.number().int().nonnegative()).describe('Map of replica ID to count'),
}));

export type GCounter = z.input<typeof GCounterSchema>;

/**
 * PN-Counter Schema
 * Positive-Negative Counter CRDT (supports increment and decrement)
 */
export const PNCounterSchema = lazySchema(() => z.object({
  type: z.literal('pn-counter'),
  positive: z.record(z.string(), z.number().int().nonnegative()).describe('Positive increments per replica'),
  negative: z.record(z.string(), z.number().int().nonnegative()).describe('Negative increments per replica'),
}));

export type PNCounter = z.input<typeof PNCounterSchema>;

/**
 * OR-Set Element Schema
 * Element in an Observed-Remove Set
 */
export const ORSetElementSchema = lazySchema(() => z.object({
  value: z.unknown().describe('Element value'),
  timestamp: z.string().datetime().describe('Addition timestamp'),
  replicaId: z.string().describe('Replica that added the element'),
  uid: z.string().uuid().describe('Unique identifier for this addition'),
  removed: z.boolean().optional().default(false).describe('Whether element has been removed'),
}));

export type ORSetElement = z.input<typeof ORSetElementSchema>;
/** Post-parse shape of {@link ORSetElement} — defaults applied, transforms run (ADR-0122). */
export type ORSetElementParsed = z.infer<typeof ORSetElementSchema>;

/**
 * OR-Set Schema
 * Observed-Remove Set CRDT
 */
export const ORSetSchema = lazySchema(() => z.object({
  type: z.literal('or-set'),
  elements: z.array(ORSetElementSchema).describe('Set elements with metadata'),
}));

export type ORSet = z.input<typeof ORSetSchema>;
/** Post-parse shape of {@link ORSet} — defaults applied, transforms run (ADR-0122). */
export type ORSetParsed = z.infer<typeof ORSetSchema>;

/**
 * Text CRDT Operation Schema
 * Operations for text-based CRDTs (e.g., Yjs, Automerge)
 */
export const TextCRDTOperationSchema = lazySchema(() => z.object({
  operationId: z.string().uuid().describe('Unique operation identifier'),
  replicaId: z.string().describe('Replica identifier'),
  position: z.number().int().nonnegative().describe('Position in document'),
  insert: z.string().optional().describe('Text to insert'),
  delete: z.number().int().positive().optional().describe('Number of characters to delete'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime of operation'),
  lamportTimestamp: z.number().int().nonnegative().describe('Lamport timestamp for ordering'),
}));

export type TextCRDTOperation = z.input<typeof TextCRDTOperationSchema>;

/**
 * Text CRDT State Schema
 * State of a text-based CRDT document
 */
export const TextCRDTStateSchema = lazySchema(() => z.object({
  type: z.literal('text'),
  documentId: z.string().describe('Document identifier'),
  content: z.string().describe('Current text content'),
  operations: z.array(TextCRDTOperationSchema).describe('History of operations'),
  lamportClock: z.number().int().nonnegative().describe('Current Lamport clock value'),
  vectorClock: VectorClockSchema.describe('Vector clock for causality'),
}));

export type TextCRDTState = z.input<typeof TextCRDTStateSchema>;

/**
 * CRDT State Union
 * Discriminated union of all CRDT types
 */
export const CRDTStateSchema = lazySchema(() => z.discriminatedUnion('type', [
  LWWRegisterSchema,
  GCounterSchema,
  PNCounterSchema,
  ORSetSchema,
  TextCRDTStateSchema,
]));

export type CRDTState = z.input<typeof CRDTStateSchema>;
/** Post-parse shape of {@link CRDTState} — defaults applied, transforms run (ADR-0122). */
export type CRDTStateParsed = z.infer<typeof CRDTStateSchema>;

/**
 * CRDT Merge Schema
 * Result of merging two CRDT states
 */
export const CRDTMergeResultSchema = lazySchema(() => z.object({
  state: CRDTStateSchema.describe('Merged CRDT state'),
  conflicts: z.array(z.object({
    type: z.string().describe('Conflict type'),
    description: z.string().describe('Conflict description'),
    resolved: z.boolean().describe('Whether conflict was automatically resolved'),
  })).optional().describe('Conflicts encountered during merge'),
}));

export type CRDTMergeResult = z.input<typeof CRDTMergeResultSchema>;
/** Post-parse shape of {@link CRDTMergeResult} — defaults applied, transforms run (ADR-0122). */
export type CRDTMergeResultParsed = z.infer<typeof CRDTMergeResultSchema>;

// ==========================================
// Cursor Sharing
// ==========================================

/**
 * Cursor Color Preset Enum
 * Standard color presets for cursor visualization
 */
export const CursorColorPreset = z.enum([
  'blue',
  'green',
  'red',
  'yellow',
  'purple',
  'orange',
  'pink',
  'teal',
  'indigo',
  'cyan',
]);

export type CursorColorPreset = z.input<typeof CursorColorPreset>;

/**
 * Cursor Style Schema
 * Visual styling for collaborative cursors
 */
export const CursorStyleSchema = lazySchema(() => z.object({
  color: z.union([CursorColorPreset, z.string()]).describe('Cursor color (preset or custom hex)'),
  opacity: z.number().min(0).max(1).optional().default(1).describe('Cursor opacity (0-1)'),
  label: z.string().optional().describe('Label to display with cursor (usually username)'),
  showLabel: z.boolean().optional().default(true).describe('Whether to show label'),
  pulseOnUpdate: z.boolean().optional().default(true).describe('Whether to pulse when cursor moves'),
}));

export type CursorStyle = z.input<typeof CursorStyleSchema>;
/** Post-parse shape of {@link CursorStyle} — defaults applied, transforms run (ADR-0122). */
export type CursorStyleParsed = z.infer<typeof CursorStyleSchema>;

/**
 * Cursor Selection Schema
 * Represents a text selection in collaborative editing
 */
export const CursorSelectionSchema = lazySchema(() => z.object({
  anchor: z.object({
    line: z.number().int().nonnegative().describe('Anchor line number'),
    column: z.number().int().nonnegative().describe('Anchor column number'),
  }).describe('Selection anchor (start point)'),
  focus: z.object({
    line: z.number().int().nonnegative().describe('Focus line number'),
    column: z.number().int().nonnegative().describe('Focus column number'),
  }).describe('Selection focus (end point)'),
  direction: z.enum(['forward', 'backward']).optional().describe('Selection direction'),
}));

export type CursorSelection = z.input<typeof CursorSelectionSchema>;

/**
 * Collaborative Cursor Schema
 * Complete cursor state for a collaborative user
 */
export const CollaborativeCursorSchema = lazySchema(() => z.object({
  userId: z.string().describe('User identifier'),
  sessionId: z.string().uuid().describe('Session identifier'),
  documentId: z.string().describe('Document identifier'),
  userName: z.string().describe('Display name of user'),
  position: z.object({
    line: z.number().int().nonnegative().describe('Cursor line number (0-indexed)'),
    column: z.number().int().nonnegative().describe('Cursor column number (0-indexed)'),
  }).describe('Current cursor position'),
  selection: CursorSelectionSchema.optional().describe('Current text selection'),
  style: CursorStyleSchema.describe('Visual style for this cursor'),
  isTyping: z.boolean().optional().default(false).describe('Whether user is currently typing'),
  lastUpdate: z.string().datetime().describe('ISO 8601 datetime of last cursor update'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional cursor metadata'),
}));

export type CollaborativeCursor = z.input<typeof CollaborativeCursorSchema>;
/** Post-parse shape of {@link CollaborativeCursor} — defaults applied, transforms run (ADR-0122). */
export type CollaborativeCursorParsed = z.infer<typeof CollaborativeCursorSchema>;

/**
 * Cursor Update Schema
 * Update to a collaborative cursor
 */
export const CursorUpdateSchema = lazySchema(() => z.object({
  position: z.object({
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
  }).optional().describe('Updated cursor position'),
  selection: CursorSelectionSchema.optional().describe('Updated selection'),
  isTyping: z.boolean().optional().describe('Updated typing state'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
}));

export type CursorUpdate = z.input<typeof CursorUpdateSchema>;

// ==========================================
// Awareness State
// ==========================================

/**
 * User Activity Status Enum
 * User activity status for awareness
 */
export const UserActivityStatus = z.enum([
  'active',      // User is actively editing
  'idle',        // User is idle but connected
  'viewing',     // User is viewing but not editing
  'disconnected', // User is disconnected
]);

export type UserActivityStatus = z.input<typeof UserActivityStatus>;

/**
 * Awareness User State Schema
 * Tracks what a user is doing in the collaborative session
 */
export const AwarenessUserStateSchema = lazySchema(() => z.object({
  userId: z.string().describe('User identifier'),
  sessionId: z.string().uuid().describe('Session identifier'),
  userName: z.string().describe('Display name'),
  userAvatar: z.string().optional().describe('User avatar URL'),
  status: UserActivityStatus.describe('Current activity status'),
  currentDocument: z.string().optional().describe('Document ID user is currently editing'),
  currentView: z.string().optional().describe('Current view/page user is on'),
  lastActivity: z.string().datetime().describe('ISO 8601 datetime of last activity'),
  joinedAt: z.string().datetime().describe('ISO 8601 datetime when user joined session'),
  permissions: z.array(z.string()).optional().describe('User permissions in this session'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional user state metadata'),
}));

export type AwarenessUserState = z.input<typeof AwarenessUserStateSchema>;

/**
 * Awareness Session Schema
 * Represents the complete awareness state for a collaboration session
 */
export const AwarenessSessionSchema = lazySchema(() => z.object({
  sessionId: z.string().uuid().describe('Session identifier'),
  documentId: z.string().optional().describe('Document ID this session is for'),
  users: z.array(AwarenessUserStateSchema).describe('Active users in session'),
  startedAt: z.string().datetime().describe('ISO 8601 datetime when session started'),
  lastUpdate: z.string().datetime().describe('ISO 8601 datetime of last update'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Session metadata'),
}));

export type AwarenessSession = z.input<typeof AwarenessSessionSchema>;

/**
 * Awareness Update Schema
 * Update to awareness state
 */
export const AwarenessUpdateSchema = lazySchema(() => z.object({
  status: UserActivityStatus.optional().describe('Updated status'),
  currentDocument: z.string().optional().describe('Updated current document'),
  currentView: z.string().optional().describe('Updated current view'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Updated metadata'),
}));

export type AwarenessUpdate = z.input<typeof AwarenessUpdateSchema>;

/**
 * Awareness Event Schema
 * Events that occur in awareness tracking
 */
export const AwarenessEventSchema = lazySchema(() => z.object({
  eventId: z.string().uuid().describe('Event identifier'),
  sessionId: z.string().uuid().describe('Session identifier'),
  eventType: z.enum([
    'user.joined',
    'user.left',
    'user.updated',
    'session.created',
    'session.ended',
  ]).describe('Type of awareness event'),
  userId: z.string().optional().describe('User involved in event'),
  timestamp: z.string().datetime().describe('ISO 8601 datetime of event'),
  payload: z.unknown().describe('Event payload'),
}));

export type AwarenessEvent = z.input<typeof AwarenessEventSchema>;

// ==========================================
// Collaboration Session Management
// ==========================================

/**
 * Collaboration Mode Enum
 * Types of collaboration modes
 */
export const CollaborationMode = z.enum([
  'ot',          // Operational Transformation
  'crdt',        // CRDT-based
  'lock',        // Pessimistic locking (turn-based)
  'hybrid',      // Hybrid approach
]);

export type CollaborationMode = z.input<typeof CollaborationMode>;

/**
 * Collaboration Session Config
 * Configuration for a collaboration session
 */
export const CollaborationSessionConfigSchema = lazySchema(() => z.object({
  mode: CollaborationMode.describe('Collaboration mode to use'),
  enableCursorSharing: z.boolean().optional().default(true).describe('Enable cursor sharing'),
  enablePresence: z.boolean().optional().default(true).describe('Enable presence tracking'),
  enableAwareness: z.boolean().optional().default(true).describe('Enable awareness state'),
  maxUsers: z.number().int().positive().optional().describe('Maximum concurrent users'),
  idleTimeout: z.number().int().positive().optional().default(300000).describe('Idle timeout in milliseconds'),
  conflictResolution: z.enum(['ot', 'crdt', 'manual']).optional().default('ot').describe('Conflict resolution strategy'),
  persistence: z.boolean().optional().default(true).describe('Enable operation persistence'),
  snapshot: z.object({
    enabled: z.boolean().describe('Enable periodic snapshots'),
    interval: z.number().int().positive().describe('Snapshot interval in milliseconds'),
  }).optional().describe('Snapshot configuration'),
}));

export type CollaborationSessionConfig = z.input<typeof CollaborationSessionConfigSchema>;
/** Post-parse shape of {@link CollaborationSessionConfig} — defaults applied, transforms run (ADR-0122). */
export type CollaborationSessionConfigParsed = z.infer<typeof CollaborationSessionConfigSchema>;

/**
 * Collaboration Session Schema
 * Complete collaboration session state
 */
export const CollaborationSessionSchema = lazySchema(() => z.object({
  sessionId: z.string().uuid().describe('Session identifier'),
  documentId: z.string().describe('Document identifier'),
  config: CollaborationSessionConfigSchema.describe('Session configuration'),
  users: z.array(AwarenessUserStateSchema).describe('Active users'),
  cursors: z.array(CollaborativeCursorSchema).describe('Active cursors'),
  version: z.number().int().nonnegative().describe('Current document version'),
  operations: z.array(z.union([OTOperationSchema, TextCRDTOperationSchema])).optional().describe('Recent operations'),
  createdAt: z.string().datetime().describe('ISO 8601 datetime when session was created'),
  lastActivity: z.string().datetime().describe('ISO 8601 datetime of last activity'),
  status: z.enum(['active', 'idle', 'ended']).describe('Session status'),
}));

export type CollaborationSession = z.input<typeof CollaborationSessionSchema>;
/** Post-parse shape of {@link CollaborationSession} — defaults applied, transforms run (ADR-0122). */
export type CollaborationSessionParsed = z.infer<typeof CollaborationSessionSchema>;
