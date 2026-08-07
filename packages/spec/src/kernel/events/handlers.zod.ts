// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ==========================================
// Event Handlers
// ==========================================

/**
 * Event Handler Schema
 * Defines how to handle a specific event
 */
import { lazySchema } from '../../shared/lazy-schema';
export const EventHandlerSchema = lazySchema(() => z.object({
  /**
   * Handler identifier
   */
  id: z.string().optional().describe('Unique handler identifier'),
  
  /**
   * Event name pattern
   */
  eventName: z.string().describe('Name of event to handle (supports wildcards like user.*)'),
  
  /**
   * Handler function
   */
  handler: z.unknown()
    .describe('Handler function'),
  
  /**
   * Execution priority
   */
  priority: z.number().int().default(0).describe('Execution priority (lower numbers execute first)'),
  
  /**
   * Async execution
   */
  async: z.boolean().default(true).describe('Execute in background (true) or block (false)'),
  
  /**
   * Retry configuration
   */
  retry: z.object({
    maxRetries: z.number().int().min(0).default(3).describe('Maximum retry attempts'),
    backoffMs: z.number().int().positive().default(1000).describe('Initial backoff delay'),
    backoffMultiplier: z.number().positive().default(2).describe('Backoff multiplier'),
  }).optional().describe('Retry policy for failed handlers'),
  
  /**
   * Timeout
   */
  timeoutMs: z.number().int().positive().optional().describe('Handler timeout in milliseconds'),
  
  /**
   * Filter function
   */
  filter: z.unknown()
    .optional()
    .describe('Optional filter to determine if handler should execute'),
}));

export type EventHandler = z.infer<typeof EventHandlerSchema>;
/** Post-parse shape of {@link EventHandler} — defaults applied, transforms run (ADR-0122). */
export type EventHandlerParsed = z.infer<typeof EventHandlerSchema>;

/**
 * Event Route Schema
 * Routes events from one pattern to multiple targets with optional transformation
 */
export const EventRouteSchema = lazySchema(() => z.object({
  from: z.string().describe('Source event pattern (supports wildcards, e.g., user.* or *.created)'),
  to: z.array(z.string()).describe('Target event names to route to'),
  transform: z.unknown().optional().describe('Optional function to transform payload'),
}));

export type EventRoute = z.infer<typeof EventRouteSchema>;

/**
 * Event Persistence Schema
 * Configuration for persisting events to storage
 */
export const EventPersistenceSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable event persistence'),
  retention: z.number().int().positive().describe('Days to retain persisted events'),
  filter: z.unknown().optional().describe('Optional filter function to select which events to persist'),
  storage: z.enum(['database', 'file', 's3', 'custom']).default('database')
    .describe('Storage backend for persisted events'),
}));

export type EventPersistence = z.infer<typeof EventPersistenceSchema>;
/** Post-parse shape of {@link EventPersistence} — defaults applied, transforms run (ADR-0122). */
export type EventPersistenceParsed = z.infer<typeof EventPersistenceSchema>;
